// Patterns (FL-style): every pattern holds step hits and piano-roll notes for each channel of the channel rack.
// A pattern is rendered offline into one AudioBuffer per channel. In the playlist a pattern clip is expanded
// into one ordinary audio clip per channel, routed to that channel's mixer insert, so playback, looping,
// effects and WAV export all reuse the normal audio clip path.

import { computePeaks } from './peaks.js'
import { playChannel } from './instruments.js'

export const STEPS_PER_BAR = 16

export const patternDuration = (pattern, bpm) => pattern.bars * 4 * (60 / bpm)

export const mixBufferId = (patternId) => `pat:${patternId}`
export const channelBufferId = (patternId, channelId) => `pat:${patternId}:${channelId}`

export function channelAudible(ch, channels) {
  if (ch.mute) return false
  return channels.some((c) => c.solo) ? !!ch.solo : true
}

// Pattern clips -> per-channel audio clips. Plain audio clips pass through unchanged.
export function expandClips(clips, channels) {
  const out = []
  for (const clip of clips) {
    if (!clip.patternId) {
      out.push(clip)
      continue
    }
    for (const ch of channels) {
      if (!channelAudible(ch, channels)) continue
      out.push({
        ...clip,
        id: `${clip.id}:${ch.id}`,
        bufferId: channelBufferId(clip.patternId, ch.id),
        trackId: ch.insertId ?? clip.trackId,
        gain: clip.gain * (ch.volume ?? 0.8),
      })
    }
  }
  return out
}

// Time (in steps) of a step hit, with swing applied to every second 16th.
function swung(step, swing) {
  return step % 2 === 1 ? step + (swing || 0) * 0.5 : step
}

function channelHasContent(pattern, chId) {
  return (pattern.steps[chId] ?? []).some((v) => v > 0) || (pattern.notes[chId] ?? []).length > 0
}

async function renderChannel(pattern, ch, bpm, samples, sampleRate) {
  const duration = patternDuration(pattern, bpm)
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * sampleRate)), sampleRate)
  const pan = ctx.createStereoPanner()
  pan.pan.value = ch.pan ?? 0
  pan.connect(ctx.destination)
  const stepSec = 60 / bpm / 4
  const steps = pattern.steps[ch.id] ?? []
  steps.forEach((v, i) => {
    if (v > 0 && i < pattern.bars * STEPS_PER_BAR) {
      playChannel(ctx, ch, pan, swung(i, pattern.swing) * stepSec, stepSec * 0.9, null, v, samples)
    }
  })
  for (const n of pattern.notes[ch.id] ?? []) {
    const t = (Number.isInteger(n.s) ? swung(n.s, pattern.swing) : n.s) * stepSec
    if (t < duration) playChannel(ctx, ch, pan, t, n.l * stepSec, n.p, n.v ?? 0.8, samples)
  }
  return ctx.startRendering()
}

function signature(pattern, ch, bpm, samples) {
  const { name, volume, mute, solo, insertId, ...sound } = ch
  return JSON.stringify([
    pattern.bars,
    pattern.swing,
    bpm,
    pattern.steps[ch.id] ?? [],
    pattern.notes[ch.id] ?? [],
    sound,
    ch.kind === 'sample' ? !!samples.get(ch.sampleId) : 0,
  ])
}

// Keeps rendered buffers in `engine.buffers` up to date, re-rendering only what changed.
export class PatternRenderer {
  constructor(engine) {
    this.engine = engine
    this.signatures = new Map()
    this.token = 0
  }

  async update(patterns, channels, bpm) {
    const token = ++this.token
    const { engine } = this
    const sampleRate = engine.ctx?.sampleRate ?? 44100
    const samples = engine.buffers
    let changed = false
    const live = new Set()

    for (const pattern of patterns) {
      for (const ch of channels) {
        const id = channelBufferId(pattern.id, ch.id)
        live.add(id)
        if (!channelHasContent(pattern, ch.id)) {
          if (engine.buffers.has(id)) {
            engine.buffers.delete(id)
            this.signatures.delete(id)
            changed = true
          }
          continue
        }
        const sig = signature(pattern, ch, bpm, samples)
        if (this.signatures.get(id) === sig && engine.buffers.has(id)) continue
        const buffer = await renderChannel(pattern, ch, bpm, samples, sampleRate)
        if (token !== this.token) return false // a newer update superseded this one
        engine.buffers.set(id, buffer)
        this.signatures.set(id, sig)
        changed = true
      }
    }
    for (const id of [...this.signatures.keys()]) {
      if (!live.has(id)) {
        this.signatures.delete(id)
        engine.buffers.delete(id)
        changed = true
      }
    }

    // Mixdown per pattern, only for the waveform preview in the playlist.
    for (const pattern of patterns) {
      const length = Math.max(1, Math.ceil(patternDuration(pattern, bpm) * sampleRate))
      const mix = new AudioBuffer({ numberOfChannels: 2, length, sampleRate })
      for (const ch of channels) {
        const buf = engine.buffers.get(channelBufferId(pattern.id, ch.id))
        if (!buf || !channelAudible(ch, channels)) continue
        const g = ch.volume ?? 0.8
        for (let c = 0; c < 2; c++) {
          const src = buf.getChannelData(Math.min(c, buf.numberOfChannels - 1))
          const dst = mix.getChannelData(c)
          const n = Math.min(length, src.length)
          for (let i = 0; i < n; i++) dst[i] += src[i] * g
        }
      }
      const id = mixBufferId(pattern.id)
      engine.buffers.set(id, mix)
      engine.peaks.set(id, computePeaks(mix))
    }
    return changed || true
  }
}
