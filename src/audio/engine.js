import { createFxChain, createMaster, trackAudible } from './fx.js'
import { computePeaks } from './peaks.js'
import { schedulePart, songEnd } from './schedule.js'

const LOOKAHEAD = 0.35
const START_DELAY = 0.05

// Owns the AudioContext, decoded buffers and the transport scheduler.
// Clips are scheduled sample-accurately; loops are queued one iteration ahead so they are gapless.
class Engine {
  constructor() {
    this.ctx = null
    this.buffers = new Map()
    this.peaks = new Map()
    this.chains = new Map()
    this.sources = new Set()
    this.playing = false
    this.timer = null
    this.segments = []
    this.onStop = null
  }

  ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' })
      this.master = createMaster(this.ctx)
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 1024
      this.master.output.connect(this.analyser)
      this.analyser.connect(this.ctx.destination)
      this.master.apply({ volume: 0.9, limiter: true })
    }
    if (this.ctx.state === 'suspended') this.ctx.resume()
    return this.ctx
  }

  addBuffer(id, buffer) {
    this.buffers.set(id, buffer)
    this.peaks.set(id, computePeaks(buffer))
  }

  async decode(arrayBuffer) {
    return this.ensure().decodeAudioData(arrayBuffer)
  }

  syncTracks(tracks, bpm) {
    const ctx = this.ensure()
    const ids = new Set(tracks.map((t) => t.id))
    for (const [id, chain] of this.chains) {
      if (!ids.has(id)) {
        chain.disconnect()
        this.chains.delete(id)
      }
    }
    for (const t of tracks) {
      let chain = this.chains.get(t.id)
      if (!chain) {
        chain = createFxChain(ctx)
        chain.output.connect(this.master.input)
        this.chains.set(t.id, chain)
      }
      chain.apply(t.fx, bpm, trackAudible(t, tracks))
    }
  }

  setMaster(master) {
    this.ensure()
    this.master.apply(master)
  }

  // --- transport -------------------------------------------------------------

  play(project, from) {
    this.stopSources()
    const ctx = this.ensure()
    this.project = project
    const { loop } = project
    this.looping = loop.enabled && loop.end - loop.start > 0.02
    let pos = Math.max(0, from)
    if (this.looping && pos >= loop.end) pos = loop.start

    this.playing = true
    this.segments = []
    this.nextTl = pos
    this.nextCtx = ctx.currentTime + START_DELAY
    this.end = songEnd(project.clips)
    this.beatSec = 60 / project.bpm
    this.nextClickBeat = Math.ceil(pos / this.beatSec - 1e-6)

    this.scheduleAhead()
    clearInterval(this.timer)
    this.timer = setInterval(() => this.tick(), 40)
  }

  scheduleChunk() {
    const { loop, clips } = this.project
    const tlStart = this.nextTl
    const tlEnd = this.looping ? loop.end : Infinity
    const ctxStart = this.nextCtx
    for (const clip of clips) {
      const buffer = this.buffers.get(clip.bufferId)
      const chain = this.chains.get(clip.trackId)
      if (!buffer || !chain) continue
      const when = ctxStart + Math.max(0, clip.start - tlStart)
      const src = schedulePart(this.ctx, buffer, clip, tlStart, tlEnd, when, chain.input)
      if (src) {
        this.sources.add(src)
        src.addEventListener('ended', () => this.sources.delete(src))
      }
    }
    this.segments.push({ ctxStart, tlStart, tlEnd })
    if (this.looping) {
      if (this.project.metronome) this.scheduleLoopClicks(tlStart, tlEnd, ctxStart)
      this.nextCtx = ctxStart + (tlEnd - tlStart)
      this.nextTl = loop.start
    } else {
      this.nextCtx = Infinity
    }
  }

  scheduleAhead() {
    const horizon = this.ctx.currentTime + LOOKAHEAD
    while (this.nextCtx < horizon) this.scheduleChunk()
    if (this.project.metronome && !this.looping) {
      // open-ended playback: roll the click track forward in small windows
      const seg = this.segments[0]
      for (;;) {
        const when = seg.ctxStart + this.nextClickBeat * this.beatSec - seg.tlStart
        if (when > horizon) break
        this.click(when, this.nextClickBeat % 4 === 0)
        this.nextClickBeat++
      }
    }
  }

  scheduleLoopClicks(tlStart, tlEnd, ctxStart) {
    for (let b = Math.ceil(tlStart / this.beatSec - 1e-6); b * this.beatSec < tlEnd - 1e-6; b++) {
      this.click(ctxStart + b * this.beatSec - tlStart, b % 4 === 0)
    }
  }

  click(when, accent) {
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.frequency.value = accent ? 1760 : 1100
    g.gain.setValueAtTime(0.0001, when)
    g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, when + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05)
    osc.connect(g)
    g.connect(this.ctx.destination)
    osc.start(when)
    osc.stop(when + 0.06)
    this.sources.add(osc)
    osc.onended = () => {
      this.sources.delete(osc)
      g.disconnect()
    }
  }

  tick() {
    if (!this.playing) return
    this.scheduleAhead()
    const now = this.ctx.currentTime
    while (this.segments.length > 1 && this.segments[1].ctxStart <= now) this.segments.shift()
    if (!this.looping && !this.project.metronome && this.end > 0 && this.position() >= this.end) {
      const end = this.end
      this.stop()
      this.onStop?.(end)
    }
  }

  position() {
    if (!this.playing || !this.segments.length) return this.nextTl ?? 0
    const now = this.ctx.currentTime
    let seg = this.segments[0]
    for (const s of this.segments) if (s.ctxStart <= now) seg = s
    const t = seg.tlStart + Math.max(0, now - seg.ctxStart)
    return Math.min(t, seg.tlEnd)
  }

  stopSources() {
    for (const src of this.sources) {
      try {
        src.stop()
      } catch {
        // already stopped
      }
    }
    this.sources.clear()
  }

  stop() {
    const pos = this.playing ? this.position() : 0
    this.playing = false
    clearInterval(this.timer)
    this.stopSources()
    this.segments = []
    return pos
  }

  level() {
    if (!this.analyser) return 0
    const data = new Float32Array(this.analyser.fftSize)
    this.analyser.getFloatTimeDomainData(data)
    let peak = 0
    for (const v of data) peak = Math.max(peak, Math.abs(v))
    return peak
  }
}

export const engine = new Engine()
