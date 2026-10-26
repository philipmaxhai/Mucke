// Lossless capture of tab/system audio (getDisplayMedia) or a microphone/line-in (getUserMedia).
// Raw PCM is collected in an AudioWorklet, so there is no lossy codec in between.

const WORKLET_SRC = `
class MuckeRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (input && input.length) this.port.postMessage(input.map((ch) => ch.slice(0)))
    return true
  }
}
registerProcessor('mucke-recorder', MuckeRecorder)
`

let workletReady = null

function loadWorklet(ctx) {
  if (!workletReady) {
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }))
    workletReady = ctx.audioWorklet.addModule(url)
  }
  return workletReady
}

const RAW_AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }

export function displayCaptureSupported() {
  return !!navigator.mediaDevices?.getDisplayMedia
}

async function openStream(source) {
  if (source === 'display') {
    if (!displayCaptureSupported()) {
      throw new Error('Dein Browser unterstützt keine Bildschirm-/Tab-Aufnahme. Nimm Chrome, Edge oder Brave.')
    }
    // Chrome only offers audio together with video, so we ask for both and drop the picture.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 1 },
      audio: RAW_AUDIO,
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
    })
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((t) => t.stop())
      throw new Error(
        'Kein Audio im geteilten Inhalt. Wähle einen Tab und setze den Haken bei „Tab-Audio teilen“ (bzw. „Systemaudio teilen“).',
      )
    }
    return stream
  }
  return navigator.mediaDevices.getUserMedia({ audio: { ...RAW_AUDIO, channelCount: 2 } })
}

export async function startRecording(ctx, source, { onEnded } = {}) {
  const stream = await openStream(source)
  await loadWorklet(ctx)

  const audioStream = new MediaStream(stream.getAudioTracks())
  const input = ctx.createMediaStreamSource(audioStream)
  const node = new AudioWorkletNode(ctx, 'mucke-recorder', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 2,
    channelCountMode: 'explicit',
  })
  const silent = ctx.createGain()
  silent.gain.value = 0
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024

  const left = []
  const right = []
  let frames = 0
  node.port.onmessage = (e) => {
    const [l, r] = e.data
    left.push(l)
    right.push(r || l)
    frames += l.length
  }

  input.connect(node)
  input.connect(analyser)
  node.connect(silent)
  silent.connect(ctx.destination)

  let stopped = false
  const stop = () => {
    if (stopped) return null
    stopped = true
    node.port.onmessage = null
    input.disconnect()
    node.disconnect()
    silent.disconnect()
    stream.getTracks().forEach((t) => t.stop())
    if (!frames) return null
    const buffer = ctx.createBuffer(2, frames, ctx.sampleRate)
    const outL = buffer.getChannelData(0)
    const outR = buffer.getChannelData(1)
    let pos = 0
    for (let i = 0; i < left.length; i++) {
      outL.set(left[i], pos)
      outR.set(right[i], pos)
      pos += left[i].length
    }
    return buffer
  }

  // User pressed "Freigabe beenden" in the browser bar.
  stream.getAudioTracks()[0].addEventListener('ended', () => onEnded?.())

  return {
    stop,
    seconds: () => frames / ctx.sampleRate,
    level() {
      const data = new Float32Array(analyser.fftSize)
      analyser.getFloatTimeDomainData(data)
      let peak = 0
      for (const v of data) peak = Math.max(peak, Math.abs(v))
      return peak
    },
  }
}
