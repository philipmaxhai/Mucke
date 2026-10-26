// Splits audio into four layers: drums, bass, music (chords/melody/vocals) and air (highs/atmosphere).
// Harmonic/percussive separation by median filtering of the spectrogram (Fitzgerald 2010):
// sustained tones form horizontal lines, hits form vertical lines. The tonal part is then split by frequency.
// Not studio-grade stems, but the four layers always add up to the original exactly.
import { fft } from './dsp.js'

export const STEMS = ['drums', 'bass', 'music', 'air']

const N = 4096
const HOP = 1024

// `beats`: beat times (seconds) inside the audio; a kick on a beat is moved from the bass layer to the drums.
export function separateStems(channels, sr, beats = [], onProgress = () => {}) {
  const chans = channels.length > 1 ? channels.slice(0, 2) : [channels[0], channels[0]]
  const len = chans[0].length
  const bins = N / 2 + 1
  const pad = N / 2
  const frames = Math.ceil((len + 2 * pad - N) / HOP) + 1
  const win = new Float64Array(N)
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)

  // forward STFT of both channels
  const spec = chans.map(() => ({ re: new Float32Array(frames * bins), im: new Float32Array(frames * bins) }))
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  for (let c = 0; c < 2; c++) {
    const x = chans[c]
    for (let f = 0; f < frames; f++) {
      const off = f * HOP - pad
      for (let i = 0; i < N; i++) {
        const j = off + i
        re[i] = j >= 0 && j < len ? x[j] * win[i] : 0
        im[i] = 0
      }
      fft(re, im)
      const base = f * bins
      for (let k = 0; k < bins; k++) {
        spec[c].re[base + k] = re[k]
        spec[c].im[base + k] = im[k]
      }
    }
    onProgress(0.15 + c * 0.15)
  }

  const mag = new Float32Array(frames * bins)
  for (let i = 0; i < mag.length; i++) {
    mag[i] = 0.5 * (Math.hypot(spec[0].re[i], spec[0].im[i]) + Math.hypot(spec[1].re[i], spec[1].im[i]))
  }

  // Harmonic: median along time (~0.4 s); percussive: median along frequency.
  const hT = Math.max(9, Math.round((0.4 * sr) / HOP)) | 1
  const pF = 17
  const harm = new Float32Array(frames * bins)
  const perc = new Float32Array(frames * bins)
  const tmp = new Float32Array(Math.max(hT, pF))
  for (let k = 0; k < bins; k++) {
    for (let f = 0; f < frames; f++) {
      let n = 0
      for (let d = -(hT >> 1); d <= hT >> 1; d++) {
        const g = f + d
        if (g >= 0 && g < frames) tmp[n++] = mag[g * bins + k]
      }
      harm[f * bins + k] = median(tmp, n)
    }
  }
  onProgress(0.5)
  for (let f = 0; f < frames; f++) {
    const base = f * bins
    for (let k = 0; k < bins; k++) {
      let n = 0
      for (let d = -(pF >> 1); d <= pF >> 1; d++) {
        const q = k + d
        if (q >= 0 && q < bins) tmp[n++] = mag[base + q]
      }
      perc[base + k] = median(tmp, n)
    }
  }
  onProgress(0.6)

  // frequency weights for the tonal split (they sum to 1 with the remaining "music" band)
  const binHz = sr / N
  const kickGate = kickEnvelope(mag, frames, bins, binHz, sr, beats)
  const low = new Float32Array(bins)
  const high = new Float32Array(bins)
  for (let k = 0; k < bins; k++) {
    const f = k * binHz
    low[k] = f <= 110 ? 1 : f >= 200 ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * (f - 110)) / 90)
    high[k] = f <= 4500 ? 0 : f >= 7000 ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * (f - 4500)) / 2500)
  }

  // inverse STFT per stem, weighted overlap-add
  const norm = new Float64Array(len + 2 * pad + N)
  for (let f = 0; f < frames; f++) for (let i = 0; i < N; i++) norm[f * HOP + i] += win[i] * win[i]
  const out = STEMS.map(() => [new Float32Array(len), new Float32Array(len)])
  const maskOf = (stem, f, k) => {
    const h = harm[f * bins + k] ** 2
    const p = perc[f * bins + k] ** 2
    let mh = h + p > 0 ? h / (h + p) : 0.5
    // a kick drum's low boom looks tonal, so hand it to the drums right after each kick
    if (low[k] > 0) mh *= 1 - kickGate[f] * low[k]
    if (stem === 0) return 1 - mh
    if (stem === 1) return mh * low[k]
    if (stem === 3) return mh * high[k]
    return mh * (1 - low[k] - high[k])
  }
  // Two real stems per inverse FFT: z = x + i*y, so Z = X + iY.
  const accX = new Float64Array(len + 2 * pad + N)
  const accY = new Float64Array(len + 2 * pad + N)
  for (const [sx, sy] of [
    [0, 1],
    [2, 3],
  ]) {
    for (let c = 0; c < 2; c++) {
      accX.fill(0)
      accY.fill(0)
      const { re: sr0, im: si0 } = spec[c]
      for (let f = 0; f < frames; f++) {
        const base = f * bins
        for (let k = 0; k < bins; k++) {
          const xr = sr0[base + k] * maskOf(sx, f, k)
          const xi = si0[base + k] * maskOf(sx, f, k)
          const yr = sr0[base + k] * maskOf(sy, f, k)
          const yi = si0[base + k] * maskOf(sy, f, k)
          // conjugated Z, so a forward FFT performs the inverse
          re[k] = xr - yi
          im[k] = -(xi + yr)
          if (k > 0 && k < N / 2) {
            re[N - k] = xr + yi
            im[N - k] = -(-xi + yr)
          }
        }
        fft(re, im)
        const off = f * HOP
        for (let i = 0; i < N; i++) {
          accX[off + i] += (re[i] / N) * win[i]
          accY[off + i] -= (im[i] / N) * win[i]
        }
      }
      for (let i = 0; i < len; i++) {
        const w = norm[i + pad]
        out[sx][c][i] = w > 1e-6 ? accX[i + pad] / w : 0
        out[sy][c][i] = w > 1e-6 ? accY[i + pad] / w : 0
      }
      onProgress(0.6 + 0.1 * (sx + c + 1))
    }
  }
  const result = {}
  STEMS.forEach((name, s) => (result[name] = channels.length > 1 ? out[s] : [out[s][0]]))
  return result
}

// Per frame: how much of the low end right now belongs to a kick (1 just after the hit, decaying over ~0.12 s).
function kickEnvelope(mag, frames, bins, binHz, sr, beats) {
  const gate = new Float32Array(frames)
  if (!beats.length) return gate
  const lowK = Math.max(2, Math.round(150 / binHz))
  const energy = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let e = 0
    for (let k = 1; k < lowK; k++) e += mag[f * bins + k] ** 2
    energy[f] = e
  }
  const frameOf = (t) => Math.round((t * sr) / HOP) // frame f is centred on sample f * HOP
  const tau = (0.12 * sr) / HOP
  for (const t of beats) {
    const f0 = frameOf(t)
    if (f0 < 0 || f0 >= frames) continue
    const before = energy[Math.max(0, f0 - 3)] + 1e-12
    const peak = Math.max(energy[f0], energy[Math.min(frames - 1, f0 + 1)])
    if (peak / before < 2.5) continue // no kick on this beat
    for (let f = Math.max(0, f0 - 1); f < Math.min(frames, f0 + Math.ceil(tau * 4)); f++) {
      gate[f] = Math.max(gate[f], f < f0 ? 0.5 : Math.exp(-(f - f0) / tau))
    }
  }
  return gate
}

function median(a, n) {
  // insertion sort is fastest for these tiny windows
  const b = a.subarray(0, n)
  for (let i = 1; i < n; i++) {
    const v = b[i]
    let j = i - 1
    while (j >= 0 && b[j] > v) {
      b[j + 1] = b[j]
      j--
    }
    b[j + 1] = v
  }
  return n % 2 ? b[n >> 1] : 0.5 * (b[(n >> 1) - 1] + b[n >> 1])
}
