import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { engine } from './audio/engine.js'
import { PatternRenderer, mixBufferId, patternDuration } from './audio/patterns.js'
import { renderProject } from './audio/export.js'
import { displayCaptureSupported, startRecording } from './audio/recorder.js'
import { downloadBlob } from './audio/wav.js'
import ChannelRack from './components/ChannelRack.jsx'
import ClipInspector from './components/ClipInspector.jsx'
import Mixer from './components/Mixer.jsx'
import PianoRoll from './components/PianoRoll.jsx'
import FxPanel from './components/FxPanel.jsx'
import Knob from './components/Knob.jsx'
import DesktopRecordDialog from './components/DesktopRecordDialog.jsx'
import MashupStudio from './components/MashupStudio.jsx'
import { desktopApi, startDesktopRecording } from './audio/desktop.js'
import { LevelMeter, PositionDisplay, RecTimer, SilenceHint } from './components/Meters.jsx'
import Timeline from './components/Timeline.jsx'
import TrackHeaders from './components/TrackHeaders.jsx'
import { SNAP_OPTIONS, beatSec, initialState, makeChannel, makeTrack, reducer, snapTime, splitClip, uid } from './state/project.js'

const DOCKS = [
  { id: 'rack', label: 'Channel Rack', key: 'F6' },
  { id: 'piano', label: 'Piano Roll', key: 'F7' },
  { id: 'mixer', label: 'Mixer', key: 'F9' },
  { id: 'fx', label: 'Clip & FX', key: 'F8' },
]

// What the transport plays: in PAT mode the current pattern loops on its own, in SONG mode the playlist plays.
function playProject(s) {
  if (s.mode !== 'pattern') return s
  const pattern = s.patterns.find((p) => p.id === s.currentPatternId) ?? s.patterns[0]
  const length = patternDuration(pattern, s.bpm)
  const clip = {
    id: 'patloop',
    patternId: pattern.id,
    bufferId: mixBufferId(pattern.id),
    trackId: s.tracks[0].id,
    name: pattern.name,
    start: 0,
    offset: 0,
    length,
    rate: 1,
    gain: 1,
  }
  return { ...s, clips: [clip], loop: { enabled: true, start: 0, end: length } }
}

const btn =
  'inline-flex h-9 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-200 hover:border-zinc-500 disabled:opacity-40'

const SILENT_RECORDING =
  'Die Aufnahme war komplett stumm und wurde verworfen. Spotify, Apple Music, Netflix & Co. sind kopiergeschützt (DRM): Der Browser gibt ihren Ton beim Teilen nur als Stille weiter. Das lässt sich nicht umgehen. Nimm stattdessen YouTube, SoundCloud, Bandcamp-Previews oder eigene Dateien (Import).'

function recordingErrorText(err, source) {
  const msg = String(err?.message || err)
  const mac = /Mac/i.test(navigator.platform || navigator.userAgent)
  if (err?.name === 'NotAllowedError') {
    if (/system/i.test(msg)) {
      return mac
        ? 'macOS blockiert die Aufnahme. Systemeinstellungen → Datenschutz & Sicherheit → Bildschirm- & Systemaudioaufnahme → Chrome erlauben, Chrome neu starten.'
        : 'Das Betriebssystem blockiert die Aufnahme. Erlaube dem Browser die Bildschirmaufnahme in den Systemeinstellungen.'
    }
    return source === 'display'
      ? 'Freigabe abgebrochen. Klick nochmal auf „Tab-Audio“, wähle oben den Reiter „Chrome-Tab“, dann den Tab mit der Musik, setz unten den Haken „Tab-Audio teilen“ und klick „Teilen“.'
      : 'Mikrofon nicht erlaubt. Klick links in der Adressleiste aufs Schloss-Symbol und erlaube das Mikrofon.'
  }
  if (err?.name === 'NotFoundError') return 'Kein Aufnahmegerät gefunden.'
  return msg
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  const [playing, setPlaying] = useState(false)
  const [rec, setRec] = useState(null)
  const [toast, setToast] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [mashupOpen, setMashupOpen] = useState(false)
  const [desktopOpen, setDesktopOpen] = useState(false)
  const isDesktop = !!desktopApi()
  const mashupOpenRef = useRef(false)
  mashupOpenRef.current = mashupOpen
  const playingRef = useRef(false)
  playingRef.current = playing
  const stateRef = useRef(state)
  stateRef.current = state
  const playFrom = useRef(0)
  const recCount = useRef(0)
  const recRef = useRef(null)
  const taps = useRef([])
  const fileInput = useRef(null)
  const sampleInput = useRef(null)
  const renderer = useRef(null)
  const patternDurs = useRef(new Map())
  const [renderTick, setRenderTick] = useState(0)
  const [samples, setSamples] = useState([])

  const notify = useCallback((msg, kind = 'info') => {
    setToast({ msg, kind, id: Date.now() })
  }, [])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), toast.kind === 'error' ? 9000 : 4000)
    return () => clearTimeout(id)
  }, [toast])

  // --- audio sync ----------------------------------------------------------

  useEffect(() => {
    if (engine.ctx) engine.syncTracks(state.tracks, state.bpm)
  }, [state.tracks, state.bpm])

  useEffect(() => {
    if (engine.ctx) engine.setMaster(state.master)
  }, [state.master])

  const ensureAudio = useCallback(() => {
    engine.ensure()
    engine.syncTracks(stateRef.current.tracks, stateRef.current.bpm)
    engine.setMaster(stateRef.current.master)
  }, [])

  useEffect(() => {
    engine.onStop = (end) => {
      setPlaying(false)
      dispatch({ type: 'set', patch: { playhead: end } })
    }
  }, [])

  // --- patterns ----------------------------------------------------------------

  // Pattern clips follow their pattern's length (bars / tempo changes).
  useEffect(() => {
    const s = stateRef.current
    let clips = s.clips
    for (const p of s.patterns) {
      const dur = patternDuration(p, s.bpm)
      const old = patternDurs.current.get(p.id)
      patternDurs.current.set(p.id, dur)
      if (old === undefined || Math.abs(old - dur) < 1e-6) continue
      clips = clips.map((c) =>
        c.patternId !== p.id ? c : { ...c, length: Math.abs(c.length - old) < 1e-3 ? dur - c.offset : Math.min(c.length, dur - c.offset) },
      )
    }
    if (clips !== s.clips) dispatch({ type: 'setClips', clips })
  }, [state.patterns, state.bpm])

  // Render patterns to audio whenever steps, notes, sounds or tempo change.
  useEffect(() => {
    if (!renderer.current) renderer.current = new PatternRenderer(engine)
    const id = setTimeout(async () => {
      const s = stateRef.current
      const done = await renderer.current.update(s.patterns, s.channels, s.bpm)
      if (done) setRenderTick((n) => n + 1)
    }, 60)
    return () => clearTimeout(id)
  }, [state.patterns, state.channels, state.bpm, samples])

  // Re-schedule while playing when the arrangement changes (debounced so drags stay smooth).
  useEffect(() => {
    if (!engine.playing) return
    const id = setTimeout(() => engine.play(playProject(stateRef.current), engine.position()), 90)
    return () => clearTimeout(id)
  }, [state.clips, state.loop, state.bpm, state.metronome, state.channels, state.tracks, renderTick])

  // Switching PAT/SONG or the pattern while playing restarts at the right place.
  const firstMode = useRef(true)
  useEffect(() => {
    if (firstMode.current) {
      firstMode.current = false
      return
    }
    if (!engine.playing) return
    const s = stateRef.current
    engine.play(playProject(s), s.mode === 'pattern' ? 0 : s.playhead)
  }, [state.mode, state.currentPatternId])

  // --- transport -----------------------------------------------------------

  const play = useCallback(
    (from) => {
      ensureAudio()
      playFrom.current = from
      engine.play(playProject(stateRef.current), stateRef.current.mode === 'pattern' ? 0 : from)
      setPlaying(true)
    },
    [ensureAudio],
  )

  const togglePlay = useCallback(() => {
    if (engine.playing) {
      const pos = engine.stop()
      setPlaying(false)
      if (stateRef.current.mode === 'song') dispatch({ type: 'set', patch: { playhead: pos } })
    } else {
      play(stateRef.current.playhead)
    }
  }, [play])

  const stop = useCallback(() => {
    const wasPlaying = engine.playing
    engine.stop()
    setPlaying(false)
    if (stateRef.current.mode === 'pattern') return
    dispatch({ type: 'set', patch: { playhead: wasPlaying ? playFrom.current : 0 } })
  }, [])

  const seek = useCallback(
    (t) => {
      dispatch({ type: 'set', patch: { playhead: t } })
      if (engine.playing && stateRef.current.mode === 'song') play(t)
    },
    [play],
  )

  const tapTempo = () => {
    const now = performance.now()
    const list = taps.current.filter((t) => now - t < 2500)
    list.push(now)
    taps.current = list.slice(-6)
    if (list.length >= 3) {
      const intervals = list.slice(1).map((t, i) => t - list[i])
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
      dispatch({ type: 'set', patch: { bpm: Math.round((60000 / avg) * 10) / 10 } })
    }
  }

  // --- clips ---------------------------------------------------------------

  const addBufferClip = useCallback((buffer, name, trackId, at) => {
    const s = stateRef.current
    const bufferId = uid('b')
    engine.addBuffer(bufferId, buffer)
    let start = at ?? snapTime(s.playhead, s)
    const overlap = s.clips.some((c) => c.trackId === trackId && c.start < start + buffer.duration && c.start + c.length > start)
    if (overlap) {
      const end = s.clips.filter((c) => c.trackId === trackId).reduce((m, c) => Math.max(m, c.start + c.length), 0)
      const bar = beatSec(s.bpm) * 4
      start = Math.ceil(end / bar - 1e-6) * bar
    }
    const clip = { id: uid('c'), trackId, bufferId, name, start, offset: 0, length: buffer.duration, rate: 1, gain: 1 }
    dispatch({ type: 'setClips', record: true, clips: [...s.clips, clip] })
    dispatch({ type: 'set', patch: { selectedClipId: clip.id, selectedTrackId: trackId, mode: 'song' } })
    return clip
  }, [])

  const addPatternToPlaylist = useCallback(() => {
    const s = stateRef.current
    const pattern = s.patterns.find((p) => p.id === s.currentPatternId)
    if (!pattern) return
    const length = patternDuration(pattern, s.bpm)
    const trackId = s.selectedTrackId
    let start = snapTime(s.playhead, s)
    const onTrack = s.clips.filter((c) => c.trackId === trackId)
    if (onTrack.some((c) => c.start < start + length - 1e-6 && c.start + c.length > start + 1e-6)) {
      start = onTrack.reduce((m, c) => Math.max(m, c.start + c.length), 0)
    }
    const clip = {
      id: uid('c'),
      trackId,
      patternId: pattern.id,
      bufferId: mixBufferId(pattern.id),
      name: `▦ ${pattern.name}`,
      start,
      offset: 0,
      length,
      rate: 1,
      gain: 1,
    }
    dispatch({ type: 'setClips', record: true, clips: [...s.clips, clip] })
    dispatch({ type: 'set', patch: { selectedClipId: clip.id, playhead: start + length } })
    notify(
      s.mode === 'pattern'
        ? 'Pattern liegt in der Playlist. Schalte oben auf SONG, um die Playlist abzuspielen.'
        : 'Pattern liegt in der Playlist.',
    )
  }, [notify])

  const loadSample = useCallback(
    async (file) => {
      ensureAudio()
      try {
        const buffer = await engine.decode(await file.arrayBuffer())
        const id = uid('b')
        engine.addBuffer(id, buffer)
        const name = file.name.replace(/\.[^.]+$/, '')
        setSamples((list) => [...list, { id, name }])
        dispatch({ type: 'addChannel', channel: makeChannel('sample', null, name, stateRef.current.selectedTrackId, { sampleId: id }) })
      } catch {
        notify(`„${file.name}“ konnte nicht gelesen werden.`, 'error')
      }
    },
    [ensureAudio, notify],
  )

  const importFiles = useCallback(
    async (files, trackId, at) => {
      ensureAudio()
      let pos = at
      for (const file of files) {
        try {
          const buffer = await engine.decode(await file.arrayBuffer())
          const clip = addBufferClip(buffer, file.name.replace(/\.[^.]+$/, ''), trackId ?? stateRef.current.selectedTrackId, pos)
          pos = clip.start + clip.length
        } catch {
          notify(`„${file.name}“ konnte nicht gelesen werden.`, 'error')
        }
      }
    },
    [addBufferClip, ensureAudio, notify],
  )

  const currentPattern = state.patterns.find((p) => p.id === state.currentPatternId) ?? state.patterns[0]
  const sampleOptions = [...samples]
  for (const c of state.clips) {
    if (!c.patternId && !sampleOptions.some((o) => o.id === c.bufferId)) sampleOptions.push({ id: c.bufferId, name: c.name })
  }

  const selectedClip = state.clips.find((c) => c.id === state.selectedClipId) ?? null
  const selectedTrack = state.tracks.find((t) => t.id === state.selectedTrackId) ?? state.tracks[0]

  const updateClip = useCallback((id, patch, record = true) => {
    const s = stateRef.current
    const clips = s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c))
    dispatch({ type: 'setClips', clips, record })
  }, [])

  const splitAtPlayhead = useCallback(() => {
    const s = stateRef.current
    const at = engine.playing ? snapTime(engine.position(), s) : s.playhead
    const target =
      s.clips.find((c) => c.id === s.selectedClipId && c.start < at && c.start + c.length > at) ??
      s.clips.find((c) => c.trackId === s.selectedTrackId && c.start < at && c.start + c.length > at)
    if (!target) return notify('Kein Clip unter dem Playhead.')
    const parts = splitClip(target, at)
    if (!parts) return
    dispatch({ type: 'setClips', record: true, clips: s.clips.flatMap((c) => (c.id === target.id ? parts : [c])) })
    dispatch({ type: 'set', patch: { selectedClipId: parts[1].id } })
  }, [notify])

  const duplicateSelected = useCallback(() => {
    const s = stateRef.current
    const clip = s.clips.find((c) => c.id === s.selectedClipId)
    if (!clip) return
    const copy = { ...clip, id: uid('c'), start: clip.start + clip.length }
    dispatch({ type: 'setClips', record: true, clips: [...s.clips, copy] })
    dispatch({ type: 'set', patch: { selectedClipId: copy.id } })
  }, [])

  const deleteSelected = useCallback(() => {
    const s = stateRef.current
    if (!s.selectedClipId) return
    dispatch({ type: 'setClips', record: true, clips: s.clips.filter((c) => c.id !== s.selectedClipId) })
    dispatch({ type: 'set', patch: { selectedClipId: null } })
  }, [])

  const loopSelected = useCallback(() => {
    const s = stateRef.current
    const clip = s.clips.find((c) => c.id === s.selectedClipId)
    if (!clip) return
    dispatch({ type: 'set', patch: { loop: { enabled: true, start: clip.start, end: clip.start + clip.length } } })
  }, [])

  // --- mashup ----------------------------------------------------------------

  const stopTransport = useCallback(() => {
    if (!playingRef.current) return
    const pos = engine.stop()
    setPlaying(false)
    dispatch({ type: 'set', patch: { playhead: pos } })
  }, [])

  const applyMashup = useCallback(
    ({ tracks, clips, bpm }) => {
      stopTransport()
      ensureAudio()
      const s = stateRef.current
      // empty tracks (like the default ones) make room for the song tracks; tracks with clips stay for undo
      const merged = s.tracks
        .filter((t) => s.clips.some((c) => c.trackId === t.id) || tracks.some((x) => x.id === t.id))
        .map((t) => {
          const fresh = tracks.find((x) => x.id === t.id)
          return fresh ? { ...t, fx: { ...t.fx, hp: fresh.fx.hp } } : t
        })
      for (const t of tracks) if (!s.tracks.some((x) => x.id === t.id)) merged.push(t)
      const duration = clips.reduce((m, c) => Math.max(m, c.start + c.length), 0)
      const bar = beatSec(bpm) * 4
      dispatch({
        type: 'set',
        patch: {
          tracks: merged,
          bpm,
          playhead: 0,
          loop: { enabled: false, start: 0, end: bar * 4 },
          zoom: Math.min(1200, Math.max(4, (window.innerWidth - 260) / Math.max(1, duration))),
          selectedTrackId: tracks[0]?.id ?? s.selectedTrackId,
          selectedClipId: null,
        },
      })
      dispatch({ type: 'setClips', record: true, clips })
      dispatch({ type: 'set', patch: { mode: 'song' } })
      notify(
        'Ist jetzt in der Timeline. Jeder Teil ist ein normaler Clip: verschieben, trimmen, Effekte pro Spur. Strg+Z macht es rückgängig.',
      )
    },
    [ensureAudio, notify, stopTransport],
  )

  const closeMashup = useCallback(() => setMashupOpen(false), [])

  // --- recording -----------------------------------------------------------

  const finishRecording = useCallback(() => {
    const current = recRef.current
    if (!current) return
    recRef.current = null
    setRec(null)
    if (current.handle.multi) return finishDesktop(current)
    const hasSignal = current.handle.hasSignal()
    const buffer = current.handle.stop()
    if (buffer && !hasSignal) {
      notify(SILENT_RECORDING, 'error')
    } else if (buffer && buffer.duration > 0.05) {
      recCount.current += 1
      const label = current.source === 'display' ? 'Tab-Rec' : 'Mic-Rec'
      addBufferClip(buffer, `${label} ${recCount.current}`, current.trackId)
      notify('Aufnahme eingefügt. Kanten ziehen zum Trimmen, Shift = ohne Grid.')
    }
  }, [addBufferClip, notify])

  // Desktop app: every recorded app goes onto its own track, all starting at the same position.
  const finishDesktop = (current) => {
    const results = current.handle.stop().filter((r) => r.buffer && r.buffer.duration > 0.05)
    const withSignal = results.filter((r) => r.hasSignal)
    if (!withSignal.length) {
      if (results.length) notify('Die Aufnahme war stumm. Lief in den gewählten Apps gerade Ton?', 'error')
      return
    }
    const s = stateRef.current
    // each app gets a fresh track named after it, so drum/synth inserts stay untouched
    const targets = withSignal.map((r, i) => makeTrack(s.tracks.length + i, r.label))
    const tracks = [...s.tracks, ...targets]
    const start = snapTime(current.startAt, s)
    recCount.current += 1
    const clips = withSignal.map((r, i) => {
      const bufferId = uid('b')
      engine.addBuffer(bufferId, r.buffer)
      return { id: uid('c'), trackId: targets[i].id, bufferId, name: `${r.label} ${recCount.current}`, start, offset: 0, length: r.buffer.duration, rate: 1, gain: 1 }
    })
    dispatch({ type: 'set', patch: { tracks, mode: 'song', selectedClipId: clips[0].id, selectedTrackId: targets[0].id } })
    dispatch({ type: 'setClips', record: true, clips: [...s.clips, ...clips] })
    notify(clips.length > 1 ? `${clips.length} Apps aufgenommen, jede auf ihrer eigenen Spur.` : 'Aufnahme eingefügt.')
  }

  const startDesktopRec = async (sources) => {
    setDesktopOpen(false)
    if (recRef.current || !sources.length) return
    try {
      ensureAudio()
      const handle = await startDesktopRecording(sources, { onError: (msg) => notify(msg, 'error') })
      const s = stateRef.current
      recRef.current = { source: 'desktop', handle, trackId: s.selectedTrackId, startAt: s.playhead }
      setRec(recRef.current)
    } catch (err) {
      notify(`Aufnahme konnte nicht starten: ${err?.message || err}`, 'error')
    }
  }

  const startRec = async (source) => {
    if (recRef.current) return
    try {
      ensureAudio()
      const handle = await startRecording(engine.ctx, source, { onEnded: finishRecording })
      recRef.current = { source, handle, trackId: stateRef.current.selectedTrackId }
      setRec(recRef.current)
    } catch (err) {
      notify(recordingErrorText(err, source), 'error')
    }
  }

  // --- export --------------------------------------------------------------

  const exportMix = async (mode) => {
    setExporting(true)
    try {
      const blob = await renderProject(playProject(stateRef.current), engine.buffers, mode)
      const stamp = new Date().toISOString().slice(0, 16).split(/\D/).join('')
      downloadBlob(blob, `mucke-${Math.round(state.bpm)}bpm-${mode === 'loop' ? 'loop' : 'track'}-${stamp}.wav`)
    } catch (err) {
      notify(err?.message || String(err), 'error')
    } finally {
      setExporting(false)
    }
  }

  // --- keyboard ------------------------------------------------------------

  useEffect(() => {
    const onKey = (e) => {
      if (mashupOpenRef.current) return
      const tag = e.target.tagName
      if ((tag === 'INPUT' && e.target.type !== 'range') || tag === 'SELECT' || tag === 'TEXTAREA') return
      const mod = e.ctrlKey || e.metaKey
      const s = stateRef.current
      const key = e.key.toLowerCase()
      const dock = { F6: 'rack', F7: 'piano', F8: 'fx', F9: 'mixer' }[e.key]
      if (dock) {
        e.preventDefault()
        dispatch({ type: 'set', patch: { dock } })
        return
      }
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (mod && key === 'z') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
      } else if (mod && key === 'y') {
        e.preventDefault()
        dispatch({ type: 'redo' })
      } else if (mod && key === 'd') {
        e.preventDefault()
        duplicateSelected()
      } else if (mod) {
        return
      } else if (key === 's') {
        splitAtPlayhead()
      } else if (key === 'delete' || key === 'backspace') {
        deleteSelected()
      } else if (key === 'l') {
        dispatch({ type: 'set', patch: { loop: { ...s.loop, enabled: !s.loop.enabled } } })
      } else if (key === 'p') {
        loopSelected()
      } else if (key === 'm') {
        dispatch({ type: 'set', patch: { metronome: !s.metronome } })
      } else if (key === 'home' || key === 'enter') {
        seek(key === 'home' ? 0 : s.loop.start)
      } else if (key === '+' || key === '=') {
        dispatch({ type: 'set', patch: { zoom: Math.min(1200, s.zoom * 1.25) } })
      } else if (key === '-') {
        dispatch({ type: 'set', patch: { zoom: Math.max(4, s.zoom / 1.25) } })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, duplicateSelected, splitAtPlayhead, deleteSelected, loopSelected, seek])

  const readMaster = useCallback(() => engine.level(), [])
  const readRec = useCallback(() => rec?.handle.level() ?? 0, [rec])

  // --- render --------------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 bg-zinc-950/95 px-4 py-2">
        <div className="mr-2 flex items-baseline gap-2">
          <span className="bg-gradient-to-r from-fuchsia-400 to-cyan-300 bg-clip-text text-xl font-black tracking-tight text-transparent">
            MUCKE
          </span>
          <span className="hidden text-[10px] uppercase tracking-[0.3em] text-zinc-500 lg:inline">House DAW</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            className={`${btn} w-11 justify-center ${playing ? 'border-lime-400 text-lime-300' : ''}`}
            onClick={togglePlay}
            title="Play/Pause (Leertaste)"
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <button className={`${btn} w-11 justify-center`} onClick={stop} title="Stopp (zurück zum Startpunkt, 2× = Anfang)">
            ■
          </button>
          <button
            className={`${btn} ${state.loop.enabled ? 'border-fuchsia-400 bg-fuchsia-500/15 text-fuchsia-200' : ''}`}
            onClick={() => dispatch({ type: 'set', patch: { loop: { ...state.loop, enabled: !state.loop.enabled } } })}
            title="Loop an/aus (L) – Bereich im Lineal ziehen"
          >
            ⟲ Loop
          </button>
          <button
            className={`${btn} ${state.metronome ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200' : ''}`}
            onClick={() => dispatch({ type: 'set', patch: { metronome: !state.metronome } })}
            title="Metronom (M)"
          >
            ♩ Klick
          </button>
        </div>

        <div
          className="flex overflow-hidden rounded-md border border-zinc-700 text-xs font-bold"
          title="PAT spielt nur das aktuelle Pattern in Schleife, SONG spielt die Playlist"
        >
          {[
            ['pattern', 'PAT', 'bg-orange-400 text-zinc-900'],
            ['song', 'SONG', 'bg-lime-400 text-zinc-900'],
          ].map(([m, label, on]) => (
            <button
              key={m}
              className={`h-9 px-3 ${state.mode === m ? on : 'bg-zinc-900 text-zinc-400 hover:text-zinc-100'}`}
              onClick={() => dispatch({ type: 'set', patch: { mode: m } })}
            >
              {label}
            </button>
          ))}
        </div>

        <PositionDisplay engine={engine} playing={playing} playhead={state.playhead} bpm={state.bpm} />

        <div className="flex items-center gap-1">
          <label className="flex h-9 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 pl-2 text-sm">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">BPM</span>
            <input
              type="number"
              min={60}
              max={200}
              step={0.1}
              className="w-16 bg-transparent px-1 font-mono text-cyan-300 outline-none"
              value={state.bpm}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (v >= 40 && v <= 250) dispatch({ type: 'set', patch: { bpm: v } })
              }}
            />
          </label>
          <button className={btn} onClick={tapTempo} title="Im Takt klicken, um das Tempo zu bestimmen">
            Tap
          </button>
        </div>

        <label className="flex h-9 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Grid</span>
          <select
            className="bg-transparent font-mono outline-none"
            value={state.snap}
            onChange={(e) => dispatch({ type: 'set', patch: { snap: Number(e.target.value) } })}
          >
            {SNAP_OPTIONS.map((o) => (
              <option key={o.beats} value={o.beats} className="bg-zinc-900">
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1">
          <button
            className={`${btn} w-9 justify-center`}
            onClick={() => dispatch({ type: 'set', patch: { zoom: Math.max(4, state.zoom / 1.25) } })}
            title="Rauszoomen (-)"
          >
            −
          </button>
          <button
            className={`${btn} w-9 justify-center`}
            onClick={() => dispatch({ type: 'set', patch: { zoom: Math.min(1200, state.zoom * 1.25) } })}
            title="Reinzoomen (+)"
          >
            +
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button className={btn} onClick={() => dispatch({ type: 'undo' })} disabled={!state.past.length} title="Rückgängig (Strg+Z)">
            ↶
          </button>
          <button
            className={btn}
            onClick={() => dispatch({ type: 'redo' })}
            disabled={!state.future.length}
            title="Wiederholen (Strg+Shift+Z)"
          >
            ↷
          </button>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {rec ? (
            <div className="flex h-9 items-center gap-2 rounded-md border border-rose-500 bg-rose-500/10 px-3 text-sm text-rose-200">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
              REC <RecTimer handle={rec.handle} />
              <SilenceHint handle={rec.handle} />
              <LevelMeter read={readRec} className="w-16" />
              <button
                className="ml-1 rounded bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white hover:bg-rose-400"
                onClick={finishRecording}
              >
                Stopp
              </button>
            </div>
          ) : (
            <>
              {isDesktop && (
                <button
                  className={`${btn} border-rose-500 bg-rose-500/10 text-rose-100 hover:border-rose-300`}
                  onClick={() => setDesktopOpen(true)}
                  title="Ton einzelner Programme (z. B. Spotify) oder des ganzen Desktops aufnehmen"
                >
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Desktop / Apps
                </button>
              )}
              <button
                className={`${btn} border-rose-500/60 text-rose-200 hover:border-rose-400 ${isDesktop ? 'hidden' : ''}`}
                onClick={() => startRec('display')}
                disabled={!displayCaptureSupported()}
                title="Tab- oder System-Audio aufnehmen (Chrome/Edge: im Dialog „Tab-Audio teilen“ anhaken)"
              >
                <span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Tab-Audio
              </button>
              <button className={btn} onClick={() => startRec('mic')} title="Mikrofon / Line-In aufnehmen">
                🎤 Mic
              </button>
            </>
          )}
          <button
            className={`${btn} border-fuchsia-500/60 bg-fuchsia-500/10 text-fuchsia-100 hover:border-fuchsia-400`}
            onClick={() => setMashupOpen(true)}
            title="Mehrere Songs zu einem Track kombinieren, mit automatischer Anpassung und Vorschlägen"
          >
            ✨ Mashup
          </button>
          <button className={btn} onClick={() => fileInput.current.click()} title="Audiodatei importieren (oder in die Timeline ziehen)">
            ⇪ Import
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*"
            multiple
            hidden
            onChange={(e) => {
              importFiles([...e.target.files], stateRef.current.selectedTrackId)
              e.target.value = ''
            }}
          />
          <div className="flex">
            <button
              className={`${btn} rounded-r-none border-cyan-500/70 bg-cyan-500/10 text-cyan-100`}
              onClick={() => exportMix('song')}
              disabled={exporting || (state.mode === 'song' && !state.clips.length)}
              title={state.mode === 'pattern' ? 'Aktuelles Pattern als WAV herunterladen' : 'Ganzen Track als WAV herunterladen'}
            >
              {exporting ? '…' : '⬇'} Track WAV
            </button>
            <button
              className={`${btn} -ml-px rounded-l-none border-cyan-500/70 bg-cyan-500/10 text-cyan-100`}
              onClick={() => exportMix('loop')}
              disabled={exporting || (state.mode === 'song' && (!state.clips.length || state.loop.end <= state.loop.start))}
              title="Nur den Loop-Bereich exportieren (nahtlos loopbar)"
            >
              Loop
            </button>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex">
          <TrackHeaders state={state} dispatch={dispatch} />
          <div className="min-w-0 flex-1">
            <Timeline
              state={state}
              dispatch={dispatch}
              engine={engine}
              playing={playing && state.mode === 'song'}
              renderTick={renderTick}
              onSeek={seek}
              onDropFiles={importFiles}
            />
          </div>
        </div>
        <p className="px-4 py-3 text-xs leading-relaxed text-zinc-500">
          Lineal ziehen = Loop setzen · Doppelklick Lineal = Loop an/aus · Clip ziehen = verschieben (Alt = kopieren) · Kanten = trimmen ·
          Doppelklick Clip = schneiden · Shift = ohne Grid · Strg+Mausrad = Zoom · Leertaste Play · S Schneiden · Strg+D Duplizieren · P
          Loop auf Clip · Entf Löschen · Strg+Z Undo
        </p>
      </main>

      <section className="max-h-[55vh] shrink-0 overflow-y-auto border-t border-zinc-800 bg-zinc-950">
        <div className="sticky top-0 z-20 flex items-center gap-1 border-b border-zinc-800 bg-zinc-950 px-4 pt-2">
          {DOCKS.map((d) => (
            <button
              key={d.id}
              className={`rounded-t-md border border-b-0 px-3 py-1.5 text-xs font-semibold ${
                state.dock === d.id ? 'border-zinc-600 bg-zinc-800 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-200'
              }`}
              onClick={() => dispatch({ type: 'set', patch: { dock: d.id } })}
              title={`Taste ${d.key}`}
            >
              {d.label} <span className="font-mono text-[9px] text-zinc-500">{d.key}</span>
            </button>
          ))}
          <input
            ref={sampleInput}
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => {
              const f = e.target.files[0]
              if (f) loadSample(f)
              e.target.value = ''
            }}
          />
        </div>
        <div className="px-4 py-3">
          {state.dock === 'rack' && (
            <ChannelRack
              state={state}
              dispatch={dispatch}
              engine={engine}
              playing={playing}
              pattern={currentPattern}
              sampleOptions={sampleOptions}
              onLoadSample={() => sampleInput.current.click()}
              onAddToPlaylist={addPatternToPlaylist}
            />
          )}
          {state.dock === 'piano' && (
            <PianoRoll state={state} dispatch={dispatch} engine={engine} playing={playing} pattern={currentPattern} />
          )}
          {state.dock === 'mixer' && <Mixer state={state} dispatch={dispatch} engine={engine} />}
          {state.dock === 'fx' && (
            <div className="flex flex-col gap-4 xl:flex-row">
              <div className="min-w-0 flex-1 overflow-x-auto">
                <FxPanel track={selectedTrack} dispatch={dispatch} />
              </div>
              <div className="flex gap-4 xl:w-[26rem]">
                <div className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                  <ClipInspector
                    key={selectedClip?.id}
                    clip={selectedClip}
                    state={state}
                    bufferDuration={selectedClip ? (engine.buffers.get(selectedClip.bufferId)?.duration ?? 0) : 0}
                    onUpdate={(patch, record) => updateClip(selectedClip.id, patch, record)}
                    onSplit={splitAtPlayhead}
                    onDuplicate={duplicateSelected}
                    onLoopClip={loopSelected}
                    onDelete={deleteSelected}
                  />
                </div>
                <div className="flex flex-col items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Master</div>
                  <Knob
                    label="Volume"
                    value={state.master.volume}
                    min={0}
                    max={1.5}
                    defaultValue={0.9}
                    color="#22d3ee"
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => dispatch({ type: 'set', patch: { master: { ...state.master, volume: v } } })}
                  />
                  <LevelMeter read={readMaster} className="w-16" />
                  <button
                    className={`mt-1 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${state.master.limiter ? 'bg-cyan-400 text-zinc-900' : 'bg-zinc-800 text-zinc-400'}`}
                    onClick={() => dispatch({ type: 'set', patch: { master: { ...state.master, limiter: !state.master.limiter } } })}
                    title="Limiter verhindert Clipping im Export"
                  >
                    Limiter
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {isDesktop && <DesktopRecordDialog open={desktopOpen} onClose={() => setDesktopOpen(false)} onStart={startDesktopRec} notify={notify} />}

      <MashupStudio
        open={mashupOpen}
        onClose={closeMashup}
        state={state}
        notify={notify}
        onApply={applyMashup}
        stopTransport={stopTransport}
      />

      {toast && (
        <div
          key={toast.id}
          className={`fixed bottom-6 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-lg border px-4 py-3 text-sm shadow-2xl ${
            toast.kind === 'error' ? 'border-rose-500/60 bg-rose-950 text-rose-100' : 'border-zinc-700 bg-zinc-900 text-zinc-100'
          }`}
          onClick={() => setToast(null)}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
