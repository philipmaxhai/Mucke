export const SAMPLES_PER_PEAK = 256

// Downsampled min/max envelope (all channels merged) for fast waveform drawing.
export function computePeaks(buffer) {
  const n = Math.ceil(buffer.length / SAMPLES_PER_PEAK)
  const min = new Float32Array(n)
  const max = new Float32Array(n)
  const channels = []
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))
  for (let i = 0; i < n; i++) {
    let lo = 0
    let hi = 0
    const end = Math.min(buffer.length, (i + 1) * SAMPLES_PER_PEAK)
    for (const data of channels) {
      for (let j = i * SAMPLES_PER_PEAK; j < end; j++) {
        const v = data[j]
        if (v < lo) lo = v
        else if (v > hi) hi = v
      }
    }
    min[i] = lo
    max[i] = hi
  }
  return { min, max, rate: buffer.sampleRate / SAMPLES_PER_PEAK }
}
