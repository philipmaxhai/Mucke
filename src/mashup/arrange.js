// Mashup suggestions: picks sections from several analysed songs, fits them into a club-track structure
// and turns the result into beat-aligned timeline clips with DJ-style transitions.
import { bestShift, camelotDistance } from './keys.js'

export const LENGTHS = {
  kurz: [
    ['Intro', 8],
    ['Build-up', 8],
    ['Drop', 16],
    ['Break', 8],
    ['Build-up', 8],
    ['Drop', 16],
    ['Outro', 8],
  ],
  mittel: [
    ['Intro', 16],
    ['Groove', 8],
    ['Build-up', 8],
    ['Drop', 16],
    ['Break', 16],
    ['Build-up', 8],
    ['Drop', 16],
    ['Outro', 16],
  ],
  lang: [
    ['Intro', 16],
    ['Groove', 16],
    ['Build-up', 8],
    ['Drop', 32],
    ['Break', 16],
    ['Build-up', 8],
    ['Drop', 32],
    ['Groove', 16],
    ['Outro', 16],
  ],
}

// Which section types can stand in for a slot, best first.
const FALLBACK = {
  Intro: ['Intro', 'Groove', 'Break'],
  Groove: ['Groove', 'Drop', 'Intro'],
  'Build-up': ['Build-up', 'Break', 'Groove'],
  Drop: ['Drop', 'Groove'],
  Break: ['Break', 'Intro', 'Build-up'],
  Outro: ['Outro', 'Intro', 'Groove'],
}
const TARGET_ENERGY = { Intro: 0.4, Groove: 0.65, 'Build-up': 0.6, Drop: 1, Break: 0.25, Outro: 0.4 }

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

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

// How each song has to be changed to fit: tempo factor, pitch shift and level.
export function planSongs(songs, { targetBpm, baseId, matchKey }) {
  const base = songs.find((s) => s.id === baseId) ?? songs[0]
  const targetKey = base.analysis.key
  const quietest = Math.min(...songs.map((s) => s.analysis.loudness))
  return songs.map((s) => {
    const a = s.analysis
    const shift =
      matchKey && s !== base ? bestShift(a.key, targetKey) : { semis: 0, key: a.key, dist: camelotDistance(a.key, targetKey) }
    return {
      ...s,
      tempo: targetBpm / a.bpm,
      semis: shift.semis,
      key: shift.key,
      keyDist: shift.dist,
      gain: clamp(10 ** ((quietest - a.loudness) / 20), 0.35, 1),
    }
  })
}

function quality(label, sec) {
  const idx = FALLBACK[label].indexOf(sec.label)
  const match = idx < 0 ? 0.1 : [1, 0.6, 0.35][idx]
  return match - 0.5 * Math.abs(sec.energy - TARGET_ENERGY[label])
}

function candidates(plan) {
  return plan.flatMap((song) =>
    song.analysis.sections
      .map((sec, index) => ({ song, sec, index }))
      .filter((c) => c.sec.bars >= 4 && !song.excluded?.includes(c.index)),
  )
}

// Strategy helper: best candidate for a slot from `pool`, with penalties for repeats.
function picker(rnd, jitter) {
  const usedSection = new Map()
  const usedSong = new Map()
  let lastSong = null
  return (label, bars, pool, { spread = 0 } = {}) => {
    let best = null
    let bestScore = -Infinity
    for (const c of pool) {
      const key = `${c.song.id}:${c.index}`
      let score = quality(label, c.sec) + (c.sec.bars >= bars ? 0.08 : 0)
      score -= (usedSection.get(key) ?? 0) * 0.3
      score -= spread * (usedSong.get(c.song.id) ?? 0)
      if (spread && c.song.id === lastSong) score -= spread
      score += jitter * rnd() * 0.35
      if (score > bestScore) {
        bestScore = score
        best = c
      }
    }
    if (best) {
      const key = `${best.song.id}:${best.index}`
      usedSection.set(key, (usedSection.get(key) ?? 0) + 1)
      usedSong.set(best.song.id, (usedSong.get(best.song.id) ?? 0) + 1)
      lastSong = best.song.id
    }
    return best
  }
}

const STRATEGIES = [
  {
    key: 'pingpong',
    title: 'Ping-Pong',
    blurb: 'Die Songs wechseln sich Teil für Teil ab, jeder Übergang ist ein Song-Wechsel.',
    build(template, plan, pool, pick, rnd, baseId) {
      const order = [...plan].sort((a, b) => (a.id === baseId ? -1 : b.id === baseId ? 1 : 0))
      if (rnd() < 0.5 && order.length > 1 && pool.length) order.push(order.shift())
      return template.map(([label, bars], i) => {
        const song = order[i % order.length]
        const own = pool.filter((c) => c.song === song)
        return { label, bars, cand: pick(label, bars, own.length ? own : pool) }
      })
    },
  },
  {
    key: 'guestdrop',
    title: 'Basis + Gast-Drop',
    blurb: 'Der Basis-Song trägt Intro, Breaks und Outro, die Drops kommen aus den anderen Songs.',
    minSongs: 2,
    build(template, plan, pool, pick, rnd, baseId) {
      const base = pool.filter((c) => c.song.id === baseId)
      const guests = pool.filter((c) => c.song.id !== baseId)
      return template.map(([label, bars]) => {
        const from = label === 'Drop' ? guests : base
        return { label, bars, cand: pick(label, bars, from.length ? from : pool) }
      })
    },
  },
  {
    key: 'bestof',
    title: 'Best of',
    blurb: 'Für jeden Teil der passendste Abschnitt aus allen Songs, nach Energie-Kurve ausgewählt.',
    build(template, plan, pool, pick) {
      return template.map(([label, bars]) => ({ label, bars, cand: pick(label, bars, pool, { spread: 0.08 }) }))
    },
  },
  {
    key: 'layer',
    title: 'Layer-Mashup',
    blurb: 'Der Basis-Song läuft durch, darüber liegen Teile der anderen Songs (ohne Bass, damit nichts matscht).',
    minSongs: 2,
    build(template, plan, pool, pick, rnd, baseId) {
      const base = pool.filter((c) => c.song.id === baseId)
      return template.map(([label, bars]) => ({ label, bars, cand: pick(label, bars, base.length ? base : pool) }))
    },
    layers(slots, plan, pool, pick, rnd, baseId) {
      const guests = pool.filter((c) => c.song.id !== baseId)
      if (!guests.length) return []
      let drops = 0
      return slots.flatMap((slot, i) => {
        if (slot.label === 'Drop') drops++
        const wanted = slot.label === 'Groove' || slot.label === 'Break' || (slot.label === 'Drop' && drops >= 2)
        if (!wanted) return []
        const cand = pick(slot.label, slot.bars, guests)
        return cand ? [{ slot: i, cand }] : []
      })
    },
  },
]

export function suggest(plan, { length = 'mittel', seed = 1, baseId }) {
  const rnd = mulberry32(seed * 7919 + 13)
  const jitter = seed > 1 ? 1 : 0.1
  const template = LENGTHS[length]
  const pool = candidates(plan)
  if (!pool.length) return []
  const base = plan.find((s) => s.id === baseId) ?? plan[0]
  const seen = new Set()
  const out = []
  for (const st of STRATEGIES) {
    if (st.minSongs && plan.length < st.minSongs) continue
    const pick = picker(rnd, jitter)
    const slots = st.build(template, plan, pool, pick, rnd, base.id)
    if (slots.some((s) => !s.cand)) continue
    const layers = st.layers ? st.layers(slots, plan, pool, picker(rnd, jitter), rnd, base.id) : []
    const signature = slots.map((s) => `${s.cand.song.id}:${s.cand.index}`).join('|') + layers.length
    if (seen.has(signature)) continue
    seen.add(signature)
    out.push(describe({ key: st.key, title: st.title, blurb: st.blurb, slots, layers }, plan))
  }
  return out
}

function describe(sug, plan) {
  const used = [...new Set([...sug.slots, ...sug.layers].map((s) => s.cand.song))]
  const flow = sug.slots.reduce((s, x) => s + quality(x.label, x.cand.sec), 0) / sug.slots.length
  const keyOk = used.reduce((s, song) => s + (song.keyDist === 0 ? 1 : song.keyDist === 1 ? 0.85 : 0.3), 0) / used.length
  const tempoOk = used.reduce((s, song) => s + clamp(1 - Math.abs(song.tempo - 1) * 4, 0, 1), 0) / used.length
  const shiftOk = used.reduce((s, song) => s + clamp(1 - Math.abs(song.semis) * 0.08, 0, 1), 0) / used.length
  const score = Math.round(clamp(100 * (0.45 * flow + 0.25 * keyOk + 0.2 * tempoOk + 0.1 * shiftOk), 20, 99))

  const notes = [sug.blurb]
  const drops = sug.slots.filter((s) => s.label === 'Drop').map((s) => s.cand)
  if (drops.length) {
    const loudest = drops.reduce((a, b) => (b.sec.energy > a.sec.energy ? b : a))
    notes.push(`Stärkster Drop: ${loudest.song.letter} (Energie ${Math.round(loudest.sec.energy * 100)} %).`)
  }
  if (sug.layers.length) notes.push(`${sug.layers.length} Layer: ${[...new Set(sug.layers.map((l) => l.cand.song.letter))].join(', ')} läuft mit Hochpass über dem Basis-Song.`)
  const misfit = used.filter((s) => s.keyDist > 1)
  if (misfit.length) notes.push(`Achtung: ${misfit.map((s) => s.letter).join(', ')} passt tonal nicht ganz, klingt eher spannungsreich.`)
  return { ...sug, score, notes, songs: used.map((s) => s.id) }
}

// --- clips -------------------------------------------------------------------------

function fill(label, bars, sec) {
  if (sec.bars >= bars) return [{ startBar: label === 'Build-up' ? sec.startBar + sec.bars - bars : sec.startBar, bars }]
  const chunk = sec.bars >= 16 ? 16 : sec.bars >= 8 ? 8 : 4
  const from = label === 'Build-up' ? sec.startBar + sec.bars - chunk : sec.startBar
  const pieces = []
  for (let done = 0; done < bars; done += chunk) pieces.push({ startBar: from, bars: Math.min(chunk, bars - done) })
  return pieces
}

const songTime = (song, bar) => (song.analysis.downbeat + bar * song.analysis.barLen) / song.tempo

// Turns a suggestion into timeline clips. bufferIdFor(song) / trackIdFor(song) map songs to engine buffers and tracks.
export function buildArrangement(sug, { targetBpm, bufferIdFor, trackIdFor, makeId }) {
  const barLen = 240 / targetBpm
  const beat = barLen / 4
  const clips = []
  let bar = 0
  let prev = null
  for (const slot of sug.slots) {
    const { song, sec } = slot.cand
    for (const piece of fill(slot.label, slot.bars, sec)) {
      const offset = Math.max(0, songTime(song, piece.startBar))
      const clip = {
        id: makeId(),
        trackId: trackIdFor(song),
        bufferId: bufferIdFor(song),
        name: `${song.letter} · ${slot.label}`,
        start: bar * barLen,
        offset,
        length: piece.bars * barLen,
        rate: 1,
        gain: song.gain,
        fadeIn: 0,
        fadeOut: 0,
        inFx: null,
        outFx: null,
        label: slot.label,
        songId: song.id,
      }
      bar += piece.bars
      if (prev && prev.songId === song.id && Math.abs(prev.offset + prev.length - offset) < 0.02) {
        prev.length += clip.length // continues seamlessly in the source song
        continue
      }
      if (prev && prev.songId !== song.id) {
        if (slot.label === 'Drop') {
          // hard cut into the drop, the outgoing part gets thinned out with a high-pass sweep first
          prev.outFx = { type: 'hp', len: Math.min(2 * barLen, prev.length) }
        } else {
          // crossfade with bass swap: the incoming song starts early without bass, its bass drops in on the "1"
          let x = (slot.label === 'Build-up' ? 1 : 2) * barLen
          x = Math.min(x, Math.floor(clip.offset / beat) * beat, prev.length / 2)
          if (x >= beat) {
            clip.start -= x
            clip.offset -= x
            clip.length += x
            clip.fadeIn = x
            clip.inFx = { type: 'bass', len: x }
            prev.fadeOut = x
            prev.outFx = { type: 'hp', len: x }
          }
        }
      }
      clips.push(clip)
      prev = clip
    }
  }
  if (prev) prev.fadeOut = Math.min(4 * barLen, prev.length / 2)

  // layers: other songs on top, fading in and out over a bar
  const slotStart = []
  sug.slots.reduce((acc, s) => {
    slotStart.push(acc)
    return acc + s.bars
  }, 0)
  for (const layer of sug.layers) {
    const slot = sug.slots[layer.slot]
    let b = slotStart[layer.slot]
    for (const piece of fill(slot.label, slot.bars, layer.cand.sec)) {
      const len = piece.bars * barLen
      clips.push({
        id: makeId(),
        trackId: trackIdFor(layer.cand.song),
        bufferId: bufferIdFor(layer.cand.song),
        name: `${layer.cand.song.letter} · Layer`,
        start: b * barLen,
        offset: Math.max(0, songTime(layer.cand.song, piece.startBar)),
        length: len,
        rate: 1,
        gain: layer.cand.song.gain * 0.8,
        fadeIn: Math.min(barLen, len / 2),
        fadeOut: Math.min(barLen, len / 2),
        inFx: null,
        outFx: null,
        label: 'Layer',
        songId: layer.cand.song.id,
      })
      b += piece.bars
    }
  }
  const layerSongs = new Set(sug.layers.map((l) => l.cand.song.id))
  return { clips, layerSongs, duration: clips.reduce((m, c) => Math.max(m, c.start + c.length), 0) }
}
