// Heavy lifting off the UI thread: song analysis and time-stretch / pitch-shift.
import { analyzeSignal } from './analyze.js'
import { separateStems } from './stems.js'
import { stretchChannels } from './stretch.js'

self.onmessage = (e) => {
  const { type } = e.data
  const progress = (p) => self.postMessage({ type: 'progress', p })
  try {
    if (type === 'analyze') {
      self.postMessage({ type: 'done', result: analyzeSignal(e.data.mono, e.data.sr, progress) })
    } else if (type === 'stretch') {
      const channels = stretchChannels(e.data.channels, e.data.sr, e.data.tempo, e.data.semis, progress)
      self.postMessage(
        { type: 'done', result: channels },
        channels.map((c) => c.buffer),
      )
    } else if (type === 'stems') {
      // loop region with one bar of padding on both sides: stretch, separate, then trim to the loop
      const { sr, tempo, semis, beats, trimStart, trimLength } = e.data
      const stretched = stretchChannels(e.data.channels, sr, tempo, semis, (p) => progress(0.3 * p))
      const stems = separateStems(stretched, sr, beats, (p) => progress(0.3 + 0.7 * p))
      const result = {}
      const transfer = []
      for (const [name, chans] of Object.entries(stems)) {
        result[name] = chans.map((c) => c.slice(trimStart, trimStart + trimLength))
        transfer.push(...result[name].map((c) => c.buffer))
      }
      self.postMessage({ type: 'done', result }, transfer)
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message || String(err) })
  }
}
