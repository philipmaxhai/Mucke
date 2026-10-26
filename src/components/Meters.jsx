import { useEffect, useRef, useState } from 'react'
import { formatPosition, formatTime } from '../state/project.js'

export function PositionDisplay({ engine, playing, playhead, bpm }) {
  const [pos, setPos] = useState(playhead)
  useEffect(() => {
    if (!playing) {
      setPos(playhead)
      return
    }
    let raf
    const tick = () => {
      setPos(engine.position())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, playhead, engine])
  return (
    <div className="flex flex-col items-end rounded-md border border-zinc-800 bg-black/60 px-3 py-1 font-mono leading-tight">
      <span className="text-lg text-cyan-300 [text-shadow:0_0_8px_rgba(34,211,238,0.6)]">{formatPosition(pos, bpm)}</span>
      <span className="text-[10px] text-zinc-500">{formatTime(pos)}</span>
    </div>
  )
}

// Peak meter with hold-free decay; `read` returns a linear peak value.
export function LevelMeter({ read, className = 'w-24' }) {
  const barRef = useRef(null)
  useEffect(() => {
    let raf
    let shown = 0
    const tick = () => {
      const peak = read()
      shown = Math.max(peak, shown * 0.9)
      const db = shown > 0 ? 20 * Math.log10(shown) : -60
      const pct = Math.max(0, Math.min(100, ((db + 48) / 48) * 100))
      if (barRef.current) {
        barRef.current.style.width = `${pct}%`
        barRef.current.style.background = shown >= 0.98 ? '#f43f5e' : shown > 0.7 ? '#facc15' : '#a3e635'
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [read])
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-zinc-800 ${className}`}>
      <div ref={barRef} className="h-full w-0 rounded-full" />
    </div>
  )
}

export function RecTimer({ handle }) {
  const [sec, setSec] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setSec(handle.seconds()), 200)
    return () => clearInterval(id)
  }, [handle])
  return <span className="font-mono">{formatTime(sec)}</span>
}

// Shown when a recording has run for a few seconds without any signal (e.g. DRM-protected tabs).
export function SilenceHint({ handle }) {
  const [silent, setSilent] = useState(false)
  useEffect(() => {
    const id = setInterval(() => setSilent(handle.seconds() > 3 && !handle.hasSignal()), 500)
    return () => clearInterval(id)
  }, [handle])
  if (!silent) return null
  return (
    <span className="text-xs text-amber-300" title="Kopiergeschützte Seiten wie Spotify liefern beim Teilen nur Stille">
      kein Signal – läuft Musik? (Spotify = stumm, DRM)
    </span>
  )
}
