// Musical keys, the Camelot wheel DJs use for harmonic mixing, and key detection from a chroma vector.

export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']

// Krumhansl–Kessler key profiles.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

const mod12 = (n) => ((n % 12) + 12) % 12

export function keyName(key) {
  if (!key) return '?'
  return `${NOTE_NAMES[key.tonic]}${key.mode === 'minor' ? 'm' : ''}`
}

export function camelot(key) {
  const ref = key.mode === 'minor' ? 9 : 0 // A minor = 8A, C major = 8B
  const number = mod12(mod12((key.tonic - ref) * 7) + 7) + 1
  return { number, letter: key.mode === 'minor' ? 'A' : 'B' }
}

export const camelotLabel = (key) => {
  const c = camelot(key)
  return `${c.number}${c.letter}`
}

// Steps on the Camelot wheel: 0 = same key, 1 = neighbour / relative key (mixes cleanly).
export function camelotDistance(a, b) {
  const ca = camelot(a)
  const cb = camelot(b)
  const d = Math.abs(ca.number - cb.number)
  const ring = Math.min(d, 12 - d)
  return ca.letter === cb.letter ? ring : ring + 1
}

export const transpose = (key, semis) => ({ ...key, tonic: mod12(key.tonic + semis) })

// Smallest pitch shift that makes `key` harmonically compatible with `target`.
export function bestShift(key, target, maxShift = 5) {
  let best = null
  for (let s = -maxShift; s <= maxShift; s++) {
    const shifted = transpose(key, s)
    const dist = camelotDistance(shifted, target)
    const cost = dist <= 1 ? Math.abs(s) + dist * 0.5 : 100 + dist * 10 + Math.abs(s)
    if (!best || cost < best.cost) best = { semis: s, key: shifted, dist, cost }
  }
  return best
}

function pearson(a, b) {
  const ma = a.reduce((s, v) => s + v, 0) / a.length
  const mb = b.reduce((s, v) => s + v, 0) / b.length
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return da && db ? num / Math.sqrt(da * db) : 0
}

export function detectKey(chroma) {
  const scores = []
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [mode, profile] of [
      ['major', MAJOR],
      ['minor', MINOR],
    ]) {
      const rotated = profile.map((_, i) => profile[mod12(i - tonic)])
      scores.push({ tonic, mode, score: pearson(chroma, rotated) })
    }
  }
  scores.sort((a, b) => b.score - a.score)
  const [best, second] = scores
  return { tonic: best.tonic, mode: best.mode, confidence: Math.max(0, best.score - second.score) }
}

export const ALL_KEYS = Array.from({ length: 24 }, (_, i) => ({ tonic: i % 12, mode: i < 12 ? 'minor' : 'major' }))
