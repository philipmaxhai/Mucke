// Heavy lifting off the UI thread: song analysis and time-stretch / pitch-shift.
import { analyzeSignal } from './analyze.js'
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
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message || String(err) })
  }
}
