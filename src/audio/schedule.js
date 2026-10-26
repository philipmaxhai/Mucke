const EDGE_FADE = 0.004

// Plays the part of `clip` that lies in timeline range [from, to) at context time `when`.
// Short fades at both ends avoid clicks at cut points and loop boundaries.
// Optional clip transitions (used by the mashup studio): fadeIn/fadeOut in seconds,
// inFx { type: 'bass', len } = bass cut for the first `len` seconds, then the bass drops in ("bass swap"),
// outFx { type: 'hp', len } = high-pass sweep over the last `len` seconds,
// duck { amount, beat } = sidechain-style pumping: the level dips on every beat (clip start = beat 1) and swells back.
export function schedulePart(ctx, buffer, clip, from, to, when, destination) {
  const s = Math.max(clip.start, from)
  const e = Math.min(clip.start + clip.length, to)
  const dur = e - s
  if (dur <= 0.0005) return null

  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.playbackRate.value = clip.rate
  const g = ctx.createGain()
  const level = clip.gain
  const fade = Math.min(EDGE_FADE, dur / 4)
  g.gain.setValueAtTime(0, when)
  g.gain.linearRampToValueAtTime(level, when + fade)
  g.gain.setValueAtTime(level, when + dur - fade)
  g.gain.linearRampToValueAtTime(0, when + dur)

  const nodes = [g]
  const a = s - clip.start // clip-local window
  const b = e - clip.start
  const fadeIn = Math.min(clip.fadeIn || 0, clip.length)
  const fadeOut = Math.min(clip.fadeOut || 0, clip.length - fadeIn)
  if (fadeIn > 0 || fadeOut > 0) {
    const env = ctx.createGain()
    const pts = []
    if (fadeIn > 0) pts.push([0, 0], [fadeIn, 1])
    else pts.push([0, 1])
    if (fadeOut > 0) pts.push([clip.length - fadeOut, 1], [clip.length, 0])
    else pts.push([clip.length, 1])
    automate(env.gain, pts, a, b, when, false)
    nodes.push(env)
  }
  const inLen = clip.inFx?.type === 'bass' ? Math.min(clip.inFx.len, clip.length) : 0
  if (inLen > 0 && a < inLen) {
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.Q.value = 0.7
    hp.frequency.setValueAtTime(300, when)
    hp.frequency.setValueAtTime(10, when + (inLen - a))
    nodes.push(hp)
  }
  const outLen = clip.outFx?.type === 'hp' ? Math.min(clip.outFx.len, clip.length) : 0
  if (outLen > 0 && b > clip.length - outLen) {
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.Q.value = 0.9
    automate(hp.frequency, [[0, 10], [clip.length - outLen, 10], [clip.length, 1200]], a, b, when, true)
    nodes.push(hp)
  }

  if (clip.duck?.amount > 0 && clip.duck.beat > 0) {
    const pump = ctx.createGain()
    schedulePump(pump.gain, clip.duck.amount, clip.duck.beat, a, b, when)
    nodes.push(pump)
  }

  let prev = src
  for (const node of nodes) {
    prev.connect(node)
    prev = node
  }
  prev.connect(destination)

  const offset = clip.offset + (s - clip.start) * clip.rate
  src.start(when, offset, dur * clip.rate)
  src.onended = () => nodes.forEach((node) => node.disconnect())
  return src
}

const ATTACK = 0.004

// Level of the pump `u` seconds after a beat.
function pumpAt(u, amount, beat) {
  const dip = 1 - amount
  if (u < ATTACK) return 1 - (amount * u) / ATTACK
  const rec = beat * 0.2
  return dip + (1 - dip) * (1 - Math.exp(-(u - ATTACK) / rec))
}

function schedulePump(param, amount, beat, a, b, when) {
  const span = beat * 0.9 // leave a gap before the next beat so curves never overlap
  const steps = 48
  const curveFrom = (u0) => {
    const c = new Float32Array(steps)
    for (let i = 0; i < steps; i++) c[i] = pumpAt(u0 + ((span - u0) * i) / (steps - 1), amount, beat)
    return c
  }
  const since = ((a % beat) + beat) % beat
  if (since < span - 0.01) param.setValueCurveAtTime(curveFrom(since), when, Math.min(span - since, b - a))
  else param.setValueAtTime(pumpAt(since, amount, beat), when)
  for (let t = Math.ceil(a / beat - 1e-9) * beat; t < b - 0.01; t += beat) {
    if (t <= a + 1e-6) continue
    // the curve must end before the window ends, otherwise it would outlive this scheduled part
    param.setValueCurveAtTime(curveFrom(0), when + t - a, Math.min(span, b - t))
  }
}

// Schedules a piecewise curve (points in clip-local seconds) for the window [a, b] starting at context time `when`.
function automate(param, pts, a, b, when, exponential) {
  const valueAt = (t) => {
    if (t <= pts[0][0]) return pts[0][1]
    for (let i = 1; i < pts.length; i++) {
      const [t1, v1] = pts[i]
      const [t0, v0] = pts[i - 1]
      if (t <= t1) {
        const f = t1 > t0 ? (t - t0) / (t1 - t0) : 1
        return exponential ? v0 * (v1 / v0) ** f : v0 + (v1 - v0) * f
      }
    }
    return pts[pts.length - 1][1]
  }
  param.setValueAtTime(valueAt(a), when)
  for (const [t, v] of pts) {
    if (t <= a || t >= b) continue
    if (exponential) param.exponentialRampToValueAtTime(v, when + t - a)
    else param.linearRampToValueAtTime(v, when + t - a)
  }
  const end = valueAt(b)
  if (exponential) param.exponentialRampToValueAtTime(end, when + b - a)
  else param.linearRampToValueAtTime(end, when + b - a)
}

export function songEnd(clips) {
  return clips.reduce((m, c) => Math.max(m, c.start + c.length), 0)
}
