// Main-thread side of the mashup DSP: one short-lived worker per job, so several songs run in parallel.

const ANALYSIS_RATE = 22050

function runJob(msg, transfer, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') return onProgress?.(e.data.p)
      worker.terminate()
      if (e.data.type === 'done') resolve(e.data.result)
      else reject(new Error(e.data.message))
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message || 'Analyse fehlgeschlagen'))
    }
    worker.postMessage(msg, transfer)
  })
}

// Mono, 22.05 kHz copy for analysis; the browser's resampler does the work.
async function toMono(buffer) {
  const ctx = new OfflineAudioContext(1, Math.ceil(buffer.duration * ANALYSIS_RATE), ANALYSIS_RATE)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.connect(ctx.destination)
  src.start()
  const rendered = await ctx.startRendering()
  return rendered.getChannelData(0)
}

export async function analyzeBuffer(buffer, onProgress) {
  onProgress?.(0.02)
  const mono = await toMono(buffer)
  return runJob({ type: 'analyze', mono, sr: ANALYSIS_RATE }, [mono.buffer], onProgress)
}

export async function stretchBuffer(ctx, buffer, tempo, semis, onProgress) {
  const channels = []
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c).slice())
  const out = await runJob(
    { type: 'stretch', channels, sr: buffer.sampleRate, tempo, semis },
    channels.map((c) => c.buffer),
    onProgress,
  )
  const result = ctx.createBuffer(out.length, out[0].length, buffer.sampleRate)
  out.forEach((data, c) => result.copyToChannel(data, c))
  return result
}
