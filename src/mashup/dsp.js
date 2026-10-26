// Small DSP toolbox for the in-browser song analysis (runs in a Web Worker and in Node tests).

const tables = new Map()

function fftTables(n) {
  let t = tables.get(n)
  if (t) return t
  const bits = Math.log2(n)
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
    rev[i] = r
  }
  const cos = new Float64Array(n / 2)
  const sin = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n)
    sin[i] = -Math.sin((2 * Math.PI * i) / n)
  }
  t = { rev, cos, sin }
  tables.set(n, t)
  return t
}

// In-place iterative radix-2 FFT. n must be a power of two.
export function fft(re, im) {
  const n = re.length
  const { rev, cos, sin } = fftTables(n)
  for (let i = 0; i < n; i++) {
    const j = rev[i]
    if (j > i) {
      let tmp = re[i]
      re[i] = re[j]
      re[j] = tmp
      tmp = im[i]
      im[i] = im[j]
      im[j] = tmp
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const step = n / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step]
        const wi = sin[k * step]
        const a = start + k
        const b = a + half
        const xr = re[b] * wr - im[b] * wi
        const xi = re[b] * wi + im[b] * wr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
      }
    }
  }
}

export function hann(n) {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
  return w
}

// Calls fn(frameIndex, magnitudes) for every STFT frame. Magnitudes has n/2+1 bins and is reused.
export function stft(signal, n, hop, fn) {
  const win = hann(n)
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  const mag = new Float64Array(n / 2 + 1)
  const frames = Math.max(0, Math.floor((signal.length - n) / hop) + 1)
  for (let f = 0; f < frames; f++) {
    const off = f * hop
    for (let i = 0; i < n; i++) {
      re[i] = signal[off + i] * win[i]
      im[i] = 0
    }
    fft(re, im)
    for (let k = 0; k <= n / 2; k++) mag[k] = Math.hypot(re[k], im[k])
    fn(f, mag)
  }
  return frames
}

export function mean(a, from = 0, to = a.length) {
  let s = 0
  for (let i = from; i < to; i++) s += a[i]
  return to > from ? s / (to - from) : 0
}

export function median(values) {
  const s = [...values].sort((a, b) => a - b)
  if (!s.length) return 0
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Linear interpolation into an array at a fractional index.
export function at(a, x) {
  if (x < 0 || x >= a.length - 1) return 0
  const i = Math.floor(x)
  const f = x - i
  return a[i] * (1 - f) + a[i + 1] * f
}
