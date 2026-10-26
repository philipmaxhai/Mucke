// "Neuer Song": instead of putting whole parts of songs one after another, every song is split into layers
// (drums, bass, music, air) and the layers of different songs play *together* in a fresh arrangement.
import { camelotDistance, keyName } from './keys.js'

// Which loops we cut from each song. Each region yields all four layers.
export const REGION_TYPES = ['drop', 'break', 'groove']

// Musical roles in the new song and where they come from.
export const ROLES = [
  { key: 'drums', label: 'Drums', region: 'drop', stem: 'drums', color: '#f43f5e' },
  { key: 'bass', label: 'Bass', region: 'drop', stem: 'bass', color: '#a855f7' },
  { key: 'hook', label: 'Hook', region: 'drop', stem: 'music', color: '#22d3ee' },
  { key: 'pad', label: 'Flächen / Vocals', region: 'break', stem: 'music', color: '#a3e635' },
  { key: 'air', label: 'Atmo', region: 'drop', stem: 'air', color: '#facc15' },
  { key: 'intro', label: 'Intro-Drums', region: 'groove', stem: 'drums', color: '#fb923c' },
]

const LEVEL = { drums: 0.16, bass: 0.13, hook: 0.09, pad: 0.08, air: 0.035, intro: 0.13 } // target RMS per role

// Arrangement templates: [name, bars, { role: gain }, fx]
const S = (name, bars, layers, fx = {}) => ({ name, bars, layers, fx })
export const TEMPLATES = {
  kurz: [
    S('Intro', 8, { intro: 1, air: 1 }, { fadeIn: 4 }),
    S('Build-up', 8, { pad: 1, drums: 0.8 }, { sweep: true, riser: true }),
    S('Drop', 16, { drums: 1, bass: 1, hook: 1, air: 1 }, { impact: true }),
    S('Break', 8, { pad: 1, air: 1 }),
    S('Build-up', 8, { pad: 1, hook: 0.5, drums: 0.8 }, { sweep: true, riser: true }),
    S('Drop', 16, { drums: 1, bass: 1, hook: 1, pad: 0.45, air: 1 }, { impact: true }),
    S('Outro', 8, { drums: 1, air: 1 }, { fadeOut: 8 }),
  ],
  mittel: [
    S('Intro', 16, { intro: 1, air: 1 }, { fadeIn: 4 }),
    S('Strophe', 16, { drums: 1, bass: 1, pad: 0.6, air: 1 }),
    S('Build-up', 8, { pad: 1, drums: 0.8 }, { sweep: true, riser: true }),
    S('Drop', 16, { drums: 1, bass: 1, hook: 1, air: 1 }, { impact: true }),
    S('Break', 16, { pad: 1, air: 1 }),
    S('Build-up', 8, { pad: 1, hook: 0.5, drums: 0.8 }, { sweep: true, riser: true }),
    S('Drop', 16, { drums: 1, bass: 1, hook: 1, pad: 0.45, air: 1 }, { impact: true }),
    S('Outro', 16, { drums: 1, air: 1 }, { fadeOut: 8 }),
  ],
  lang: [
    S('Intro', 16, { intro: 1, air: 1 }, { fadeIn: 4 }),
    S('Strophe', 16, { drums: 1, bass: 1, pad: 0.6, air: 1 }),
    S('Build-up', 8, { pad: 1, drums: 0.8 }, { sweep: true, riser: true }),
    S('Drop', 32, { drums: 1, bass: 1, hook: 1, air: 1 }, { impact: true }),
    S('Break', 16, { pad: 1, air: 1 }),
    S('Build-up', 8, { pad: 1, hook: 0.5, drums: 0.8 }, { sweep: true, riser: true }),
    S('Drop', 32, { drums: 1, bass: 1, hook: 1, pad: 0.45, air: 1 }, { impact: true }),
    S('Strophe', 16, { drums: 1, bass: 1, air: 1 }),
    S('Outro', 16, { drums: 1, air: 1 }, { fadeOut: 8 }),
  ],
}

export const TRACKS = [
  { id: 'ns-drums', name: 'Drums', color: '#f43f5e', roles: ['drums', 'intro'] },
  { id: 'ns-bass', name: 'Bass', color: '#a855f7', roles: ['bass'] },
  { id: 'ns-hook', name: 'Hook', color: '#22d3ee', roles: ['hook'] },
  { id: 'ns-pad', name: 'Flächen / Vocals', color: '#a3e635', roles: ['pad'] },
  { id: 'ns-air', name: 'Atmo', color: '#facc15', roles: ['air'] },
  { id: 'ns-fx', name: 'FX (Riser)', color: '#94a3b8', roles: [] },
]
const trackFor = (role) => TRACKS.find((t) => t.roles.includes(role)).id

// Picks the loop regions (in the song's own time) for one analysed song.
export function pickRegions(song) {
  const secs = song.analysis.sections
    .map((sec, index) => ({ ...sec, index }))
    .filter((s) => s.bars >= 4 && !song.excluded?.includes(s.index))
  const loopOf = (sec) => {
    if (!sec) return null
    const bars = sec.bars >= 8 ? 8 : 4
    return { startBar: sec.startBar, bars, label: sec.label, energy: sec.energy }
  }
  const byEnergy = [...secs].sort((a, b) => b.energy - a.energy)
  const drop = byEnergy.find((s) => s.label === 'Drop') ?? byEnergy[0]
  const quiet = [...secs].sort((a, b) => a.energy - b.energy)
  const brk = secs.find((s) => s.label === 'Break') ?? quiet.find((s) => s !== drop) ?? drop
  const groove =
    secs.find((s) => (s.label === 'Groove' || s.label === 'Intro') && s !== drop && s.energy > 0.3) ??
    secs.find((s) => s.label === 'Drop' && s !== drop) ??
    drop
  return { drop: loopOf(drop), break: loopOf(brk), groove: loopOf(groove) }
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// library: songId -> { drop: { drums, bass, music, air }, break: {...}, groove: {...} }, each { bufferId, rms, present, bars, label }
export function suggestNewSongs(plan, library, { seed = 1 } = {}) {
  const rnd = mulberry32(seed * 104729 + 7)
  const jitter = seed > 1 ? 0.5 : 0.02
  const songs = plan.filter((s) => library.has(s.id))
  if (!songs.length) return []
  const layer = (song, role) => {
    const r = ROLES.find((x) => x.key === role)
    const lib = library.get(song.id)
    return lib[r.region]?.[r.stem]
  }
  const combos = []
  const ids = songs.map((s) => s)
  for (const drums of ids)
    for (const bass of ids)
      for (const hook of ids)
        for (const pad of ids) {
          const pick = { drums, bass, hook, pad, air: hook, intro: drums }
          if (!['drums', 'bass', 'hook'].every((r) => layer(pick[r], r)?.present)) continue
          if (!layer(pad, 'pad')?.present) pick.pad = hook
          const used = new Set(Object.values(pick).map((s) => s.id))
          let score = 0
          const notes = []
          if (songs.length > 1 && used.size === 1) score -= 1.2 // that's just the original song
          score += 0.25 * (used.size - 1)
          // harmony: bass, hook and pads must agree after the pitch shift
          const dBH = camelotDistance(pick.bass.key, pick.hook.key)
          const dHP = camelotDistance(pick.hook.key, pick.pad.key)
          score += pick.bass === pick.hook ? 0.35 : dBH === 0 ? 0.25 : dBH === 1 ? 0.05 : -0.8
          score += pick.hook === pick.pad ? 0.15 : dHP === 0 ? 0.12 : dHP === 1 ? 0 : -0.6
          // groove: drums and bass from different songs are the classic "new song" move, but bass needs room
          if (pick.drums !== pick.bass) score += 0.1
          score += 0.3 * layer(pick.hook, 'hook').energy + 0.15 * layer(pick.drums, 'drums').energy
          for (const s of used) score -= Math.abs(songs.find((x) => x.id === s).tempo - 1) * 1.5
          score += jitter * rnd()
          combos.push({ pick, score, used, dBH, dHP, notes })
        }
  combos.sort((a, b) => b.score - a.score)
  // keep variety: no two suggestions with the same drums + hook source
  const out = []
  for (const c of combos) {
    if (out.some((o) => o.pick.drums === c.pick.drums && o.pick.hook === c.pick.hook)) continue
    out.push(c)
    if (out.length >= 4) break
  }
  const maxScore = Math.max(...out.map((c) => c.score), 1)
  return out.map((c, i) => describe(c, songs.length, i, maxScore))
}

function describe(c, songCount, i, maxScore) {
  const { pick } = c
  const L = (s) => s.letter
  const title =
    pick.drums === pick.hook && pick.bass === pick.hook
      ? `Re-Edit von ${L(pick.hook)}`
      : pick.drums === pick.bass
        ? `Groove von ${L(pick.drums)} + Hook von ${L(pick.hook)}`
        : pick.bass === pick.hook
          ? `Beat von ${L(pick.drums)} + Bass & Hook von ${L(pick.hook)}`
          : `Beat ${L(pick.drums)} · Bass ${L(pick.bass)} · Hook ${L(pick.hook)}`
  const notes = [
    `Drums aus dem Drop von ${L(pick.drums)}, im Intro ein ruhigerer Groove aus demselben Song.`,
    pick.bass === pick.hook
      ? `Bass und Hook beide aus ${L(pick.hook)}, harmonisch sicher (${keyName(pick.hook.key)}).`
      : `Bass aus ${L(pick.bass)} (${keyName(pick.bass.key)}) unter der Hook von ${L(pick.hook)} (${keyName(pick.hook.key)})${c.dBH <= 1 ? ', passt zusammen' : ', tonal gewagt'}.`,
    pick.pad === pick.hook ? `Flächen im Break aus ${L(pick.pad)}.` : `Flächen und Vocals im Break kommen aus ${L(pick.pad)}.`,
  ]
  if (songCount > 1 && c.used.size === 1) notes.push('Nutzt nur einen Song, klingt eher wie ein Re-Edit.')
  const score = Math.round(Math.min(99, Math.max(30, 60 + 39 * (c.score / maxScore))))
  return { key: `ns-${i}-${Object.values(pick).map((s) => s.id).join('')}`, title, notes, pick, score, songs: [...c.used] }
}

// Clips for one suggestion. extras: { riserId, impactId } procedurally generated FX buffers.
export function buildNewSong(sug, library, { targetBpm, length = 'mittel', makeId, extras }) {
  const barLen = 240 / targetBpm
  const clips = []
  const template = TEMPLATES[length]
  let bar = 0
  const sections = []
  for (const sec of template) {
    sections.push({ name: sec.name, start: bar, bars: sec.bars, layers: Object.keys(sec.layers) })
    for (const [role, gain] of Object.entries(sec.layers)) {
      const r = ROLES.find((x) => x.key === role)
      let song = sug.pick[role]
      let lib = library.get(song.id)?.[r.region]?.[r.stem]
      if (!lib?.present && role === 'intro') {
        song = sug.pick.drums
        lib = library.get(song.id).drop.drums
      }
      if (!lib?.present) continue
      const level = Math.min(4, LEVEL[role] / Math.max(1e-4, lib.rms)) * gain
      const loopBars = lib.bars
      for (let b = 0; b < sec.bars; b += loopBars) {
        const bars = Math.min(loopBars, sec.bars - b)
        const first = b === 0
        const last = b + loopBars >= sec.bars
        const len = bars * barLen
        const clip = {
          id: makeId(),
          trackId: trackFor(role),
          bufferId: lib.bufferId,
          name: `${song.letter} · ${r.label}`,
          start: (bar + b) * barLen,
          offset: 0,
          length: len,
          rate: 1,
          gain: level,
          fadeIn: 0,
          fadeOut: 0,
          inFx: null,
          outFx: null,
          songId: song.id,
          role,
        }
        if (first && sec.fx.fadeIn) clip.fadeIn = Math.min(len, sec.fx.fadeIn * barLen)
        if (sec.fx.fadeOut && last) clip.fadeOut = Math.min(len, sec.fx.fadeOut * barLen)
        if (sec.fx.sweep && role === 'drums' && last) clip.outFx = { type: 'hp', len }
        clips.push(clip)
      }
    }
    if (sec.fx.riser && extras?.riserId) {
      clips.push(fxClip(makeId, extras.riserId, 'Riser', (bar + sec.bars - 8) * barLen, 8 * barLen, 0.9))
    }
    if (sec.fx.impact && extras?.impactId) {
      clips.push(fxClip(makeId, extras.impactId, 'Impact', bar * barLen, 2 * barLen, 0.9))
    }
    bar += sec.bars
  }
  return { clips, sections, duration: bar * barLen }
}

const fxClip = (makeId, bufferId, name, start, length, gain) => ({
  id: makeId(),
  trackId: 'ns-fx',
  bufferId,
  name,
  start: Math.max(0, start),
  offset: 0,
  length,
  rate: 1,
  gain,
  fadeIn: 0,
  fadeOut: 0,
  inFx: null,
  outFx: null,
  role: 'fx',
})

// Noise riser over `seconds`: rising level and brightness, ends right on the drop.
export function riserSamples(sr, seconds) {
  const n = Math.round(sr * seconds)
  const out = [new Float32Array(n), new Float32Array(n)]
  let s = 12345
  const lp = [0, 0]
  for (let i = 0; i < n; i++) {
    const x = i / n
    const cutoff = 300 * 40 ** x // 300 Hz -> 12 kHz
    const a = Math.exp((-2 * Math.PI * cutoff) / sr)
    const amp = 0.35 * x ** 2.2
    for (let c = 0; c < 2; c++) {
      s = (s * 16807) % 2147483647
      const noise = (s / 2147483647) * 2 - 1
      lp[c] = (1 - a) * noise + a * lp[c]
      out[c][i] = lp[c] * amp * 2.5
    }
  }
  return out
}

// Impact on the "1" of a drop: sub boom plus a decaying noise wash.
export function impactSamples(sr, seconds) {
  const n = Math.round(sr * seconds)
  const out = [new Float32Array(n), new Float32Array(n)]
  let s = 777
  let lp = 0
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const boom = 0.6 * Math.sin(2 * Math.PI * (45 * t + (60 * (1 - Math.exp(-t * 12))) / 12)) * Math.exp(-t * 3)
    s = (s * 16807) % 2147483647
    lp = 0.7 * ((s / 2147483647) * 2 - 1) + 0.3 * lp
    const wash = 0.18 * lp * Math.exp(-t * 1.6)
    out[0][i] = boom + wash
    out[1][i] = boom + wash * 0.9
  }
  return out
}
