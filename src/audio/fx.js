// Per-track effect chain: HP -> LP -> 3-band EQ -> (dry + tempo-synced delay) -> volume -> pan.
// Works on both AudioContext and OfflineAudioContext so live playback and export sound identical.

export const DEFAULT_FX = {
  volume: 0.8,
  pan: 0,
  hp: 20,
  lp: 20000,
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
  delayMix: 0,
  delayFeedback: 0.35,
  delayBeats: 0.75,
}

export const DELAY_DIVISIONS = [
  { label: '1/16', beats: 0.25 },
  { label: '1/8', beats: 0.5 },
  { label: '3/16', beats: 0.75 },
  { label: '1/4', beats: 1 },
  { label: '3/8', beats: 1.5 },
  { label: '1/2', beats: 2 },
]

export function createFxChain(ctx) {
  const input = ctx.createGain()

  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.Q.value = 0.9
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 0.9

  const low = ctx.createBiquadFilter()
  low.type = 'lowshelf'
  low.frequency.value = 120
  const mid = ctx.createBiquadFilter()
  mid.type = 'peaking'
  mid.frequency.value = 1000
  mid.Q.value = 0.8
  const high = ctx.createBiquadFilter()
  high.type = 'highshelf'
  high.frequency.value = 8000

  const dry = ctx.createGain()
  const delay = ctx.createDelay(4)
  const wet = ctx.createGain()
  const feedback = ctx.createGain()
  // Keep the delay tail out of the low end, like a typical DJ echo.
  const fbFilter = ctx.createBiquadFilter()
  fbFilter.type = 'highpass'
  fbFilter.frequency.value = 250

  const volume = ctx.createGain()
  const gate = ctx.createGain() // mute / solo
  const pan = ctx.createStereoPanner()

  input.connect(hp)
  hp.connect(lp)
  lp.connect(low)
  low.connect(mid)
  mid.connect(high)
  high.connect(dry)
  high.connect(delay)
  delay.connect(wet)
  delay.connect(fbFilter)
  fbFilter.connect(feedback)
  feedback.connect(delay)
  dry.connect(volume)
  wet.connect(volume)
  volume.connect(gate)
  gate.connect(pan)

  const isLive = typeof ctx.startRendering !== 'function'

  function setParam(param, value) {
    if (isLive) param.setTargetAtTime(value, ctx.currentTime, 0.015)
    else param.value = value
  }

  return {
    input,
    output: pan,
    apply(fx, bpm, audible = true) {
      setParam(hp.frequency, fx.hp)
      setParam(lp.frequency, fx.lp)
      setParam(low.gain, fx.eqLow)
      setParam(mid.gain, fx.eqMid)
      setParam(high.gain, fx.eqHigh)
      // Equal-ish power dry/wet so the delay sits on top instead of replacing the signal.
      setParam(dry.gain, 1 - fx.delayMix * 0.5)
      setParam(wet.gain, fx.delayMix)
      setParam(feedback.gain, fx.delayFeedback)
      setParam(delay.delayTime, Math.min(4, (60 / bpm) * fx.delayBeats))
      setParam(volume.gain, fx.volume)
      setParam(pan.pan, fx.pan)
      setParam(gate.gain, audible ? 1 : 0)
    },
    disconnect() {
      pan.disconnect()
    },
  }
}

// Master bus: gain -> optional limiter -> output.
export function createMaster(ctx) {
  const gain = ctx.createGain()
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1.5
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.002
  limiter.release.value = 0.12
  const out = ctx.createGain()
  gain.connect(out)

  let limiterOn = false
  return {
    input: gain,
    output: out,
    apply({ volume, limiter: useLimiter }) {
      gain.gain.value = volume
      if (useLimiter === limiterOn) return
      gain.disconnect()
      limiter.disconnect()
      if (useLimiter) {
        gain.connect(limiter)
        limiter.connect(out)
      } else {
        gain.connect(out)
      }
      limiterOn = useLimiter
    },
  }
}

export function trackAudible(track, tracks) {
  const anySolo = tracks.some((t) => t.solo)
  if (track.mute) return false
  return anySolo ? track.solo : true
}
