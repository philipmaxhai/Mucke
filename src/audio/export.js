import { createFxChain, createMaster, trackAudible } from './fx.js'
import { schedulePart, songEnd } from './schedule.js'
import { encodeWav } from './wav.js'

const EXPORT_RATE = 44100

// Renders the project offline through the same FX chains used for playback.
// mode 'loop' renders exactly the loop region (seamlessly loopable), 'song' the whole arrangement.
export async function renderProject(project, buffers, mode) {
  const { clips, tracks, bpm, loop, master } = project
  let from = 0
  let to = songEnd(clips)
  if (mode === 'loop') {
    from = loop.start
    to = loop.end
  } else if (tracks.some((t) => t.fx.delayMix > 0)) {
    to += (60 / bpm) * 4 // let delay tails ring out for one bar
  }
  const duration = to - from
  if (duration <= 0.01) throw new Error('Nichts zu exportieren – die Timeline ist leer.')

  const ctx = new OfflineAudioContext(2, Math.ceil(duration * EXPORT_RATE), EXPORT_RATE)
  const masterBus = createMaster(ctx)
  masterBus.output.connect(ctx.destination)
  masterBus.apply(master)

  const chains = new Map()
  for (const t of tracks) {
    const chain = createFxChain(ctx)
    chain.apply(t.fx, bpm, trackAudible(t, tracks))
    chain.output.connect(masterBus.input)
    chains.set(t.id, chain)
  }

  for (const clip of clips) {
    const buffer = buffers.get(clip.bufferId)
    const chain = chains.get(clip.trackId)
    if (!buffer || !chain) continue
    schedulePart(ctx, buffer, clip, from, to, Math.max(0, clip.start - from), chain.input)
  }

  const rendered = await ctx.startRendering()
  return encodeWav(rendered)
}
