const EDGE_FADE = 0.004

// Plays the part of `clip` that lies in timeline range [from, to) at context time `when`.
// Short fades at both ends avoid clicks at cut points and loop boundaries.
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
  src.connect(g)
  g.connect(destination)

  const offset = clip.offset + (s - clip.start) * clip.rate
  src.start(when, offset, dur * clip.rate)
  src.onended = () => g.disconnect()
  return src
}

export function songEnd(clips) {
  return clips.reduce((m, c) => Math.max(m, c.start + c.length), 0)
}
