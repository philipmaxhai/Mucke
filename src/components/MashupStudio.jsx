import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_FX } from '../audio/fx.js'
import { engine } from '../audio/engine.js'
import { LENGTHS, buildArrangement, planSongs, suggest } from '../mashup/arrange.js'
import { analyzeBuffer, loopStems, stretchBuffer } from '../mashup/client.js'
import { ALL_KEYS, camelotLabel, keyName } from '../mashup/keys.js'
import {
  REGION_LABELS,
  ROLES,
  STYLES,
  TRACKS,
  buildNewSong,
  describeParams,
  impactSamples,
  pickRegions,
  riserSamples,
  sectionBars,
  sourcesFor,
  suggestNewSongs,
} from '../mashup/newsong.js'
import { formatTime, uid } from '../state/project.js'

const MAX_SONGS = 4
const LETTERS = ['A', 'B', 'C', 'D']
const SONG_COLORS = { A: '#f472b6', B: '#22d3ee', C: '#a3e635', D: '#fb923c' }
const LABEL_COLORS = {
  Intro: '#475569',
  Groove: '#0284c7',
  'Build-up': '#d97706',
  Drop: '#dc2626',
  Break: '#7c3aed',
  Outro: '#334155',
}

const btn =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-200 hover:border-zinc-500 disabled:opacity-40'
const primary =
  'inline-flex h-10 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-fuchsia-500 to-cyan-500 px-4 text-sm font-semibold text-white shadow-lg hover:brightness-110 disabled:opacity-40'

const pct = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v * 100).toFixed(1).replace('.', ',')} %`
const semisText = (s) => (s === 0 ? 'Tonhöhe bleibt' : `${s > 0 ? '+' : '−'}${Math.abs(s)} Halbton${Math.abs(s) === 1 ? '' : 'e'}`)

export function mashupTracks(plan, layerSongs = new Set()) {
  return plan.map((song) => ({
    id: `mx-${song.id}`,
    name: `${song.letter} · ${song.name}`.slice(0, 40),
    color: song.color,
    mute: false,
    solo: false,
    // layered songs lose their bass so they don't fight with the base song
    fx: { ...DEFAULT_FX, hp: layerSongs.has(song.id) ? 180 : 20 },
  }))
}

export function newSongTracks(clips) {
  return TRACKS.filter((t) => clips.some((c) => c.trackId === t.id)).map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    mute: false,
    solo: false,
    fx: { ...DEFAULT_FX, ...t.fx },
  }))
}

const rms = (buffer) => {
  let e = 0
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c)
    for (let i = 0; i < d.length; i += 4) e += d[i] * d[i]
  }
  return Math.sqrt(e / ((buffer.length / 4) * buffer.numberOfChannels))
}

function toBuffer(ctx, channels) {
  const b = ctx.createBuffer(channels.length, channels[0].length, ctx.sampleRate)
  channels.forEach((d, c) => b.copyToChannel(d, c))
  return b
}

function materialize(sug, { plan, lib, targetBpm, extras }, length) {
  const letters = new Map(plan.map((s) => [s.id, s.letter]))
  const arrangement = buildNewSong(sug.params, lib, { targetBpm, length, makeId: () => uid('c'), extras, letters })
  return { ...sug, ...describeParams(sug.params, plan), arrangement, tracks: newSongTracks(arrangement.clips) }
}

export default function MashupStudio({ open, onClose, state, notify, onApply, stopTransport }) {
  const [songs, setSongs] = useState([])
  const [settings, setSettings] = useState({ mode: 'song', baseId: null, bpm: '', matchKey: true, length: 'mittel', clarity: 0.6 })
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(null)
  const [audition, setAudition] = useState(null)
  const [preview, setPreview] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const stretched = useRef(new Map())
  const library = useRef(new Map())
  const fxBuffers = useRef(null)
  const auditionRef = useRef(null)
  const previewRef = useRef(null)
  const fileInput = useRef(null)
  const stateRef = useRef(state)
  stateRef.current = state

  const ready = songs.filter((s) => s.status === 'ready')
  const baseId = ready.some((s) => s.id === settings.baseId) ? settings.baseId : ready[0]?.id
  const base = ready.find((s) => s.id === baseId)
  const targetBpm = Number(settings.bpm) >= 60 && Number(settings.bpm) <= 200 ? Number(settings.bpm) : base ? base.analysis.bpm : 124
  // in song mode the length only rebuilds the arrangement, it does not need new stems
  const signature = JSON.stringify([ready.map((s) => [s.id, s.key, s.excluded]), baseId, targetBpm, settings.matchKey, settings.mode === 'song' ? settings.clarity : settings.length, settings.mode])
  const stale = result && result.signature !== signature

  const updateSong = useCallback((id, patch) => setSongs((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s))), [])

  // --- playback helpers ----------------------------------------------------------

  const stopAudition = useCallback(() => {
    const a = auditionRef.current
    auditionRef.current = null
    setAudition(null)
    try {
      a?.src.stop()
    } catch {
      // already ended
    }
  }, [])

  const stopPreview = useCallback(() => {
    const p = previewRef.current
    if (!p) return
    previewRef.current = null
    setPreview(null)
    if (engine.playing) engine.stop()
    engine.onStop = p.savedOnStop
    engine.syncTracks(stateRef.current.tracks, stateRef.current.bpm)
  }, [])

  useEffect(() => {
    if (!open) {
      stopPreview()
      stopAudition()
      return
    }
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, stopPreview, stopAudition])

  const playAudition = (song, index) => {
    const key = `${song.id}:${index}`
    const wasThis = auditionRef.current?.key === key
    stopAudition()
    stopPreview()
    if (wasThis) return
    stopTransport()
    const ctx = engine.ensure()
    const sec = song.analysis.sections[index]
    const src = ctx.createBufferSource()
    src.buffer = engine.buffers.get(song.bufferId)
    const g = ctx.createGain()
    g.gain.value = 0.9
    src.connect(g)
    g.connect(ctx.destination)
    src.start(0, Math.max(0, sec.start), sec.end - Math.max(0, sec.start))
    src.onended = () => {
      g.disconnect()
      if (auditionRef.current?.src === src) {
        auditionRef.current = null
        setAudition(null)
      }
    }
    auditionRef.current = { src, key }
    setAudition(key)
  }

  const playPreview = (sug, from = 0) => {
    stopAudition()
    stopTransport()
    const savedOnStop = previewRef.current ? previewRef.current.savedOnStop : engine.onStop
    engine.ensure()
    const tracks = sug.tracks
    const own = stateRef.current.tracks.filter((t) => !tracks.some((x) => x.id === t.id))
    engine.syncTracks([...own.map((t) => ({ ...t, mute: true, solo: false })), ...tracks], result.targetBpm)
    previewRef.current = { key: sug.key, savedOnStop }
    engine.onStop = () => stopPreview()
    engine.play({ clips: sug.arrangement.clips, bpm: result.targetBpm, loop: { enabled: false, start: 0, end: 0 }, metronome: false }, from)
    setPreview({ key: sug.key, duration: sug.arrangement.duration })
  }

  // --- songs -----------------------------------------------------------------------

  const songsRef = useRef(songs)
  songsRef.current = songs

  const addSong = (buffer, name, bufferId) => {
    const list = songsRef.current
    if (list.length >= MAX_SONGS) return notify(`Maximal ${MAX_SONGS} Songs pro Mashup.`)
    const letter = LETTERS.find((l) => !list.some((s) => s.letter === l))
    const song = { id: uid('s'), letter, color: SONG_COLORS[letter], name, bufferId, status: 'analyzing', progress: 0, excluded: [] }
    songsRef.current = [...list, song]
    setSongs((l) => [...l, song])
    analyzeBuffer(buffer, (p) => updateSong(song.id, { progress: p }))
      .then((analysis) => updateSong(song.id, { status: 'ready', analysis, key: analysis.key }))
      .catch((err) => updateSong(song.id, { status: 'error', error: err?.message || String(err) }))
  }

  const addFiles = async (files) => {
    engine.ensure()
    for (const file of files) {
      if (songsRef.current.length >= MAX_SONGS) break
      try {
        const buffer = await engine.decode(await file.arrayBuffer())
        const bufferId = uid('b')
        engine.addBuffer(bufferId, buffer)
        addSong(buffer, file.name.replace(/\.[^.]+$/, ''), bufferId)
      } catch {
        notify(`„${file.name}“ konnte nicht gelesen werden.`, 'error')
      }
    }
  }

  const timelineSources = []
  for (const clip of state.clips) {
    if (clip.songId || timelineSources.some((c) => c.bufferId === clip.bufferId)) continue
    if (songs.some((s) => s.bufferId === clip.bufferId)) continue
    timelineSources.push(clip)
  }

  const removeSong = (id) => {
    stopAudition()
    stopPreview()
    setSongs((list) => list.filter((s) => s.id !== id))
    setResult(null)
  }

  const toggleSection = (song, index) => {
    const excluded = song.excluded.includes(index) ? song.excluded.filter((i) => i !== index) : [...song.excluded, index]
    updateSong(song.id, { excluded })
  }

  // --- suggestions -------------------------------------------------------------------

  const generate = async (seed) => {
    if (!ready.length || busy) return
    stopAudition()
    stopPreview()
    const plan = planSongs(
      ready.map((s) => ({ ...s, analysis: { ...s.analysis, key: s.key } })),
      { targetBpm, baseId, matchKey: settings.matchKey },
    )
    if (settings.mode === 'song') return generateSong(seed, plan)
    try {
      const ctx = engine.ensure()
      const progress = new Map()
      const report = () => setBusy({ text: 'Passe Tempo und Tonart an …', p: [...progress.values()].reduce((a, b) => a + b, 0) / plan.length })
      report()
      await Promise.all(
        plan.map(async (song) => {
          const key = `${song.tempo.toFixed(5)}|${song.semis}`
          const cached = stretched.current.get(song.id)
          if (cached?.key === key) return progress.set(song.id, 1)
          let bufferId = song.bufferId
          if (Math.abs(song.tempo - 1) > 1e-4 || song.semis) {
            const out = await stretchBuffer(ctx, engine.buffers.get(song.bufferId), song.tempo, song.semis, (p) => {
              progress.set(song.id, p)
              report()
            })
            bufferId = uid('b')
            engine.addBuffer(bufferId, out)
          }
          // free the previous version unless the timeline still uses it
          if (cached && cached.bufferId !== song.bufferId && !stateRef.current.clips.some((c) => c.bufferId === cached.bufferId)) {
            engine.buffers.delete(cached.bufferId)
            engine.peaks.delete(cached.bufferId)
          }
          stretched.current.set(song.id, { key, bufferId })
          progress.set(song.id, 1)
          report()
        }),
      )
      const suggestions = suggest(plan, { length: settings.length, seed, baseId }).map((sug) => ({
        ...sug,
        arrangement: buildArrangement(sug, {
          targetBpm,
          bufferIdFor: (s) => stretched.current.get(s.id).bufferId,
          trackIdFor: (s) => `mx-${s.id}`,
          makeId: () => uid('c'),
        }),
      }))
      for (const sug of suggestions) sug.tracks = mashupTracks(plan.filter((s) => sug.songs.includes(s.id)), sug.arrangement.layerSongs)
      setResult({ mode: 'mashup', plan, targetBpm, suggestions, seed, signature })
    } catch (err) {
      notify(`Anpassen fehlgeschlagen: ${err?.message || err}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const freeBuffer = (id, keep) => {
    if (keep.has(id) || stateRef.current.clips.some((c) => c.bufferId === id)) return
    engine.buffers.delete(id)
    engine.peaks.delete(id)
  }

  // "Neuer Song": cut loops from every song, fit them to tempo/key, split them into layers, recombine.
  const generateSong = async (seed, plan) => {
    try {
      const ctx = engine.ensure()
      const barLen = 240 / targetBpm
      const jobs = []
      const fresh = new Map()
      const progress = new Map()
      const report = () =>
        setBusy({
          text: 'Passe Tempo und Tonart an und zerlege die Songs in Drums, Bass, Melodie und Atmo …',
          p: progress.size ? [...progress.values()].reduce((x, y) => x + y, 0) / progress.size : 1,
        })
      for (const song of plan) {
        const regions = pickRegions(song)
        const key = JSON.stringify([song.tempo.toFixed(5), song.semis, regions, settings.clarity])
        const cached = library.current.get(song.id)
        if (cached?.key === key) {
          fresh.set(song.id, cached)
          continue
        }
        const entry = { key, regions: {} }
        fresh.set(song.id, entry)
        const a = song.analysis
        const done = new Map()
        for (const [type, region] of Object.entries(regions)) {
          if (!region) continue
          const id = `${region.startBar}:${region.bars}`
          if (done.has(id)) {
            jobs.push(done.get(id).then((stems) => (entry.regions[type] = stems)))
            continue
          }
          const loopStart = a.downbeat + region.startBar * a.barLen
          const start = Math.max(0, loopStart - a.barLen)
          const job = loopStems(
            ctx,
            engine.buffers.get(song.bufferId),
            {
              start,
              end: Math.min(a.duration, loopStart + (region.bars + 1) * a.barLen),
              padBefore: loopStart - start,
              loopSeconds: region.bars * barLen,
              tempo: song.tempo,
              semis: song.semis,
              beatSec: barLen / 4,
              clarity: settings.clarity,
            },
            (p) => {
              progress.set(`${song.id}:${id}`, p)
              report()
            },
          ).then((buffers) => {
            const total = Math.sqrt(Object.values(buffers).reduce((s, b) => s + rms(b) ** 2, 0))
            const stems = {}
            for (const [name, buffer] of Object.entries(buffers)) {
              const bufferId = uid('b')
              engine.addBuffer(bufferId, buffer)
              const level = rms(buffer)
              stems[name] = { bufferId, rms: level, present: level > 0.003 && level > 0.12 * total, bars: region.bars, energy: region.energy }
            }
            return stems
          })
          done.set(id, job)
          progress.set(`${song.id}:${id}`, 0)
          jobs.push(job.then((stems) => (entry.regions[type] = stems)))
        }
      }
      report()
      await Promise.all(jobs)

      // free stems of older versions
      const keep = new Set()
      for (const entry of fresh.values()) for (const r of Object.values(entry.regions)) for (const st of Object.values(r)) keep.add(st.bufferId)
      for (const [id, entry] of library.current) {
        if (fresh.get(id) === entry) continue
        for (const r of Object.values(entry.regions)) for (const st of Object.values(r)) freeBuffer(st.bufferId, keep)
      }
      library.current = fresh

      if (fxBuffers.current?.bpm !== targetBpm) {
        if (fxBuffers.current) for (const id of [fxBuffers.current.riserId, fxBuffers.current.impactId]) freeBuffer(id, new Set())
        const riserId = uid('b')
        const impactId = uid('b')
        engine.addBuffer(riserId, toBuffer(ctx, riserSamples(ctx.sampleRate, 8 * barLen)))
        engine.addBuffer(impactId, toBuffer(ctx, impactSamples(ctx.sampleRate, 2 * barLen)))
        fxBuffers.current = { bpm: targetBpm, riserId, impactId }
      }

      const lib = new Map([...fresh].map(([id, e]) => [id, e.regions]))
      const ctxInfo = { plan, lib, targetBpm, extras: fxBuffers.current }
      const suggestions = suggestNewSongs(plan, lib, { seed }).map((sug) => materialize(sug, ctxInfo, settings.length))
      setResult({ mode: 'song', plan, targetBpm, suggestions, seed, signature, ...ctxInfo })
    } catch (err) {
      notify(`Neuer Song fehlgeschlagen: ${err?.message || err}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  // --- live editing of a "Neuer Song" suggestion ---------------------------------------

  const restartTimer = useRef(null)
  const updateParams = (key, patch) => {
    const r = result
    const old = r.suggestions.find((s) => s.key === key)
    const next = materialize({ ...old, params: { ...old.params, ...patch } }, r, settings.length)
    setResult({ ...r, suggestions: r.suggestions.map((s) => (s.key === key ? next : s)) })
    if (previewRef.current?.key === key) {
      clearTimeout(restartTimer.current)
      restartTimer.current = setTimeout(() => playPreview(next, engine.position()), 150)
    }
  }

  // length changes in song mode just rebuild the arrangements
  useEffect(() => {
    setResult((r) => (r?.mode === 'song' ? { ...r, suggestions: r.suggestions.map((s) => materialize(s, r, settings.length)) } : r))
    stopPreview()
  }, [settings.length, stopPreview])

  const apply = (sug) => {
    stopPreview()
    onApply({ tracks: sug.tracks, clips: sug.arrangement.clips, bpm: result.targetBpm })
    onClose()
  }

  if (!open) return null

  const planFor = (id) => (result && !stale ? result.plan.find((p) => p.id === id) : null)

  return (
    <div className="fixed inset-0 z-40 flex bg-black/70 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`relative m-auto flex h-full w-full max-w-6xl flex-col overflow-hidden border-zinc-800 bg-zinc-950 shadow-2xl sm:h-[94vh] sm:rounded-xl sm:border ${dragOver ? 'ring-2 ring-fuchsia-400' : ''}`}
        onDragOver={(e) => {
          if (![...e.dataTransfer.types].includes('Files')) return
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          addFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(f.name)))
        }}
      >
        <div className="flex items-start gap-3 border-b border-zinc-800 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-zinc-100">✨ Mashup-Studio</h2>
            <p className="text-xs leading-relaxed text-zinc-400">
              Lade 2–4 Songs. Die App erkennt Tempo, Tonart und Abschnitte, passt alles aneinander an und baut daraus Vorschläge für einen neuen Song.
              Alles läuft lokal in deinem Browser, ohne Cloud und ohne Kosten.
            </p>
          </div>
          <button className={`${btn} w-9 px-0`} onClick={onClose} title="Schließen (Esc)">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {/* 1. songs */}
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">1 · Songs</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {songs.map((song) => (
                <SongCard
                  key={song.id}
                  song={song}
                  isBase={song.id === baseId}
                  plan={planFor(song.id)}
                  targetBpm={targetBpm}
                  audition={audition}
                  onAudition={(i) => playAudition(song, i)}
                  onToggle={(i) => toggleSection(song, i)}
                  onKey={(key) => updateSong(song.id, { key })}
                  onBase={() => setSettings((s) => ({ ...s, baseId: song.id }))}
                  onRemove={() => removeSong(song.id)}
                />
              ))}
              {songs.length < MAX_SONGS && (
                <div className="flex min-h-[9rem] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 p-4 text-center">
                  <button className={btn} onClick={() => fileInput.current.click()}>
                    ⇪ Song-Datei hinzufügen
                  </button>
                  {timelineSources.length > 0 && (
                    <select
                      className="h-9 max-w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-300"
                      value=""
                      onChange={(e) => {
                        const clip = timelineSources.find((c) => c.bufferId === e.target.value)
                        if (clip) addSong(engine.buffers.get(clip.bufferId), clip.name, clip.bufferId)
                      }}
                    >
                      <option value="">… oder Aufnahme aus der Timeline</option>
                      {timelineSources.map((c) => (
                        <option key={c.bufferId} value={c.bufferId}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <p className="text-[11px] text-zinc-500">oder Dateien hier hineinziehen · MP3, WAV, M4A, OGG</p>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="audio/*"
                    multiple
                    hidden
                    onChange={(e) => {
                      addFiles([...e.target.files])
                      e.target.value = ''
                    }}
                  />
                </div>
              )}
            </div>
            {songs.length > 0 && (
              <p className="mt-2 text-[11px] text-zinc-500">
                Abschnitt anklicken = anhören · Rechtsklick = weglassen / wieder erlauben. Die Erkennung ist eine Schätzung, bei Bedarf Tonart von Hand korrigieren.
              </p>
            )}
          </section>

          {/* 2. settings */}
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">2 · Anpassen</h3>
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              {[
                ['song', '🎹 Neuer Song', 'Zerlegt die Songs in Drums, Bass, Melodie und Atmo und lässt sie gleichzeitig zusammenspielen, in einem eigenen Ablauf.'],
                ['mashup', '🔀 Mashup', 'Reiht ganze Teile der Songs aneinander, wie ein DJ-Mix mit Übergängen.'],
              ].map(([mode, title, text]) => (
                <button
                  key={mode}
                  className={`rounded-lg border p-3 text-left ${settings.mode === mode ? 'border-fuchsia-400 bg-fuchsia-500/10' : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-600'}`}
                  onClick={() => setSettings((s) => ({ ...s, mode }))}
                >
                  <div className="text-sm font-semibold text-zinc-100">{title}</div>
                  <div className="text-xs leading-relaxed text-zinc-400">{text}</div>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs text-zinc-400">
                Ziel-Tempo
                <span className="flex h-9 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 pl-2">
                  <input
                    type="number"
                    min={60}
                    max={200}
                    step={0.5}
                    placeholder={base ? String(base.analysis.bpm) : '124'}
                    className="w-16 bg-transparent font-mono text-cyan-300 outline-none placeholder:text-zinc-500"
                    value={settings.bpm}
                    onChange={(e) => setSettings((s) => ({ ...s, bpm: e.target.value }))}
                  />
                  <span className="pr-2 text-[10px] uppercase text-zinc-500">BPM</span>
                </span>
              </label>
              <label className="flex flex-col gap-1 text-xs text-zinc-400">
                Länge
                <span className="flex">
                  {Object.keys(LENGTHS).map((l, i) => {
                    const bars = settings.mode === 'song' ? sectionBars('club', l) : LENGTHS[l].reduce((a, s) => a + s[1], 0)
                    return (
                      <button
                        key={l}
                        className={`${btn} ${i ? '-ml-px rounded-l-none' : ''} ${i < 2 ? 'rounded-r-none' : ''} ${settings.length === l ? 'border-fuchsia-400 bg-fuchsia-500/15 text-fuchsia-100' : ''}`}
                        onClick={() => setSettings((s) => ({ ...s, length: l }))}
                        title={`${bars} Takte`}
                      >
                        {l[0].toUpperCase() + l.slice(1)} <span className="text-[10px] text-zinc-500">{formatTime((bars * 240) / targetBpm).slice(0, -3)}</span>
                      </button>
                    )
                  })}
                </span>
              </label>
              <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-200">
                <input type="checkbox" checked={settings.matchKey} onChange={(e) => setSettings((s) => ({ ...s, matchKey: e.target.checked }))} />
                Tonarten angleichen
              </label>
              {settings.mode === 'song' && (
                <label
                  className="flex flex-col gap-1 text-xs text-zinc-400"
                  title="Wie streng die Songs in Drums, Bass, Melodie und Atmo getrennt werden. Höher = klarer und weniger verwaschen, aber einzelne Schichten können etwas härter klingen."
                >
                  Klarheit der Trennung · {Math.round(settings.clarity * 100)} %
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings.clarity}
                    className="h-9 w-40"
                    onChange={(e) => setSettings((s) => ({ ...s, clarity: Number(e.target.value) }))}
                  />
                </label>
              )}
              <div className="ml-auto flex gap-2">
                {result && (
                  <button className={btn} onClick={() => generate(result.seed + 1)} disabled={!!busy} title="Andere Abschnitte und Reihenfolgen ausprobieren">
                    🎲 Neu würfeln
                  </button>
                )}
                <button className={primary} onClick={() => generate(result && !stale ? result.seed : 1)} disabled={!ready.length || !!busy}>
                  ✨ {result ? 'Vorschläge neu erzeugen' : settings.mode === 'song' ? 'Neue Songs vorschlagen' : 'Mashup-Vorschläge erzeugen'}
                </button>
              </div>
            </div>
            {ready.length === 1 && <p className="mt-2 text-xs text-amber-300/80">Mit nur einem Song entsteht ein Re-Edit. Für ein Mashup noch einen Song hinzufügen.</p>}
          </section>

          {/* 3. suggestions */}
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">3 · Vorschläge</h3>
            {busy && (
              <div className="mb-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300">
                {busy.text}
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-800">
                  <div className="h-full bg-gradient-to-r from-fuchsia-500 to-cyan-400 transition-all" style={{ width: `${Math.round(busy.p * 100)}%` }} />
                </div>
              </div>
            )}
            {!result && !busy && <p className="text-sm text-zinc-500">Noch keine Vorschläge. Songs hinzufügen und auf „Mashup-Vorschläge erzeugen“ klicken.</p>}
            {result && stale && !busy && <p className="mb-3 text-xs text-amber-300/80">Einstellungen geändert. Erzeuge die Vorschläge neu, damit sie passen.</p>}
            {result && !result.suggestions.length && <p className="text-sm text-zinc-500">Keine passenden Abschnitte gefunden. Erlaube mehr Abschnitte oder nimm längere Songs.</p>}
            {result && (
              <div className={`grid gap-3 lg:grid-cols-2 ${stale ? 'opacity-50' : ''}`}>
                {result.suggestions.map((sug) => (
                  <SuggestionCard
                    Card={result.mode === 'song' ? NewSongCard : null}
                    key={sug.key}
                    sug={sug}
                    plan={result.plan}
                    bpm={result.targetBpm}
                    previewing={preview?.key === sug.key}
                    onPlay={(from) => playPreview(sug, from)}
                    onStop={stopPreview}
                    onApply={() => apply(sug)}
                    onParams={(patch) => updateParams(sug.key, patch)}
                    lib={result.lib}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function SongCard({ song, isBase, plan, targetBpm, audition, onAudition, onToggle, onKey, onBase, onRemove }) {
  const a = song.analysis
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded font-black text-zinc-950" style={{ background: song.color }}>
          {song.letter}
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold text-zinc-100" title={song.name}>
          {song.name}
        </span>
        {song.status === 'ready' &&
          (isBase ? (
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-900" title="Tempo und Tonart richten sich nach diesem Song">
              Basis
            </span>
          ) : (
            <button className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400 hover:text-zinc-100" onClick={onBase}>
              als Basis
            </button>
          ))}
        <button className="px-1 text-zinc-500 hover:text-rose-300" onClick={onRemove} title="Entfernen">
          ✕
        </button>
      </div>

      {song.status === 'analyzing' && (
        <div className="text-xs text-zinc-400">
          Analysiere Tempo, Tonart und Abschnitte … {Math.round(song.progress * 100)} %
          <div className="mt-1 h-1 overflow-hidden rounded bg-zinc-800">
            <div className="h-full bg-cyan-400 transition-all" style={{ width: `${Math.round(song.progress * 100)}%` }} />
          </div>
        </div>
      )}
      {song.status === 'error' && <div className="text-xs text-rose-300">{song.error}</div>}

      {song.status === 'ready' && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-zinc-800 px-2 py-1 font-mono text-cyan-300" title={`Sicherheit ${a.bpmConfidence.toFixed(1)}`}>
              {a.bpm} BPM
            </span>
            <select
              className="rounded bg-zinc-800 px-1 py-1 font-mono text-fuchsia-200"
              value={`${song.key.tonic}-${song.key.mode}`}
              onChange={(e) => {
                const [tonic, mode] = e.target.value.split('-')
                onKey({ tonic: Number(tonic), mode })
              }}
              title="Erkannte Tonart (Camelot-Code für harmonisches Mixen). Bei Bedarf korrigieren."
            >
              {ALL_KEYS.map((k) => (
                <option key={`${k.tonic}-${k.mode}`} value={`${k.tonic}-${k.mode}`} className="bg-zinc-900">
                  {keyName(k)} · {camelotLabel(k)}
                </option>
              ))}
            </select>
            <span className="text-zinc-500">{formatTime(a.duration).slice(0, -3)}</span>
          </div>
          {plan && !isBase && (
            <div className="text-[11px] text-zinc-400">
              → {targetBpm} BPM ({pct(plan.tempo - 1)}) · {semisText(plan.semis)}
              {plan.semis !== 0 && ` → ${keyName(plan.key)} (${camelotLabel(plan.key)})`}
              {plan.keyDist <= 1 ? <span className="text-lime-300"> · passt harmonisch</span> : <span className="text-amber-300"> · tonal riskant</span>}
              {Math.abs(plan.tempo - 1) > 0.1 && <span className="text-amber-300"> · starkes Stretching</span>}
            </div>
          )}
          <EnergyLine values={a.barEnergy} />
          <div className="flex h-9 w-full gap-px overflow-hidden rounded">
            {a.sections.map((sec, i) => {
              const off = song.excluded.includes(i)
              const playing = audition === `${song.id}:${i}`
              return (
                <button
                  key={i}
                  className={`relative min-w-0 overflow-hidden px-1 text-left text-[10px] font-semibold leading-tight text-white/90 transition hover:brightness-125 ${
                    off ? 'opacity-25 line-through' : ''
                  } ${playing ? 'ring-2 ring-inset ring-white' : ''}`}
                  style={{ flexGrow: sec.bars, flexBasis: 0, background: LABEL_COLORS[sec.label] }}
                  onClick={() => onAudition(i)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    onToggle(i)
                  }}
                  title={`${sec.label} · ${sec.bars} Takte · Energie ${Math.round(sec.energy * 100)} %\nKlick: anhören · Rechtsklick: ${off ? 'wieder erlauben' : 'weglassen'}`}
                >
                  <span className="block truncate">{playing ? '■ ' : ''}{sec.label}</span>
                  <span className="block truncate font-normal text-white/60">{sec.bars} T</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function EnergyLine({ values }) {
  if (!values?.length) return null
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${20 - v * 18}`).join(' ')
  return (
    <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="h-5 w-full" aria-hidden>
      <polyline points={`0,20 ${pts} 100,20`} fill="rgba(34,211,238,0.12)" stroke="rgba(34,211,238,0.6)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function SuggestionCard({ Card, ...props }) {
  return Card ? <Card {...props} /> : <MashupCard {...props} />
}

function NewSongCard({ sug, plan, bpm, previewing, onPlay, onStop, onApply, onParams, lib }) {
  const [open, setOpen] = useState(false)
  const songOf = (id) => plan.find((s) => s.id === id)
  const { sections, duration, clips } = sug.arrangement
  const total = sections.reduce((a, s) => a + s.bars, 0)
  const rows = [...ROLES.filter((r) => clips.some((c) => c.role === r.key)), { key: 'fx', label: 'Riser / FX' }]
  return (
    <div className={`flex min-w-0 flex-col gap-3 rounded-lg border bg-zinc-900/60 p-3 ${previewing ? 'border-fuchsia-400' : 'border-zinc-800'}`}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold text-zinc-100">{sug.title}</span>
        <span className="text-xs text-zinc-500">{formatTime(duration).slice(0, -3)}</span>
        <span className="rounded bg-lime-400/15 px-2 py-0.5 text-xs font-semibold text-lime-300" title="Wie gut die Schichten harmonisch und rhythmisch zusammenpassen">
          {sug.score} % Match
        </span>
      </div>
      <div
        className="relative cursor-pointer"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          onPlay(Math.max(0, ((e.clientX - r.left - 64) / (r.width - 64)) * duration))
        }}
        title="Klick: ab hier anhören"
      >
        <div className="flex text-[9px] text-zinc-500">
          <span className="w-16 shrink-0" />
          {sections.map((sec, i) => (
            <span key={i} className="min-w-0 truncate px-0.5" style={{ flexGrow: sec.bars, flexBasis: 0 }}>
              {sec.name}
            </span>
          ))}
        </div>
        {rows.map((row) => (
          <div key={row.key} className="mt-px flex h-4 items-center">
            <span className="w-16 shrink-0 truncate pr-1 text-[9px] text-zinc-400">{row.label}</span>
            {sections.map((sec, i) => {
              const clip = clips.find((c) => c.role === row.key && c.start >= sec.start * (duration / total) - 0.01 && c.start < (sec.start + sec.bars) * (duration / total) - 0.01)
              const song = clip?.songId ? songOf(clip.songId) : null
              return (
                <span
                  key={i}
                  className="mr-px h-full min-w-0 overflow-hidden text-center text-[9px] font-bold leading-4 text-zinc-950"
                  style={{ flexGrow: sec.bars, flexBasis: 0, background: clip ? (song ? song.color : '#94a3b8') : 'rgba(255,255,255,0.04)', opacity: clip && clip.gain < 0.05 ? 0.6 : 1 }}
                >
                  {song?.letter ?? ''}
                </span>
              )
            })}
          </div>
        ))}
        {previewing && <PreviewHead duration={duration} inset={64} height={16 + rows.length * 17} />}
        <div className="mt-1 flex justify-between pl-16 text-[10px] text-zinc-500">
          <span>{total} Takte</span>
          <span>{bpm} BPM</span>
        </div>
      </div>
      <ul className="space-y-1 text-xs leading-relaxed text-zinc-400">
        {sug.notes.map((n, i) => (
          <li key={i}>• {n}</li>
        ))}
      </ul>
      {open && <SongControls params={sug.params} plan={plan} lib={lib} onParams={onParams} />}
      <div className="mt-auto flex flex-wrap gap-2">
        <button className={`${btn} ${open ? 'border-fuchsia-400 text-fuchsia-100' : ''}`} onClick={() => setOpen((o) => !o)} title="Stil, Quellen und Lautstärke jeder Schicht, Pumpen und Energie einstellen">
          ⚙ Regler
        </button>
        {previewing ? (
          <button className={`${btn} border-fuchsia-400 text-fuchsia-100`} onClick={onStop}>
            ■ Stopp
          </button>
        ) : (
          <button className={btn} onClick={() => onPlay(0)}>
            ▶ Anhören
          </button>
        )}
        <button className={`${btn} border-cyan-500/70 bg-cyan-500/10 text-cyan-100`} onClick={onApply} title="Ersetzt die Clips in der Timeline (Strg+Z macht es rückgängig)">
          ⤓ In Timeline übernehmen
        </button>
      </div>
    </div>
  )
}

function SongControls({ params, plan, lib, onParams }) {
  const letter = (id) => plan.find((s) => s.id === id)?.letter ?? '?'
  const id = (o) => (o ? `${o.song}|${o.region}` : '')
  const setSource = (role, value) => {
    if (!value) return onParams({ sources: { ...params.sources, [role]: null } })
    const [song, region] = value.split('|')
    const opt = sourcesFor(lib, plan, role).find((o) => o.song === song && o.region === region)
    onParams({ sources: { ...params.sources, [role]: opt } })
  }
  const range = 'h-4 w-full accent-fuchsia-400'
  return (
    <div className="space-y-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-300">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-zinc-500">Stil</span>
        {Object.entries(STYLES).map(([key, st]) => (
          <button
            key={key}
            className={`rounded border px-2 py-1 ${params.style === key ? 'border-fuchsia-400 bg-fuchsia-500/15 text-fuchsia-100' : 'border-zinc-700 hover:border-zinc-500'}`}
            onClick={() => onParams({ style: key, pump: STYLES[key].pump })}
            title={st.blurb}
          >
            {st.name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">Schicht</span>
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">kommt aus</span>
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">Lautstärke</span>
        {ROLES.map((role) => {
          const options = sourcesFor(lib, plan, role.key)
          const level = params.levels[role.key] ?? 1
          return [
            <span key={`${role.key}-l`} className="truncate">
              {role.label}
            </span>,
            <select
              key={`${role.key}-s`}
              className="h-7 min-w-0 rounded border border-zinc-700 bg-zinc-900 px-1"
              value={id(params.sources[role.key])}
              onChange={(e) => setSource(role.key, e.target.value)}
            >
              <option value="">– aus –</option>
              {options.map((o) => (
                <option key={id(o)} value={id(o)}>
                  Song {letter(o.song)} · {REGION_LABELS[o.region]}
                </option>
              ))}
            </select>,
            <span key={`${role.key}-v`} className="flex items-center gap-1">
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={level}
                className={range}
                onChange={(e) => onParams({ levels: { ...params.levels, [role.key]: Number(e.target.value) } })}
              />
              <span className="w-9 text-right font-mono text-[10px] text-zinc-500">{Math.round(level * 100)}%</span>
            </span>,
          ]
        })}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block" title="Bass und Flächen ducken sich bei jeder Kick weg, wie mit Sidechain-Kompressor. Macht den Mix klarer.">
          <span className="flex justify-between">
            <span>Pumpen (Sidechain)</span>
            <span className="font-mono text-zinc-500">{Math.round(params.pump * 100)}%</span>
          </span>
          <input type="range" min={0} max={0.8} step={0.05} value={params.pump} className={range} onChange={(e) => onParams({ pump: Number(e.target.value) })} />
        </label>
        <label className="block" title="Wenig = sparsamer, tiefer Groove. Viel = mehr Schichten, mehr Atmo, lautere Riser.">
          <span className="flex justify-between">
            <span>Energie</span>
            <span className="font-mono text-zinc-500">{Math.round(params.energy * 100)}%</span>
          </span>
          <input type="range" min={0} max={1} step={0.05} value={params.energy} className={range} onChange={(e) => onParams({ energy: Number(e.target.value) })} />
        </label>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={params.riser} onChange={(e) => onParams({ riser: e.target.checked })} />
          Riser & Impacts
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={params.sweeps} onChange={(e) => onParams({ sweeps: e.target.checked })} />
          Filter-Sweeps im Build-up
        </label>
      </div>
    </div>
  )
}

function MashupCard({ sug, plan, bpm, previewing, onPlay, onStop, onApply }) {
  const songOf = (id) => plan.find((s) => s.id === id)
  const total = sug.slots.reduce((a, s) => a + s.bars, 0)
  const duration = sug.arrangement.duration
  const layered = new Set(sug.layers.map((l) => l.slot))
  return (
    <div className={`flex min-w-0 flex-col gap-3 rounded-lg border bg-zinc-900/60 p-3 ${previewing ? 'border-fuchsia-400' : 'border-zinc-800'}`}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold text-zinc-100">{sug.title}</span>
        <span className="text-xs text-zinc-500">{formatTime(duration).slice(0, -3)}</span>
        <span className="rounded bg-lime-400/15 px-2 py-0.5 text-xs font-semibold text-lime-300" title="Wie gut Tempo, Tonart und Energie-Verlauf zusammenpassen">
          {sug.score} % Match
        </span>
      </div>
      <div
        className="relative cursor-pointer"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          onPlay(((e.clientX - r.left) / r.width) * duration)
        }}
        title="Klick: ab hier anhören"
      >
        <div className="flex h-10 gap-px overflow-hidden rounded">
          {sug.slots.map((slot, i) => {
            const song = songOf(slot.cand.song.id)
            return (
              <div
                key={i}
                className="relative min-w-0 overflow-hidden px-1 text-[10px] font-semibold leading-tight text-zinc-950"
                style={{ flexGrow: slot.bars, flexBasis: 0, background: song.color }}
              >
                <span className="block truncate">{song.letter}</span>
                <span className="block truncate font-normal">{slot.label}</span>
                {layered.has(i) && (
                  <span
                    className="absolute inset-x-0 bottom-0 h-1.5"
                    style={{ background: songOf(sug.layers.find((l) => l.slot === i).cand.song.id).color, boxShadow: '0 -1px 0 rgba(0,0,0,0.5)' }}
                  />
                )}
              </div>
            )
          })}
        </div>
        {previewing && <PreviewHead duration={duration} />}
        <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
          <span>{total} Takte</span>
          <span>{bpm} BPM</span>
        </div>
      </div>
      <ul className="space-y-1 text-xs leading-relaxed text-zinc-400">
        {sug.notes.map((n, i) => (
          <li key={i}>• {n}</li>
        ))}
      </ul>
      <div className="mt-auto flex gap-2">
        {previewing ? (
          <button className={`${btn} border-fuchsia-400 text-fuchsia-100`} onClick={onStop}>
            ■ Stopp
          </button>
        ) : (
          <button className={btn} onClick={() => onPlay(0)}>
            ▶ Anhören
          </button>
        )}
        <button className={`${btn} border-cyan-500/70 bg-cyan-500/10 text-cyan-100`} onClick={onApply} title="Ersetzt die Clips in der Timeline (Strg+Z macht es rückgängig)">
          ⤓ In Timeline übernehmen
        </button>
      </div>
    </div>
  )
}

function PreviewHead({ duration, inset = 0, height = 40 }) {
  const [pos, setPos] = useState(0)
  useEffect(() => {
    let raf
    const loop = () => {
      setPos(engine.position())
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div
      className="pointer-events-none absolute top-0 w-0.5 bg-white shadow-[0_0_6px_white]"
      style={{ height, left: `calc(${inset}px + (100% - ${inset}px) * ${Math.min(1, pos / duration)})` }}
    >
      <span className="absolute -top-4 -translate-x-1/2 rounded bg-zinc-100 px-1 font-mono text-[9px] text-zinc-900">{formatTime(pos).slice(0, -3)}</span>
    </div>
  )
}
