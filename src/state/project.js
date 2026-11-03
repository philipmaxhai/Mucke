import { DEFAULT_FX } from '../audio/fx.js'
import { STEPS_PER_BAR } from '../audio/patterns.js'

export const TRACK_COLORS = ['#22d3ee', '#e879f9', '#a3e635', '#fb923c', '#f43f5e', '#818cf8', '#facc15', '#2dd4bf']

export const SNAP_OPTIONS = [
  { label: 'Aus', beats: 0 },
  { label: '1 Takt', beats: 4 },
  { label: '1/2', beats: 2 },
  { label: '1/4', beats: 1 },
  { label: '1/8', beats: 0.5 },
  { label: '1/16', beats: 0.25 },
]

let nextId = 1
export const uid = (prefix) => `${prefix}${Date.now().toString(36)}${(nextId++).toString(36)}`

export function makeTrack(index, name) {
  return {
    id: uid('t'),
    name: name ?? `Spur ${index + 1}`,
    color: TRACK_COLORS[index % TRACK_COLORS.length],
    mute: false,
    solo: false,
    fx: { ...DEFAULT_FX },
  }
}

export const PATTERN_COLORS = ['#fb923c', '#a3e635', '#22d3ee', '#e879f9', '#facc15', '#f43f5e', '#818cf8', '#2dd4bf']

export function makeChannel(kind, preset, name, insertId, extra = {}) {
  return { id: uid('ch'), kind, preset, name, insertId, volume: 0.8, pan: 0, pitch: 0, mute: false, solo: false, ...extra }
}

export function makePattern(index, bars = 1) {
  return {
    id: uid('p'),
    name: `Pattern ${index + 1}`,
    color: PATTERN_COLORS[index % PATTERN_COLORS.length],
    bars,
    swing: 0,
    steps: {},
    notes: {},
  }
}

const hits = (list, len = STEPS_PER_BAR) => Array.from({ length: len }, (_, i) => (list.includes(i) ? 1 : 0))

function defaultRack(tracks) {
  const [drums, bass, , fx, synth] = tracks
  const channels = [
    makeChannel('drum', 'kick', 'Kick', drums.id),
    makeChannel('drum', 'clap', 'Clap', drums.id),
    makeChannel('drum', 'hat', 'Hi-Hat', drums.id, { volume: 0.6 }),
    makeChannel('drum', 'openhat', 'Open Hat', drums.id, { volume: 0.55 }),
    makeChannel('drum', 'rim', 'Perc', fx.id, { volume: 0.5 }),
    makeChannel('synth', 'bass', 'Bass', bass.id, { root: 33 }),
    makeChannel('synth', 'organ', 'House-Orgel', synth.id, { root: 57, volume: 0.7 }),
  ]
  const [kick, clap, hat, ohat, , bassCh] = channels
  const p = makePattern(0)
  p.name = 'Beat'
  p.steps = {
    [kick.id]: hits([0, 4, 8, 12]),
    [clap.id]: hits([4, 12]),
    [hat.id]: hits([2, 6, 10, 14]),
    [ohat.id]: hits([]),
  }
  p.notes = { [bassCh.id]: [2, 6, 10, 14].map((s) => ({ id: uid('n'), p: 33, s, l: 2, v: 0.85 })) }
  return { channels, patterns: [p], currentPatternId: p.id }
}

export function initialState() {
  const tracks = ['Drums', 'Bass', 'Vocals', 'FX', 'Synth'].map((n, i) => makeTrack(i, n))
  const bar = (60 / 124) * 4
  return {
    ...defaultRack(tracks),
    mode: 'pattern', // 'pattern' loops the current pattern, 'song' plays the playlist (like FL's PAT/SONG)
    dock: 'rack', // which window is open at the bottom: rack | piano | mixer | fx
    pianoChannelId: null,
    bpm: 124,
    snap: 1,
    zoom: 60, // pixels per second
    metronome: false,
    tracks,
    clips: [],
    loop: { enabled: false, start: 0, end: bar * 4 },
    master: { volume: 0.9, limiter: true },
    playhead: 0,
    selectedTrackId: tracks[0].id,
    selectedClipId: null,
    past: [],
    future: [],
  }
}

const HISTORY = 100

export function reducer(state, a) {
  switch (a.type) {
    case 'set':
      return { ...state, ...a.patch }
    case 'setClips': {
      if (!a.record) return { ...state, clips: a.clips }
      const prev = a.prev ?? state.clips
      if (prev === a.clips) return state
      return {
        ...state,
        clips: a.clips,
        past: [...state.past, prev].slice(-HISTORY),
        future: [],
      }
    }
    case 'undo': {
      if (!state.past.length) return state
      const prev = state.past[state.past.length - 1]
      return { ...state, clips: prev, past: state.past.slice(0, -1), future: [state.clips, ...state.future] }
    }
    case 'redo': {
      if (!state.future.length) return state
      const [next, ...rest] = state.future
      return { ...state, clips: next, past: [...state.past, state.clips], future: rest }
    }
    case 'updateTrack':
      return {
        ...state,
        tracks: state.tracks.map((t) => (t.id === a.id ? { ...t, ...a.patch } : t)),
      }
    case 'updateFx':
      return {
        ...state,
        tracks: state.tracks.map((t) => (t.id === a.id ? { ...t, fx: { ...t.fx, ...a.patch } } : t)),
      }
    case 'addTrack': {
      const track = makeTrack(state.tracks.length)
      return { ...state, tracks: [...state.tracks, track], selectedTrackId: track.id }
    }
    case 'updateChannel':
      return { ...state, channels: state.channels.map((c) => (c.id === a.id ? { ...c, ...a.patch } : c)) }
    case 'addChannel':
      return { ...state, channels: [...state.channels, a.channel] }
    case 'removeChannel':
      return {
        ...state,
        channels: state.channels.filter((c) => c.id !== a.id),
        pianoChannelId: state.pianoChannelId === a.id ? null : state.pianoChannelId,
      }
    case 'updatePattern':
      return { ...state, patterns: state.patterns.map((p) => (p.id === a.id ? { ...p, ...a.patch } : p)) }
    case 'setSteps':
      return {
        ...state,
        patterns: state.patterns.map((p) => (p.id === a.id ? { ...p, steps: { ...p.steps, [a.channelId]: a.steps } } : p)),
      }
    case 'setNotes':
      return {
        ...state,
        patterns: state.patterns.map((p) => (p.id === a.id ? { ...p, notes: { ...p.notes, [a.channelId]: a.notes } } : p)),
      }
    case 'addPattern': {
      const src = a.cloneOf && state.patterns.find((p) => p.id === a.cloneOf)
      const p = makePattern(state.patterns.length, src?.bars ?? 1)
      if (src)
        Object.assign(p, { bars: src.bars, swing: src.swing, steps: { ...src.steps }, notes: { ...src.notes }, name: `${src.name} 2` })
      return { ...state, patterns: [...state.patterns, p], currentPatternId: p.id }
    }
    case 'removePattern': {
      if (state.patterns.length <= 1) return state
      const patterns = state.patterns.filter((p) => p.id !== a.id)
      const clips = state.clips.filter((c) => c.patternId !== a.id)
      return {
        ...state,
        patterns,
        clips,
        past: clips.length !== state.clips.length ? [...state.past, state.clips].slice(-HISTORY) : state.past,
        currentPatternId: state.currentPatternId === a.id ? patterns[0].id : state.currentPatternId,
      }
    }
    case 'removeTrack': {
      if (state.tracks.length <= 1) return state
      const tracks = state.tracks.filter((t) => t.id !== a.id)
      const clips = state.clips.filter((c) => c.trackId !== a.id)
      return {
        ...state,
        tracks,
        clips,
        past: clips.length !== state.clips.length ? [...state.past, state.clips].slice(-HISTORY) : state.past,
        channels: state.channels.map((c) => (c.insertId === a.id ? { ...c, insertId: tracks[0].id } : c)),
        selectedTrackId: state.selectedTrackId === a.id ? tracks[0].id : state.selectedTrackId,
      }
    }
    default:
      throw new Error(`unknown action ${a.type}`)
  }
}

// --- helpers -----------------------------------------------------------------

export const beatSec = (bpm) => 60 / bpm

export function snapTime(t, state, disabled = false) {
  if (disabled || !state.snap) return Math.max(0, t)
  const grid = beatSec(state.bpm) * state.snap
  return Math.max(0, Math.round(t / grid) * grid)
}

export function formatPosition(sec, bpm) {
  const beats = sec / beatSec(bpm)
  const bar = Math.floor(beats / 4) + 1
  const beat = Math.floor(beats % 4) + 1
  const six = Math.floor((beats * 4) % 4) + 1
  return `${bar}.${beat}.${six}`
}

export function formatTime(sec) {
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

export function splitClip(clip, at) {
  if (at <= clip.start + 0.005 || at >= clip.start + clip.length - 0.005) return null
  const leftLen = at - clip.start
  return [
    { ...clip, length: leftLen, fadeOut: 0, outFx: null },
    {
      ...clip,
      id: uid('c'),
      fadeIn: 0,
      inFx: null,
      start: at,
      offset: clip.offset + leftLen * clip.rate,
      length: clip.length - leftLen,
    },
  ]
}
