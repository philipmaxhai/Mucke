// Song analysis for the mashup studio: tempo + beat grid, downbeat, key and song sections.
// Tuned for four-on-the-floor music (House/Electro), which has a steady tempo and 8/16-bar phrases.
import { at, mean, stft } from './dsp.js'
import { detectKey } from './keys.js'

const N = 1024
const HOP = 512
const BANDS = [20, 60, 150, 400, 1000, 2500, 6000, 11000] // 7 bands between these edges

export const SECTION_LABELS = ['Intro', 'Groove', 'Build-up', 'Drop', 'Break', 'Outro']

export function analyzeSignal(mono, sr, onProgress = () => {}) {
  const duration = mono.length / sr
  if (duration < 8) throw new Error('Song ist zu kurz für eine Analyse (mindestens 8 Sekunden).')

  // --- spectral features ------------------------------------------------------
  const frames = Math.max(0, Math.floor((mono.length - N) / HOP) + 1)
  const fr = sr / HOP
  const onset = new Float64Array(frames)
  const highFlux = new Float64Array(frames)
  const lowFlux = new Float64Array(frames)
  const bands = Array.from({ length: BANDS.length - 1 }, () => new Float64Array(frames))
  const binHz = sr / N
  const bandBins = BANDS.map((f) => Math.min(N / 2, Math.round(f / binHz)))
  const highBin = Math.round(5000 / binHz)
  const lowBin = Math.round(180 / binHz)
  let prev = new Float64Array(N / 2 + 1)
  let cur = new Float64Array(N / 2 + 1)
  stft(mono, N, HOP, (f, mag) => {
    let flux = 0
    let hflux = 0
    let lflux = 0
    for (let k = 1; k <= N / 2; k++) {
      cur[k] = Math.log1p(1000 * mag[k])
      const d = cur[k] - prev[k]
      if (d > 0) {
        flux += d
        if (k >= highBin) hflux += d
        else if (k <= lowBin) lflux += d
      }
    }
    onset[f] = flux
    highFlux[f] = hflux
    lowFlux[f] = lflux
    for (let b = 0; b < bands.length; b++) {
      let e = 0
      for (let k = bandBins[b]; k < bandBins[b + 1]; k++) e += mag[k] * mag[k]
      bands[b][f] = e
    }
    ;[prev, cur] = [cur, prev]
    if (f % 2000 === 0) onProgress(0.1 + 0.4 * (f / frames))
  })
  const frameTime = (f) => (f * HOP + N / 2) / sr

  const env = normaliseOnset(onset, Math.round(fr * 0.4))

  // --- tempo -------------------------------------------------------------------
  const coarse = coarseTempo(env, fr)
  let grid = fineGrid(env, fr, coarse - 1.2, coarse + 1.2, 0.01)
  const rounded = Math.round(grid.bpm)
  if (Math.abs(rounded - grid.bpm) < 0.08) {
    // Most club tracks are produced at a whole-number tempo.
    const g = fineGrid(env, fr, rounded, rounded, 1)
    if (g.score >= grid.score * 0.97) grid = g
  }
  const bpm = grid.bpm
  const beat = 60 / bpm
  // Hi-hats often sit on the off-beats, so take the beat phase from the kick drum when there is one.
  const kick = fineGrid(normaliseOnset(lowFlux, Math.round(fr * 0.4)), fr, bpm, bpm, 1)
  const phase = kick.confidence > 1.6 ? kick.phase : grid.phase
  onProgress(0.6)

  let firstBeat = frameTime(phase) - N / 2 / sr / 2 // flux reacts within the first half of the window
  firstBeat += refineBeatPhase(mono, sr, firstBeat, beat)
  while (firstBeat - beat >= -0.02) firstBeat -= beat
  if (firstBeat < -0.02) firstBeat += beat

  // --- downbeat: the bar phase where song sections change most sharply -----------
  const bandMean = bands.map((b) => mean(b) || 1e-12)
  const bandFeat = (t0, t1) => {
    const f0 = Math.max(0, Math.floor((t0 * sr - N / 2) / HOP))
    const f1 = Math.min(frames, Math.ceil((t1 * sr - N / 2) / HOP))
    return bands.map((b, i) => Math.log10(1e-3 + mean(b, f0, Math.max(f0 + 1, f1)) / bandMean[i]))
  }
  const barLen = beat * 4
  // Beat-level novelty: how different the next 2 beats sound from the previous 2. Peaks mark section changes,
  // which happen on bar lines, so the beat phase (mod 4) that collects the strongest peaks is the downbeat.
  const beatFeats = []
  for (let t = firstBeat; t + beat <= duration; t += beat) beatFeats.push(bandFeat(t, t + beat))
  const W = 2
  const dbScore = [0, 0, 0, 0]
  const hfScore = [0, 0, 0, 0]
  const nov = new Float64Array(beatFeats.length)
  for (let b = W; b <= beatFeats.length - W; b++) {
    let d = 0
    for (let k = 0; k < bands.length; k++) {
      let before = 0
      let after = 0
      for (let j = 0; j < W; j++) {
        before += beatFeats[b - 1 - j][k]
        after += beatFeats[b + j][k]
      }
      d += ((after - before) / W) ** 2
    }
    nov[b] = Math.sqrt(d)
  }
  for (let b = 1; b < nov.length - 1; b++) {
    // only local maxima count, so a change is credited to exactly one beat
    if (nov[b] > nov[b - 1] && nov[b] >= nov[b + 1]) dbScore[b % 4] += nov[b] ** 2
    hfScore[b % 4] += at(highFlux, ((firstBeat + b * beat) * sr - N / 2) / HOP)
  }
  const maxNov = Math.max(...dbScore) || 1
  const maxHf = Math.max(...hfScore) || 1
  let p = 0
  for (let q = 1; q < 4; q++) {
    if (dbScore[q] / maxNov + 0.3 * (hfScore[q] / maxHf) > dbScore[p] / maxNov + 0.3 * (hfScore[p] / maxHf)) p = q
  }
  let downbeat = firstBeat + p * beat
  while (downbeat - barLen >= -0.02) downbeat -= barLen
  onProgress(0.7)

  // --- key -----------------------------------------------------------------------
  const key = detectKey(chromaVector(mono, sr))
  onProgress(0.85)

  // --- sections --------------------------------------------------------------------
  const barCount = Math.floor((duration - downbeat) / barLen)
  const bars = []
  for (let i = 0; i < barCount; i++) {
    const t = downbeat + i * barLen
    if (t + barLen > duration + 0.01) break
    const f0 = Math.max(0, Math.floor((t * sr - N / 2) / HOP))
    const f1 = Math.min(frames, Math.ceil(((t + barLen) * sr - N / 2) / HOP))
    let total = 0
    for (const b of bands) total += mean(b, f0, f1)
    const low = mean(bands[0], f0, f1) + mean(bands[1], f0, f1)
    bars.push({ t, feat: bandFeat(t, t + barLen), loud: 10 * Math.log10(1e-12 + total), low: 10 * Math.log10(1e-12 + low) })
  }
  const sections = findSections(bars, barLen)
  onProgress(1)

  const lo = percentile(bars.map((b) => b.loud), 0.05)
  const hi = percentile(bars.map((b) => b.loud), 0.95)
  return {
    duration,
    bpm,
    downbeat,
    barLen,
    key: { tonic: key.tonic, mode: key.mode },
    keyConfidence: key.confidence,
    bpmConfidence: grid.confidence,
    loudness: hi,
    barEnergy: bars.map((b) => clamp01((b.loud - lo) / Math.max(1e-6, hi - lo))),
    sections,
  }
}

// --- helpers -----------------------------------------------------------------------

const clamp01 = (v) => Math.min(1, Math.max(0, v))

function percentile(values, q) {
  const s = [...values].sort((a, b) => a - b)
  if (!s.length) return 0
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]
}

// Remove the slowly moving baseline so only the attacks remain.
function normaliseOnset(onset, win) {
  const out = new Float64Array(onset.length)
  let sum = 0
  const half = win >> 1
  for (let i = 0; i < Math.min(onset.length, half); i++) sum += onset[i]
  let count = Math.min(onset.length, half)
  for (let i = 0; i < onset.length; i++) {
    const add = i + half
    const rem = i - half - 1
    if (add < onset.length) {
      sum += onset[add]
      count++
    }
    if (rem >= 0) {
      sum -= onset[rem]
      count--
    }
    out[i] = Math.max(0, onset[i] - sum / count)
  }
  let max = 0
  for (const v of out) max = Math.max(max, v)
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] /= max
  return out
}

function coarseTempo(env, fr) {
  const maxLag = Math.ceil((60 * fr) / 50) * 2 + 2
  const ac = new Float64Array(maxLag + 1)
  for (let lag = 1; lag <= maxLag; lag++) {
    let s = 0
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag]
    ac[lag] = s / (env.length - lag)
  }
  let best = 120
  let bestScore = -Infinity
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const p = (60 * fr) / bpm
    const score = at(ac, p) + 0.5 * at(ac, 2 * p) + 0.25 * at(ac, p / 2)
    // Log-normal tempo prior around 122 BPM.
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 122) / 0.6) ** 2)
    if (score * prior > bestScore) {
      bestScore = score * prior
      best = bpm
    }
  }
  return best
}

// Comb search over tempo and phase: the grid whose beats sit on the strongest attacks across the whole song.
function fineGrid(env, fr, from, to, step) {
  const PHASES = 48
  let best = { bpm: from, phase: 0, score: -Infinity, confidence: 0 }
  for (let bpm = from; bpm <= to + 1e-9; bpm += step) {
    const period = (60 * fr) / bpm
    let rowBest = -Infinity
    let rowSum = 0
    let rowPhase = 0
    for (let ph = 0; ph < PHASES; ph++) {
      const phase = (ph / PHASES) * period
      let s = 0
      let n = 0
      for (let x = phase; x < env.length - 1; x += period) {
        s += at(env, x)
        n++
      }
      s /= n || 1
      rowSum += s
      if (s > rowBest) {
        rowBest = s
        rowPhase = phase
      }
    }
    if (rowBest > best.score) {
      best = { bpm: Math.round(bpm * 100) / 100, phase: rowPhase, score: rowBest, confidence: rowBest / (rowSum / PHASES) }
    }
  }
  return best
}

// Sub-frame alignment of the beat grid on the low-frequency (kick) envelope.
function refineBeatPhase(mono, sr, firstBeat, beat) {
  const hop = 32
  const n = Math.floor(mono.length / hop)
  const env = new Float64Array(n)
  // two one-pole low-pass filters at ~150 Hz
  const a = Math.exp((-2 * Math.PI * 150) / sr)
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < n; i++) {
    let e = 0
    for (let j = i * hop; j < (i + 1) * hop; j++) {
      y1 = (1 - a) * mono[j] + a * y1
      y2 = (1 - a) * y1 + a * y2
      e += y2 * y2
    }
    env[i] = Math.log10(1e-9 + e)
  }
  const rise = new Float64Array(n)
  for (let i = 2; i < n; i++) rise[i] = Math.max(0, env[i] - env[i - 2])
  const range = Math.round((0.03 * sr) / hop)
  let bestOff = 0
  let bestScore = -Infinity
  for (let o = -range; o <= range; o++) {
    let s = 0
    for (let t = firstBeat; t < mono.length / sr; t += beat) s += at(rise, (t * sr) / hop + o)
    if (s > bestScore) {
      bestScore = s
      bestOff = o
    }
  }
  // the envelope rise peaks slightly after the attack starts
  return (bestOff * hop) / sr - (1.5 * hop) / sr
}

function chromaVector(mono, sr) {
  const n = 8192
  const chroma = new Float64Array(12)
  const frameChroma = []
  const binHz = sr / n
  const lo = Math.ceil(65 / binHz)
  const hi = Math.min(n / 2, Math.floor(2100 / binHz))
  const pcs = new Int8Array(hi + 1)
  const weights = new Float64Array(hi + 1)
  for (let k = lo; k <= hi; k++) {
    const pitch = 12 * Math.log2((k * binHz) / 440) + 69
    const r = Math.round(pitch)
    pcs[k] = ((r % 12) + 12) % 12
    weights[k] = Math.cos(Math.PI * (pitch - r)) // favour bins close to a semitone centre
  }
  stft(mono, n, n / 2, (f, mag) => {
    const c = new Float64Array(12)
    let energy = 0
    for (let k = lo; k <= hi; k++) {
      c[pcs[k]] += Math.sqrt(mag[k]) * weights[k]
      energy += mag[k] * mag[k]
    }
    frameChroma.push({ c, energy })
  })
  const loud = percentile(
    frameChroma.map((f) => f.energy),
    0.3,
  )
  for (const { c, energy } of frameChroma) {
    if (energy < loud) continue
    const max = Math.max(...c) || 1
    for (let i = 0; i < 12; i++) chroma[i] += c[i] / max
  }
  return [...chroma]
}

function findSections(bars, barLen) {
  const m = bars.length
  if (m < 8) return [makeSection(bars, 0, m, barLen)]

  // z-normalised bar features
  const dims = bars[0].feat.length
  const mu = Array.from({ length: dims }, (_, d) => mean(bars.map((b) => b.feat[d])))
  const sd = Array.from({ length: dims }, (_, d) => Math.sqrt(mean(bars.map((b) => (b.feat[d] - mu[d]) ** 2))) || 1)
  const feat = bars.map((b) => [...b.feat.map((v, d) => (v - mu[d]) / sd[d]), (b.loud - mean(bars.map((x) => x.loud))) / 3])

  const avg = (from, to) => {
    const out = new Array(feat[0].length).fill(0)
    for (let i = from; i < to; i++) for (let d = 0; d < out.length; d++) out[d] += feat[i][d] / (to - from)
    return out
  }
  const score = new Float64Array(m)
  for (let i = 2; i <= m - 2; i++) {
    const w = Math.min(4, i, m - i)
    const a = avg(i - w, i)
    const b = avg(i, i + w)
    const dist = Math.sqrt(a.reduce((s, v, d) => s + (v - b[d]) ** 2, 0))
    score[i] = dist * (i % 8 === 0 ? 1.3 : i % 4 === 0 ? 1 : 0.45)
  }
  const vals = [...score].filter((v) => v > 0)
  const mu0 = mean(vals)
  const sd0 = Math.sqrt(mean(vals.map((v) => (v - mu0) ** 2)))
  const candidates = [...score.keys()].filter((i) => score[i] > mu0 + 0.3 * sd0).sort((a, b) => score[b] - score[a])
  const cuts = [0, m]
  for (const i of candidates) {
    const minDist = score[i] > mu0 + 1.5 * sd0 ? 4 : 8
    if (cuts.every((c) => Math.abs(c - i) >= minDist)) cuts.push(i)
  }
  cuts.sort((a, b) => a - b)
  // split very long parts on their strongest internal phrase boundary
  for (let k = 0; k < cuts.length - 1; k++) {
    const a = cuts[k]
    const b = cuts[k + 1]
    if (b - a <= 32) continue
    let best = -1
    for (let i = a + 8; i <= b - 8; i += 4) if (best < 0 || score[i] > score[best]) best = i
    if (best < 0) best = a + 16
    cuts.splice(k + 1, 0, best)
    k--
  }

  let sections = []
  for (let k = 0; k < cuts.length - 1; k++) sections.push(makeSection(bars, cuts[k], cuts[k + 1], barLen))
  sections = labelSections(sections, bars, barLen)
  return sections
}

function makeSection(bars, from, to, barLen) {
  return {
    startBar: from,
    bars: to - from,
    start: bars[from].t,
    end: bars[from].t + (to - from) * barLen,
    loud: mean(bars.slice(from, to).map((b) => b.loud)),
    low: mean(bars.slice(from, to).map((b) => b.low)),
  }
}

function labelSections(sections, bars, barLen) {
  const loudLo = percentile(bars.map((b) => b.loud), 0.05)
  const loudHi = percentile(bars.map((b) => b.loud), 0.95)
  const lowLo = percentile(bars.map((b) => b.low - b.loud), 0.05)
  const lowHi = percentile(bars.map((b) => b.low - b.loud), 0.95)
  for (const s of sections) {
    s.energy = clamp01((s.loud - loudLo) / Math.max(1e-6, loudHi - loudLo))
    s.bass = clamp01((s.low - s.loud - lowLo) / Math.max(1e-6, lowHi - lowLo))
    // Drops: loud *and* bass-heavy. Use absolute low-band level too, a quiet break can have a large bass share.
    const lowAbs = clamp01((s.low - loudLo) / Math.max(1e-6, loudHi - loudLo))
    s.label = s.energy >= 0.85 && (s.bass >= 0.45 || lowAbs >= 0.75) ? 'Drop' : null
  }
  const last = sections.length - 1
  sections.forEach((s, i) => {
    if (s.label) return
    if (i === 0) s.label = 'Intro'
    else if (i === last) s.label = 'Outro'
    else if (s.energy < 0.45) s.label = 'Break'
    else s.label = 'Groove'
  })
  // trailing low-energy parts after the last drop are outro, leading ones before the first drop intro
  const firstDrop = sections.findIndex((s) => s.label === 'Drop')
  if (firstDrop > 0) for (let i = 1; i < firstDrop; i++) if (sections[i].energy < 0.35 && sections[i - 1].label === 'Intro') sections[i].label = 'Intro'

  // build-ups: the part right before a drop; a long break gets its last 8 bars split off
  const out = []
  sections.forEach((s, i) => {
    const next = sections[i + 1]
    if (next?.label === 'Drop' && s.label !== 'Drop') {
      if (s.bars > 8 && s.label !== 'Intro') {
        const head = { ...makeSection(bars, s.startBar, s.startBar + s.bars - 8, barLen), energy: s.energy, bass: s.bass, label: s.label }
        const tail = { ...makeSection(bars, s.startBar + s.bars - 8, s.startBar + s.bars, barLen), energy: s.energy, bass: s.bass, label: 'Build-up' }
        out.push(head, tail)
        return
      }
      if (s.label !== 'Intro' || s.bars <= 8) s.label = 'Build-up'
    }
    out.push(s)
  })
  return out.map(({ loud, low, ...s }) => ({ ...s, energy: round2(s.energy), bass: round2(s.bass) }))
}

const round2 = (v) => Math.round(v * 100) / 100
