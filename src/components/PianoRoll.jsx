import { useEffect, useRef, useState } from 'react'
import { STEPS_PER_BAR } from '../audio/patterns.js'
import { uid } from '../state/project.js'
import { usePlayStep } from './ChannelRack.jsx'

const LOW = 24 // C1
const HIGH = 96 // C7
const ROW = 13
const STEP_W = 22
const KEYS_W = 56
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12)
const noteName = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`
const LENGTHS = [
  { label: '1/16', steps: 1 },
  { label: '1/8', steps: 2 },
  { label: '1/4', steps: 4 },
  { label: '1/2', steps: 8 },
  { label: '1 Takt', steps: 16 },
]

export default function PianoRoll({ state, dispatch, engine, playing, pattern }) {
  const channels = state.channels
  const channel = channels.find((c) => c.id === state.pianoChannelId) ?? channels.find((c) => c.kind === 'synth') ?? channels[0]
  const [len, setLen] = useState(2)
  const scrollRef = useRef(null)
  const drag = useRef(null)
  const playStep = usePlayStep(engine, playing, state, pattern)
  const total = pattern.bars * STEPS_PER_BAR
  const rows = HIGH - LOW + 1
  const notes = (channel && pattern.notes[channel.id]) ?? []

  // scroll so the channel's root note is in view
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !channel) return
    const root = notes.length ? notes.reduce((a, n) => a + n.p, 0) / notes.length : (channel.root ?? 60)
    el.scrollTop = (HIGH - root) * ROW - el.clientHeight / 2
    // only when switching channels
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.id])

  if (!channel) return <div className="text-sm text-zinc-500">Kein Kanal im Channel Rack.</div>

  const setNotes = (next) => dispatch({ type: 'setNotes', id: pattern.id, channelId: channel.id, notes: next })
  const locate = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    return { x, y, step: x / STEP_W, pitch: HIGH - Math.floor(y / ROW) }
  }

  const onPointerDown = (e) => {
    if (e.button === 1) return
    const { x, step, pitch } = locate(e)
    const hit = notes.find((n) => n.p === pitch && step >= n.s && step < n.s + n.l)
    if (e.button === 2) {
      if (hit) setNotes(notes.filter((n) => n !== hit))
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (hit) {
      const edge = x > (hit.s + hit.l) * STEP_W - 6
      drag.current = { mode: edge ? 'resize' : 'move', id: hit.id, step0: step, pitch0: pitch, orig: hit, base: notes }
      if (!edge) engine.preview(channel, hit.p, 0.2)
      return
    }
    const s = Math.floor(step)
    if (s >= total || pitch < LOW || pitch > HIGH) return
    const note = { id: uid('n'), p: pitch, s, l: Math.min(len, total - s), v: 0.85 }
    const next = [...notes, note]
    setNotes(next)
    engine.preview(channel, pitch, 0.2)
    drag.current = { mode: 'move', id: note.id, step0: step, pitch0: pitch, orig: note, base: next }
  }

  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    const { step, pitch } = locate(e)
    const o = d.orig
    let patch
    if (d.mode === 'resize') {
      patch = { l: Math.max(1, Math.min(total - o.s, Math.round(step - o.s))) }
    } else {
      const s = Math.max(0, Math.min(total - o.l, o.s + Math.round(step - d.step0)))
      const p = Math.max(LOW, Math.min(HIGH, o.p + (pitch - d.pitch0)))
      if (p !== d.lastPitch && p !== o.p) engine.preview(channel, p, 0.15)
      d.lastPitch = p
      patch = { s, p }
    }
    if (d.mode === 'resize' && patch.l !== o.l) setLen(patch.l)
    setNotes(d.base.map((n) => (n.id === d.id ? { ...n, ...patch } : n)))
  }

  const onPointerUp = () => {
    drag.current = null
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Piano Roll</span>
        <select
          className="h-8 rounded border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100"
          value={channel.id}
          onChange={(e) => dispatch({ type: 'set', patch: { pianoChannelId: e.target.value } })}
        >
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span>
          in <b style={{ color: pattern.color }}>{pattern.name}</b>
        </span>
        <label className="flex items-center gap-1">
          Notenlänge
          <select
            className="rounded border border-zinc-700 bg-zinc-900 px-1 py-1 font-mono"
            value={len}
            onChange={(e) => setLen(Number(e.target.value))}
          >
            {LENGTHS.map((l) => (
              <option key={l.steps} value={l.steps}>
                {l.label}
              </option>
            ))}
            {!LENGTHS.some((l) => l.steps === len) && <option value={len}>{len}/16</option>}
          </select>
        </label>
        <button
          className="rounded border border-zinc-700 px-2 py-1 hover:border-rose-400 hover:text-rose-200 disabled:opacity-40"
          disabled={!notes.length}
          onClick={() => setNotes([])}
        >
          Leeren
        </button>
        <span className="text-zinc-500">Klick = Note setzen · ziehen = verschieben · rechte Kante = Länge · Rechtsklick = löschen</span>
      </div>
      <div ref={scrollRef} className="relative h-64 overflow-auto rounded-md border border-zinc-800 bg-zinc-950">
        <div className="relative flex" style={{ width: KEYS_W + total * STEP_W, height: rows * ROW }}>
          <div className="sticky left-0 z-10 shrink-0 border-r border-zinc-700 bg-zinc-900" style={{ width: KEYS_W }}>
            {Array.from({ length: rows }, (_, i) => {
              const m = HIGH - i
              return (
                <button
                  key={m}
                  className={`block w-full border-b border-zinc-800 pr-1 text-right font-mono text-[9px] leading-none ${
                    isBlack(m) ? 'bg-zinc-800 text-zinc-500' : 'bg-zinc-200 text-zinc-600'
                  }`}
                  style={{ height: ROW }}
                  onPointerDown={() => engine.preview(channel, m, 0.3)}
                >
                  {m % 12 === 0 ? noteName(m) : ''}
                </button>
              )
            })}
          </div>
          <div
            className="relative cursor-crosshair"
            style={{
              width: total * STEP_W,
              height: rows * ROW,
              backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.16) 1px, transparent 1px), linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)`,
              backgroundSize: `${STEP_W * 16}px 100%, ${STEP_W * 4}px 100%, 100% ${ROW}px`,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onContextMenu={(e) => e.preventDefault()}
          >
            {Array.from({ length: rows }, (_, i) =>
              isBlack(HIGH - i) ? (
                <div key={i} className="pointer-events-none absolute inset-x-0 bg-black/30" style={{ top: i * ROW, height: ROW }} />
              ) : null,
            )}
            {playStep >= 0 && (
              <div className="pointer-events-none absolute inset-y-0 bg-white/10" style={{ left: playStep * STEP_W, width: STEP_W }} />
            )}
            {notes.map((n) => (
              <div
                key={n.id}
                className="pointer-events-none absolute rounded-sm border border-black/50 text-[8px] leading-none text-black/70"
                style={{
                  left: n.s * STEP_W + 1,
                  top: (HIGH - n.p) * ROW + 1,
                  width: n.l * STEP_W - 2,
                  height: ROW - 2,
                  background: pattern.color,
                  boxShadow: `0 0 6px ${pattern.color}88`,
                }}
              >
                <span className="pl-0.5">{n.l * STEP_W > 26 ? noteName(n.p) : ''}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
