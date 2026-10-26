import { useRef } from 'react'

const ARC = 270

function toNorm(v, min, max, log) {
  if (log) return Math.log(v / min) / Math.log(max / min)
  return (v - min) / (max - min)
}

function fromNorm(n, min, max, log) {
  n = Math.min(1, Math.max(0, n))
  if (log) return min * Math.pow(max / min, n)
  return min + n * (max - min)
}

function polar(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function arcPath(cx, cy, r, from, to) {
  const [x1, y1] = polar(cx, cy, r, from)
  const [x2, y2] = polar(cx, cy, r, to)
  const large = to - from > 180 ? 1 : 0
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
}

// Drag up/down to turn, Shift for fine control, double-click to reset.
export default function Knob({ label, value, min, max, onChange, defaultValue, format, log, bipolar, color = '#e879f9', size = 48 }) {
  const drag = useRef(null)
  const norm = toNorm(value, min, max, log)
  const start = -ARC / 2
  const angle = start + norm * ARC
  const zero = bipolar ? start + toNorm(0, min, max, log) * ARC : start
  const c = size / 2
  const r = size / 2 - 5

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, norm }
  }
  const onPointerMove = (e) => {
    if (!drag.current) return
    const speed = e.shiftKey ? 0.0015 : 0.006
    const n = drag.current.norm + (drag.current.y - e.clientY) * speed
    onChange(fromNorm(n, min, max, log))
  }
  const onPointerUp = () => {
    drag.current = null
  }
  const onWheel = (e) => {
    const n = norm - Math.sign(e.deltaY) * 0.02
    onChange(fromNorm(n, min, max, log))
  }

  const [px, py] = polar(c, c, r - 6, angle)
  return (
    <div className="flex flex-col items-center gap-1 select-none" title="Ziehen zum Drehen · Shift = fein · Doppelklick = Reset">
      <svg
        width={size}
        height={size}
        className="cursor-ns-resize touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
      >
        <circle cx={c} cy={c} r={r - 3} fill="#18181b" stroke="#27272a" strokeWidth="2" />
        <path d={arcPath(c, c, r, start, start + ARC)} stroke="#3f3f46" strokeWidth="3" fill="none" strokeLinecap="round" />
        {Math.abs(angle - zero) > 0.5 && (
          <path
            d={arcPath(c, c, r, Math.min(zero, angle), Math.max(zero, angle))}
            stroke={color}
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 3px ${color})` }}
          />
        )}
        <line x1={c} y1={c} x2={px} y2={py} stroke="#fafafa" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="font-mono text-[10px] text-zinc-300">{format ? format(value) : value.toFixed(2)}</div>
    </div>
  )
}
