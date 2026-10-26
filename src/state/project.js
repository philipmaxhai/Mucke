import { DEFAULT_FX } from '../audio/fx.js'

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

export function initialState() {
  const tracks = ['Drums', 'Bass', 'Vocals', 'FX'].map((n, i) => makeTrack(i, n))
  const bar = (60 / 124) * 4
  return {
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
    case 'removeTrack': {
      if (state.tracks.length <= 1) return state
      const tracks = state.tracks.filter((t) => t.id !== a.id)
      const clips = state.clips.filter((c) => c.trackId !== a.id)
      return {
        ...state,
        tracks,
        clips,
        past: clips.length !== state.clips.length ? [...state.past, state.clips].slice(-HISTORY) : state.past,
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
