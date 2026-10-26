// 16-bit PCM WAV encoder.
export function encodeWav(buffer) {
  const channels = Math.min(2, buffer.numberOfChannels)
  const { sampleRate, length } = buffer
  const bytesPerFrame = channels * 2
  const dataSize = length * bytesPerFrame
  const out = new ArrayBuffer(44 + dataSize)
  const view = new DataView(out)

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerFrame, true)
  view.setUint16(32, bytesPerFrame, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  const data = []
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c))
  let pos = 44
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]))
      view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      pos += 2
    }
  }
  return new Blob([out], { type: 'audio/wav' })
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
