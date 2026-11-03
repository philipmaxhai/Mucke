// Built-in instruments for the channel rack: synthesized drums, a small subtractive synth and a sampler.
// Every voice is scheduled with plain Web Audio nodes, so it works in a live AudioContext (preview)
// and in an OfflineAudioContext (pattern rendering) alike.

export const DRUMS = [
  { id: 'kick', label: 'Kick' },
  { id: 'clap', label: 'Clap' },
  { id: 'snare', label: 'Snare' },
  { id: 'hat', label: 'Hi-Hat' },
  { id: 'openhat', label: 'Open Hat' },
  { id: 'rim', label: 'Rim / Perc' },
]

export const SYNTHS = [
  { id: 'bass', label: 'Bass', root: 36 },
  { id: 'lead', label: 'Lead', root: 60 },
  { id: 'pluck', label: 'Pluck', root: 60 },
  { id: 'pad', label: 'Pad', root: 60 },
  { id: 'organ', label: 'House-Orgel', root: 60 },
]

export const midiHz = (m) => 440 * 2 ** ((m - 69) / 12)

const noiseCache = new WeakMap()
function noise(ctx) {
  let buf = noiseCache.get(ctx)
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = buf.getChannelData(0)
    let seed = 1234567
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 16807) % 2147483647
      d[i] = (seed / 2147483647) * 2 - 1
    }
    noiseCache.set(ctx, buf)
  }
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  return src
}

function env(ctx, when, peak, attack, decay, dest) {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, when)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay)
  g.connect(dest)
  return g
}

// pitch in semitones, decay as a multiplier (1 = default)
export function playDrum(ctx, kind, dest, when, vel = 1, { pitch = 0, decay = 1 } = {}) {
  const p = 2 ** (pitch / 12)
  const stopAt = (src, t) => {
    src.start(when)
    src.stop(when + t + 0.02)
  }
  switch (kind) {
    case 'kick': {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(160 * p, when)
      osc.frequency.exponentialRampToValueAtTime(48 * p, when + 0.07)
      osc.frequency.exponentialRampToValueAtTime(42 * p, when + 0.4)
      const d = 0.42 * decay
      osc.connect(env(ctx, when, vel * 1.0, 0.002, d, dest))
      stopAt(osc, d)
      const click = ctx.createOscillator()
      click.type = 'square'
      click.frequency.value = 1400 * p
      click.connect(env(ctx, when, vel * 0.12, 0.0008, 0.012, dest))
      stopAt(click, 0.02)
      break
    }
    case 'snare': {
      const d = 0.2 * decay
      const n = noise(ctx)
      const bp = ctx.createBiquadFilter()
      bp.type = 'highpass'
      bp.frequency.value = 1500 * p
      n.connect(bp)
      bp.connect(env(ctx, when, vel * 0.55, 0.001, d, dest))
      stopAt(n, d)
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(220 * p, when)
      osc.frequency.exponentialRampToValueAtTime(170 * p, when + 0.05)
      osc.connect(env(ctx, when, vel * 0.5, 0.001, 0.09 * decay, dest))
      stopAt(osc, 0.1 * decay)
      break
    }
    case 'clap': {
      const n = noise(ctx)
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 1300 * p
      bp.Q.value = 1.2
      const g = ctx.createGain()
      const d = 0.22 * decay
      g.gain.setValueAtTime(0.0001, when)
      // three quick bursts and a tail, like several hands
      for (let i = 0; i < 3; i++) {
        const t = when + i * 0.011
        g.gain.setValueAtTime(vel * 0.8, t)
        g.gain.exponentialRampToValueAtTime(vel * 0.12, t + 0.009)
      }
      g.gain.setValueAtTime(vel * 0.7, when + 0.033)
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.033 + d)
      n.connect(bp)
      bp.connect(g)
      g.connect(dest)
      stopAt(n, 0.04 + d)
      break
    }
    case 'hat':
    case 'openhat': {
      const d = (kind === 'hat' ? 0.05 : 0.32) * decay
      const n = noise(ctx)
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 7000 * p
      const peq = ctx.createBiquadFilter()
      peq.type = 'peaking'
      peq.frequency.value = 10000 * p
      peq.gain.value = 6
      n.connect(hp)
      hp.connect(peq)
      peq.connect(env(ctx, when, vel * 0.35, 0.001, d, dest))
      stopAt(n, d)
      break
    }
    case 'rim':
    default: {
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(820 * p, when)
      osc.frequency.exponentialRampToValueAtTime(560 * p, when + 0.03)
      osc.connect(env(ctx, when, vel * 0.55, 0.001, 0.07 * decay, dest))
      stopAt(osc, 0.08 * decay)
    }
  }
}

const SYNTH_DEF = {
  bass: {
    waves: [
      ['sawtooth', 0],
      ['square', -1200],
    ],
    cutoff: 320,
    envAmt: 1400,
    fDecay: 0.18,
    q: 6,
    a: 0.004,
    r: 0.06,
    level: 0.32,
  },
  lead: {
    waves: [
      ['sawtooth', -8],
      ['sawtooth', 8],
    ],
    cutoff: 2200,
    envAmt: 2500,
    fDecay: 0.3,
    q: 2,
    a: 0.01,
    r: 0.15,
    level: 0.16,
  },
  pluck: {
    waves: [
      ['square', 0],
      ['sawtooth', 5],
    ],
    cutoff: 500,
    envAmt: 4200,
    fDecay: 0.12,
    q: 4,
    a: 0.002,
    r: 0.12,
    level: 0.16,
    decayOnly: 0.35,
  },
  pad: {
    waves: [
      ['sawtooth', -12],
      ['sawtooth', 0],
      ['sawtooth', 12],
    ],
    cutoff: 1400,
    envAmt: 600,
    fDecay: 0.8,
    q: 1,
    a: 0.35,
    r: 0.6,
    level: 0.1,
  },
  organ: {
    waves: [
      ['sine', 0],
      ['sine', 1200],
      ['square', 1902],
    ],
    cutoff: 3200,
    envAmt: 800,
    fDecay: 0.15,
    q: 1,
    a: 0.003,
    r: 0.08,
    level: 0.13,
    decayOnly: 0.45,
  },
}

// Returns how long the voice rings after `dur`, so callers can size buffers.
export function synthTail(kind) {
  return (SYNTH_DEF[kind] ?? SYNTH_DEF.lead).r + 0.05
}

export function playSynth(ctx, kind, dest, when, dur, midi, vel = 1, { cutoff = 1 } = {}) {
  const def = SYNTH_DEF[kind] ?? SYNTH_DEF.lead
  const f = midiHz(midi)
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.Q.value = def.q
  const base = Math.min(18000, def.cutoff * cutoff)
  filter.frequency.setValueAtTime(Math.min(18000, base + def.envAmt * cutoff), when)
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, base), when + def.fDecay)

  const amp = ctx.createGain()
  const peak = def.level * vel
  const end = when + Math.max(0.02, dur)
  amp.gain.setValueAtTime(0.0001, when)
  amp.gain.exponentialRampToValueAtTime(peak, when + def.a)
  if (def.decayOnly) {
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.05), when + def.a + def.decayOnly)
    amp.gain.setTargetAtTime(0.0001, end, def.r / 4)
  } else {
    amp.gain.setValueAtTime(peak, Math.max(when + def.a, end))
    amp.gain.exponentialRampToValueAtTime(0.0001, Math.max(when + def.a, end) + def.r)
  }
  filter.connect(amp)
  amp.connect(dest)
  const stop = Math.max(when + def.a, end) + def.r + 0.05
  for (const [type, cents] of def.waves) {
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = f
    osc.detune.value = cents
    osc.connect(filter)
    osc.start(when)
    osc.stop(stop)
  }
}

export function playSample(ctx, buffer, dest, when, dur, semis = 0, vel = 1) {
  if (!buffer) return
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.playbackRate.value = 2 ** (semis / 12)
  const g = ctx.createGain()
  g.gain.value = vel
  src.connect(g)
  g.connect(dest)
  src.start(when)
  if (dur) {
    g.gain.setValueAtTime(vel, when + dur)
    g.gain.linearRampToValueAtTime(0, when + dur + 0.01)
    src.stop(when + dur + 0.02)
  }
}

// Plays one hit/note of a channel. `pitch` is a MIDI note (null = the channel's root / unpitched hit).
export function playChannel(ctx, ch, dest, when, dur, pitch, vel, samples) {
  if (ch.kind === 'drum') {
    const semis = pitch == null ? ch.pitch || 0 : pitch - 60 + (ch.pitch || 0)
    playDrum(ctx, ch.preset, dest, when, vel, { pitch: semis, decay: ch.decay ?? 1 })
  } else if (ch.kind === 'synth') {
    playSynth(ctx, ch.preset, dest, when, dur, (pitch ?? ch.root ?? 60) + (ch.pitch || 0), vel, { cutoff: ch.cutoff ?? 1 })
  } else if (ch.kind === 'sample') {
    const semis = (pitch == null ? 0 : pitch - 60) + (ch.pitch || 0)
    playSample(ctx, samples?.get(ch.sampleId), dest, when, ch.gate ? dur : 0, semis, vel)
  }
}
