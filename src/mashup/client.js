// Main-thread side of the mashup DSP: one short-lived worker per job, so several songs run in parallel.

const ANALYSIS_RATE = 22050

// Limit parallel workers to the machine's cores (each job holds a few seconds of audio in memory).
const MAX_WORKERS = Math.max(1, Math.min(6, (globalThis.navigator?.hardwareConcurrency || 4) - 1))
let running = 0
const queue = []

function runJob(msg, transfer, onProgress) {
  return new Promise((resolve, reject) => {
    queue.push({ msg, transfer, onProgress, resolve, reject })
    pump()
  })
}

function pump() {
  while (running < MAX_WORKERS && queue.length) {
    const job = queue.shift()
    running++
    startJob(job.msg, job.transfer, job.onProgress)
      .then(job.resolve, job.reject)
      .finally(() => {
        running--
        pump()
      })
  }
}

function startJob(msg, transfer, onProgress) {
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

// Cuts a loop region (song time, with padding) out of `buffer`, fits it to the target tempo/key and
// splits it into drums / bass / music / air. Returns { stemName: AudioBuffer }.
export async function loopStems(ctx, buffer, { start, end, padBefore, loopSeconds, tempo, semis, beatSec, clarity }, onProgress) {
  const sr = buffer.sampleRate
  const i0 = Math.max(0, Math.floor(start * sr))
  const i1 = Math.min(buffer.length, Math.ceil(end * sr))
  const channels = []
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c).slice(i0, i1))
  const padOut = padBefore / tempo
  const beats = []
  for (let t = padOut - 4 * beatSec; t < (i1 - i0) / sr / tempo; t += beatSec) if (t >= 0) beats.push(t)
  const stems = await runJob(
    {
      type: 'stems',
      channels,
      sr,
      tempo,
      semis,
      beats,
      clarity,
      trimStart: Math.round(padOut * sr),
      trimLength: Math.round(loopSeconds * sr),
    },
    channels.map((c) => c.buffer),
    onProgress,
  )
  const out = {}
  for (const [name, chans] of Object.entries(stems)) {
    const b = ctx.createBuffer(chans.length, chans[0].length, sr)
    chans.forEach((data, c) => b.copyToChannel(data, c))
    out[name] = b
  }
  return out
}
