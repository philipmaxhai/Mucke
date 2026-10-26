// Tempo and pitch change for whole songs.
// Time-stretch uses WSOLA (overlap-add of waveform-similar grains), which keeps kicks punchy at the
// small ratios a mashup needs. Pitch shift = stretch by the pitch factor, then resample back.

export function stretchChannels(channels, sr, tempo, semis = 0, onProgress = () => {}) {
  const pitch = 2 ** (semis / 12)
  const alpha = pitch / tempo // WSOLA length factor
  let out = channels
  if (Math.abs(alpha - 1) > 1e-4) out = wsola(out, sr, alpha, (p) => onProgress(p * (semis ? 0.85 : 1)))
  if (semis) out = out.map((ch) => resample(ch, pitch))
  onProgress(1)
  return out
}

function wsola(channels, sr, alpha, onProgress) {
  const n = 2 * Math.round(0.023 * sr)
  const hs = n / 2
  const ha = hs / alpha
  const tol = Math.round(0.0115 * sr)
  const len = channels[0].length
  const outLen = Math.ceil(len * alpha)

  // decimated mono guide signal for the similarity search
  const dec = Math.max(1, Math.round(sr / 5512))
  const guide = new Float32Array(Math.floor(len / dec))
  for (let i = 0; i < guide.length; i++) {
    let s = 0
    for (let c = 0; c < channels.length; c++) for (let j = 0; j < dec; j++) s += channels[c][i * dec + j]
    guide[i] = s
  }

  const win = new Float32Array(n)
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
  const out = channels.map(() => new Float32Array(outLen + n))
  const norm = new Float32Array(outLen + n)

  const cmpLen = Math.floor(hs / dec)
  let prevStart = 0
  const frames = Math.ceil(outLen / hs) + 1
  for (let k = 0; k < frames; k++) {
    const outPos = k * hs
    let start = 0
    if (k > 0) {
      const tmpl = prevStart + hs
      const nominal = Math.round(k * ha)
      const lo = Math.max(0, nominal - tol)
      const hi = Math.min(len - n, nominal + tol)
      if (hi < lo || tmpl + hs >= len) break
      // coarse search on the guide signal
      const t0 = Math.floor(tmpl / dec)
      let bestD = Math.round(nominal / dec)
      let best = -Infinity
      for (let cd = Math.ceil(lo / dec); cd <= Math.floor(hi / dec); cd++) {
        let s = 0
        for (let j = 0; j < cmpLen; j++) s += guide[cd + j] * guide[t0 + j]
        if (s > best) {
          best = s
          bestD = cd
        }
      }
      // fine search at full resolution around the coarse hit
      start = Math.min(hi, Math.max(lo, bestD * dec))
      best = -Infinity
      const ref = channels[0]
      for (let c = Math.max(lo, bestD * dec - dec); c <= Math.min(hi, bestD * dec + dec); c++) {
        let s = 0
        for (let j = 0; j < hs; j += 2) s += ref[c + j] * ref[tmpl + j]
        if (s > best) {
          best = s
          start = c
        }
      }
    }
    for (let c = 0; c < channels.length; c++) {
      const src = channels[c]
      const dst = out[c]
      for (let i = 0; i < n && start + i < len; i++) dst[outPos + i] += src[start + i] * win[i]
    }
    for (let i = 0; i < n; i++) norm[outPos + i] += win[i]
    prevStart = start
    if (k % 500 === 0) onProgress(k / frames)
  }
  return out.map((dst) => {
    const res = new Float32Array(outLen)
    for (let i = 0; i < outLen; i++) res[i] = norm[i] > 0.05 ? dst[i] / Math.max(norm[i], 0.5) : dst[i]
    return res
  })
}

// Cubic (Catmull-Rom) resampling: plays `ch` `factor` times faster.
function resample(ch, factor) {
  const outLen = Math.floor(ch.length / factor)
  const out = new Float32Array(outLen)
  const last = ch.length - 1
  for (let i = 0; i < outLen; i++) {
    const x = i * factor
    const j = Math.floor(x)
    const t = x - j
    const y0 = ch[Math.max(0, j - 1)]
    const y1 = ch[j]
    const y2 = ch[Math.min(last, j + 1)]
    const y3 = ch[Math.min(last, j + 2)]
    out[i] = y1 + 0.5 * t * (y2 - y0 + t * (2 * y0 - 5 * y1 + 4 * y2 - y3 + t * (3 * (y1 - y2) + y3 - y0)))
  }
  return out
}
