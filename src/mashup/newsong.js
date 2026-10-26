// "Neuer Song": instead of putting whole parts of songs one after another, every song is split into layers
// (drums, bass, music, air) and the layers of different songs play *together* in a fresh arrangement.
// A suggestion is a set of editable params (style, which song/part feeds each layer, levels, pumping,
// energy, FX); buildNewSong turns params into clips, so every slider change rebuilds the song instantly.
import { camelotDistance, keyName } from './keys.js'

export const REGION_TYPES = ['drop', 'break', 'groove']
export const REGION_LABELS = { drop: 'Drop', break: 'Break', groove: 'Groove' }

// Musical roles in the new song: which stem they use and their default source part.
export const ROLES = [
  { key: 'intro', label: 'Intro-Drums', stem: 'drums', region: 'groove' },
  { key: 'drums', label: 'Drums', stem: 'drums', region: 'drop' },
  { key: 'bass', label: 'Bass', stem: 'bass', region: 'drop' },
  { key: 'hook', label: 'Hook', stem: 'music', region: 'drop' },
  { key: 'pad', label: 'Flächen / Vocals', stem: 'music', region: 'break' },
  { key: 'air', label: 'Atmo', stem: 'air', region: 'drop' },
]
const roleOf = (key) => ROLES.find((r) => r.key === key)

// target RMS per role, a little under full scale so the master limiter is not squashing everything
const LEVEL = { drums: 0.14, intro: 0.12, bass: 0.11, hook: 0.075, pad: 0.065, air: 0.028 }
// how strongly each role pumps against the kick (times the style's pump amount)
const DUCK = { bass: 1, pad: 1, hook: 0.6, air: 0.5 }

// Each layer gets its own space in the spectrum, otherwise stacked songs turn to mud in the low mids.
export const TRACKS = [
  { id: 'ns-drums', name: 'Drums', color: '#f43f5e', roles: ['drums', 'intro'], fx: {} },
  { id: 'ns-bass', name: 'Bass', color: '#a855f7', roles: ['bass'], fx: { lp: 320 } },
  { id: 'ns-hook', name: 'Hook', color: '#22d3ee', roles: ['hook'], fx: { hp: 180, eqMid: -1 } },
  { id: 'ns-pad', name: 'Flächen / Vocals', color: '#a3e635', roles: ['pad'], fx: { hp: 280, eqMid: -2, eqHigh: 1 } },
  { id: 'ns-air', name: 'Atmo', color: '#facc15', roles: ['air'], fx: { hp: 4500 } },
  { id: 'ns-fx', name: 'FX (Riser)', color: '#94a3b8', roles: [], fx: { hp: 60 } },
]
const trackFor = (role) => TRACKS.find((t) => t.roles.includes(role)).id

const S = (name, bars, layers, fx = {}) => ({ name, bars, layers, fx })

export const STYLES = {
  club: {
    name: 'Club-Track',
    blurb: 'Klassischer House-Aufbau: Groove, Build-up mit Riser, zwei Drops.',
    pump: 0.35,
    sections: [
      S('Intro', 16, { intro: 1, air: 0.8 }, { fadeIn: 4 }),
      S('Strophe', 16, { drums: 1, bass: 1, pad: 0.55, air: 0.8 }),
      S('Build-up', 8, { pad: 1, drums: 0.75 }, { sweep: true, riser: true }),
      S('Drop', 16, { drums: 1, bass: 1, hook: 1, air: 1 }, { impact: true }),
      S('Break', 16, { pad: 1, air: 1 }),
      S('Build-up', 8, { pad: 0.8, hook: 0.5, drums: 0.75 }, { sweep: true, riser: true }),
      S('Drop', 16, { drums: 1, bass: 1, hook: 1, air: 1 }, { impact: true }),
      S('Outro', 16, { drums: 1, air: 0.8 }, { fadeOut: 8 }),
    ],
  },
  deep: {
    name: 'Deep & Groovy',
    blurb: 'Weniger Effekte, mehr Groove: lange Bass-Passagen, starkes Pumpen, kein Riser.',
    pump: 0.55,
    sections: [
      S('Intro', 16, { intro: 1 }, { fadeIn: 4 }),
      S('Groove', 16, { intro: 1, bass: 0.9 }),
      S('Strophe', 16, { drums: 1, bass: 1, pad: 0.7 }),
      S('Drop', 16, { drums: 1, bass: 1, hook: 0.85, air: 0.6 }),
      S('Break', 8, { pad: 1, bass: 0.6, intro: 0.5 }, { sweep: true }),
      S('Drop', 16, { drums: 1, bass: 1, hook: 0.9, pad: 0.4 }),
      S('Outro', 16, { intro: 1, bass: 0.6 }, { fadeOut: 8 }),
    ],
  },
  festival: {
    name: 'Festival',
    blurb: 'Große Builds, Hook schon im Break, ein dritter Drop zum Schluss.',
    pump: 0.3,
    sections: [
      S('Intro', 8, { intro: 1, air: 1, hook: 0.3 }, { fadeIn: 4 }),
      S('Build-up', 8, { pad: 0.8, drums: 0.8 }, { sweep: true, riser: true }),
      S('Drop', 16, { drums: 1, bass: 1, hook: 1, air: 1 }, { impact: true }),
      S('Break', 16, { pad: 1, hook: 0.6, air: 1 }),
      S('Build-up', 8, { hook: 0.7, pad: 0.6, drums: 0.8 }, { sweep: true, riser: true }),
      S('Drop', 16, { drums: 1, bass: 1, hook: 1, air: 1 }, { impact: true }),
      S('Build-up', 8, { hook: 0.6, drums: 0.8 }, { sweep: true, riser: true }),
      S('Drop', 16, { drums: 1, bass: 1, hook: 1, air: 1, pad: 0.35 }, { impact: true }),
      S('Outro', 8, { drums: 1, air: 1 }, { fadeOut: 8 }),
    ],
  },
  vocal: {
    name: 'Vocal-Fokus',
    blurb: 'Flächen und Gesang stehen vorne, die Hook bleibt im Hintergrund.',
    pump: 0.4,
    sections: [
      S('Intro', 16, { intro: 1, pad: 0.5 }, { fadeIn: 4 }),
      S('Strophe', 16, { drums: 1, bass: 0.9, pad: 1 }),
      S('Build-up', 8, { pad: 1, drums: 0.7 }, { sweep: true, riser: true }),
      S('Drop', 16, { drums: 1, bass: 1, pad: 1, hook: 0.5, air: 0.8 }, { impact: true }),
      S('Break', 16, { pad: 1, air: 1 }),
      S('Build-up', 8, { pad: 1, drums: 0.7 }, { sweep: true, riser: true }),
      S('Drop', 16, { drums: 1, bass: 1, pad: 1, hook: 0.6, air: 0.8 }, { impact: true }),
      S('Outro', 16, { drums: 1, pad: 0.5 }, { fadeOut: 8 }),
    ],
  },
}

export const LENGTH_NAMES = ['kurz', 'mittel', 'lang']

// Same style in three lengths: kurz trims the calm parts, lang doubles the drops and adds a groove.
export function sectionsFor(style, length) {
  const base = STYLES[style].sections
  if (length === 'kurz') {
    return base
      .filter((s, i) => !(s.name === 'Strophe' && i > 1) && s.name !== 'Groove')
      .map((s) => ({ ...s, bars: s.name === 'Drop' || s.name === 'Build-up' ? s.bars : Math.min(8, s.bars) }))
  }
  if (length === 'lang') {
    const out = base.map((s) => (s.name === 'Drop' ? { ...s, bars: 32 } : s))
    out.splice(out.length - 1, 0, S('Groove', 16, { drums: 1, bass: 1, air: 0.8 }))
    return out
  }
  return base
}

export const sectionBars = (style, length) => sectionsFor(style, length).reduce((a, s) => a + s.bars, 0)

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

// library: songId -> { drop: { drums, bass, music, air }, break: {...}, groove: {...} }; each stem { bufferId, rms, present, bars, energy }
export function stemFor(library, role, source) {
  if (!source) return null
  return library.get(source.song)?.[source.region]?.[roleOf(role).stem] ?? null
}

// All sources a role can use (for the UI and the suggestion search).
export function sourcesFor(library, plan, role) {
  const out = []
  for (const song of plan) {
    for (const region of REGION_TYPES) {
      const st = stemFor(library, role, { song: song.id, region })
      if (st?.present && !out.some((o) => o.stem.bufferId === st.bufferId)) out.push({ song: song.id, region, stem: st })
    }
  }
  return out
}

export function defaultParams(style) {
  return { style, sources: {}, levels: Object.fromEntries(ROLES.map((r) => [r.key, 1])), pump: STYLES[style].pump, energy: 0.5, riser: true, sweeps: true }
}

export function suggestNewSongs(plan, library, { seed = 1 } = {}) {
  const rnd = mulberry32(seed * 104729 + 7)
  const jitter = seed > 1 ? 0.45 : 0.02
  const songs = plan.filter((s) => library.has(s.id))
  if (!songs.length) return []
  const songOf = (id) => songs.find((s) => s.id === id)
  const opts = Object.fromEntries(ROLES.map((r) => [r.key, sourcesFor(library, songs, r.key)]))
  if (!opts.drums.length || !opts.hook.length) return []

  const dropBass = opts.bass.filter((o) => o.region === 'drop')
  const bassOpts = dropBass.length ? dropBass : opts.bass.length ? opts.bass : [null]
  // every combination of drums / bass / hook / pad sources, scored for how well they fit together
  const combos = []
  for (const drums of opts.drums.filter((o) => o.region !== 'break'))
    for (const bass of bassOpts)
      for (const hook of opts.hook)
        for (const pad of opts.pad.length ? opts.pad : [null]) {
          if (pad && pad.stem.bufferId === hook.stem.bufferId) continue
          const s = (o) => (o ? songOf(o.song) : null)
          const used = new Set([drums, bass, hook, pad].filter(Boolean).map((o) => o.song))
          let score = 0
          if (songs.length > 1 && used.size === 1) score -= 1.2 // that's just the original song again
          score += 0.25 * (used.size - 1)
          if (bass) {
            const d = camelotDistance(s(bass).key, s(hook).key)
            score += bass.song === hook.song ? 0.35 : d === 0 ? 0.25 : d === 1 ? 0.05 : -0.9
          }
          if (pad) {
            const d = camelotDistance(s(pad).key, s(hook).key)
            score += pad.song === hook.song ? 0.15 : d === 0 ? 0.12 : d === 1 ? 0 : -0.7
          }
          if (bass && drums.song !== bass.song) score += 0.1
          score += 0.3 * hook.stem.energy + 0.15 * drums.stem.energy
          if (hook.region !== 'drop') score -= 0.1
          for (const id of used) score -= Math.abs(songOf(id).tempo - 1) * 1.5
          combos.push({ drums, bass, hook, pad, used, score })
        }

  // each style looks for a different kind of combination, so the suggestions really differ
  const styleBonus = {
    club: () => 0,
    deep: (c) => (c.bass && c.drums.song === c.bass.song ? 0.25 : 0) - 0.15 * c.hook.stem.energy,
    festival: (c) => 0.4 * c.hook.stem.energy + 0.1 * c.drums.stem.energy,
    vocal: (c) => (c.pad ? 0.3 + (c.pad.song !== c.drums.song ? 0.15 : 0) : -1),
  }
  const order = Object.keys(STYLES)
  if (seed > 1) order.sort(() => rnd() - 0.5)
  const taken = []
  const out = []
  for (const style of order) {
    let best = null
    let bestScore = -Infinity
    for (const c of combos) {
      let sc = c.score + styleBonus[style](c) + jitter * rnd()
      // penalise repeating a combination another suggestion already uses
      for (const t of taken) {
        if (t.drums === c.drums && t.hook === c.hook) sc -= 0.8
        else if (t.hook === c.hook || t.drums === c.drums) sc -= 0.25
      }
      if (sc > bestScore) {
        bestScore = sc
        best = c
      }
    }
    if (!best) continue
    taken.push(best)
    const params = defaultParams(style)
    const intro = opts.intro.find((o) => o.song === best.drums.song && o.region === 'groove') ?? best.drums
    const air = opts.air.find((o) => o.song === best.hook.song) ?? opts.air[0] ?? null
    params.sources = { drums: best.drums, intro, bass: best.bass, hook: best.hook, pad: best.pad, air }
    out.push({ key: `ns-${style}-${seed}`, params, baseScore: bestScore })
  }
  const max = Math.max(...out.map((o) => o.baseScore), 0.01)
  return out.map((o) => ({ ...o, score: Math.round(Math.min(99, Math.max(30, 62 + 37 * (o.baseScore / max)))) }))
}

// Title and explanation for the current params (recomputed after every slider change).
export function describeParams(params, plan) {
  const st = STYLES[params.style]
  const src = params.sources
  const song = (o) => (o ? plan.find((s) => s.id === o.song) : null)
  const L = (o) => song(o)?.letter ?? '–'
  const part = (o) => (o ? `${L(o)} (${REGION_LABELS[o.region]})` : 'aus')
  let title
  if (src.bass && src.drums.song === src.bass.song && src.drums.song === src.hook.song) {
    title = src.pad && src.pad.song !== src.hook.song ? `${L(src.hook)} mit Flächen/Vocals von ${L(src.pad)}` : `Re-Edit von ${L(src.hook)}`
  }
  else if (src.bass && src.drums.song === src.bass.song) title = `Groove von ${L(src.drums)} + Hook von ${L(src.hook)}`
  else if (src.bass && src.bass.song === src.hook.song) title = `Beat von ${L(src.drums)} + Bass & Hook von ${L(src.hook)}`
  else title = `Beat ${L(src.drums)} · Bass ${L(src.bass)} · Hook ${L(src.hook)}`
  const notes = [st.blurb, `Drums ${part(src.drums)} · Bass ${part(src.bass)} · Hook ${part(src.hook)} · Flächen ${part(src.pad)}.`]
  const hk = song(src.hook)
  if (src.bass && hk) {
    const bs = song(src.bass)
    const d = camelotDistance(bs.key, hk.key)
    notes.push(
      bs === hk
        ? `Bass und Hook aus demselben Song, harmonisch sicher (${keyName(hk.key)}).`
        : `Bass in ${keyName(bs.key)} unter Hook in ${keyName(hk.key)}: ${d <= 1 ? 'passt zusammen' : 'tonal gewagt'}.`,
    )
  }
  if (params.pump > 0.05) notes.push(`Sidechain-Pumpen ${Math.round(params.pump * 100)} %: Bass und Flächen machen Platz für die Kick.`)
  return { title: `${st.name}: ${title}`, notes }
}

// Clips for one set of params. extras: { riserId, impactId } procedurally generated FX buffers.
export function buildNewSong(params, library, { targetBpm, length = 'mittel', makeId, extras, letters = new Map() }) {
  const barLen = 240 / targetBpm
  const beat = barLen / 4
  const e = params.energy
  const clips = []
  const sections = []
  let bar = 0
  for (const sec of sectionsFor(params.style, length)) {
    const layers = { ...sec.layers }
    // energy: more layers and air when high, a sparser groove when low
    if (sec.name === 'Strophe' || sec.name === 'Groove') {
      if (e > 0.65) layers.hook = Math.max(layers.hook ?? 0, (e - 0.65) * 1.6)
      if (e < 0.3) delete layers.bass
    }
    if (layers.air) layers.air *= 0.6 + 0.8 * e
    const hasKick = layers.drums || layers.intro
    sections.push({ name: sec.name, start: bar, bars: sec.bars, layers: Object.keys(layers) })
    for (const [role, sectionGain] of Object.entries(layers)) {
      let stem = stemFor(library, role, params.sources[role])
      let source = params.sources[role]
      if (!stem?.present && role === 'intro') {
        source = params.sources.drums
        stem = stemFor(library, 'drums', source)
      }
      const gain = sectionGain * (params.levels[role] ?? 1)
      if (!stem?.present || gain <= 0.01) continue
      const level = Math.min(4, LEVEL[role] / Math.max(1e-4, stem.rms)) * gain
      const pump = hasKick && DUCK[role] ? params.pump * DUCK[role] : 0
      for (let b = 0; b < sec.bars; b += stem.bars) {
        const bars = Math.min(stem.bars, sec.bars - b)
        const len = bars * barLen
        const clip = {
          id: makeId(),
          trackId: trackFor(role),
          bufferId: stem.bufferId,
          name: `${letters.get(source.song) ?? ''} · ${roleOf(role).label}`,
          start: (bar + b) * barLen,
          offset: 0,
          length: len,
          rate: 1,
          gain: level,
          fadeIn: 0,
          fadeOut: 0,
          inFx: null,
          outFx: null,
          duck: pump > 0 ? { amount: Math.min(0.85, pump), beat } : null,
          songId: source.song,
          role,
        }
        if (b === 0 && sec.fx.fadeIn) clip.fadeIn = Math.min(len, sec.fx.fadeIn * barLen)
        if (sec.fx.fadeOut && b + stem.bars >= sec.bars) clip.fadeOut = Math.min(len, sec.fx.fadeOut * barLen)
        if (params.sweeps && sec.fx.sweep && (role === 'drums' || role === 'intro') && b + stem.bars >= sec.bars) clip.outFx = { type: 'hp', len }
        clips.push(clip)
      }
    }
    if (params.riser && sec.fx.riser && extras?.riserId) {
      clips.push(fxClip(makeId, extras.riserId, 'Riser', (bar + sec.bars - 8) * barLen, 8 * barLen, 0.5 + 0.6 * e))
    }
    if (params.riser && sec.fx.impact && extras?.impactId) {
      clips.push(fxClip(makeId, extras.impactId, 'Impact', bar * barLen, 2 * barLen, 0.5 + 0.5 * e))
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
