// Per-app recording in the Windows desktop app (see desktop/). In the browser `desktopApi()` is null.
// Each selected app is captured separately (WASAPI process loopback) and ends up on its own track.

const SILENCE = 1e-4

export const desktopApi = () => (typeof window !== 'undefined' ? window.muckeDesktop ?? null : null)

// sources: [{ pid, label, mode: 'include' | 'exclude' }]
export async function startDesktopRecording(sources, { onError } = {}) {
  const api = desktopApi()
  const caps = []
  const byId = new Map()
  const offData = api.onData((id, data) => {
    const cap = byId.get(id)
    if (!cap || cap.stopped) return
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    const f = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    cap.chunks.push(f)
    cap.frames += f.length / cap.channels
    let peak = 0
    for (let i = 0; i < f.length; i += 4) peak = Math.max(peak, Math.abs(f[i]))
    cap.recent = peak
    if (peak > cap.peak) cap.peak = peak
  })
  const offStatus = api.onStatus((id, msg) => {
    const cap = byId.get(id)
    if (cap && msg.error) onError?.(`${cap.label}: ${msg.error} (${msg.hr})`)
  })

  try {
    for (const s of sources) {
      const { id, rate, channels } = await api.start({ pid: s.pid, mode: s.mode })
      const cap = { id, label: s.label, rate, channels, chunks: [], frames: 0, peak: 0, recent: 0, stopped: false }
      caps.push(cap)
      byId.set(id, cap)
    }
  } catch (err) {
    caps.forEach((c) => api.stop(c.id))
    offData()
    offStatus()
    throw err
  }

  const toBuffer = (cap) => {
    if (!cap.frames) return null
    const length = Math.floor(cap.frames)
    const buffer = new AudioBuffer({ numberOfChannels: 2, length, sampleRate: cap.rate })
    const l = buffer.getChannelData(0)
    const r = buffer.getChannelData(1)
    let pos = 0
    for (const f of cap.chunks) {
      for (let i = 0; i + 1 < f.length && pos < length; i += 2, pos++) {
        l[pos] = f[i]
        r[pos] = f[i + 1]
      }
    }
    return buffer
  }

  return {
    multi: true,
    stop() {
      offData()
      offStatus()
      return caps.map((cap) => {
        cap.stopped = true
        api.stop(cap.id)
        return { label: cap.label, buffer: toBuffer(cap), hasSignal: cap.peak >= SILENCE }
      })
    },
    seconds: () => Math.max(0, ...caps.map((c) => c.frames / c.rate)),
    hasSignal: () => caps.some((c) => c.peak >= SILENCE),
    level: () => Math.max(0, ...caps.map((c) => c.recent)),
  }
}
