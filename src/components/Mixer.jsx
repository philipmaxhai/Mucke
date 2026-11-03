import { useEffect, useRef } from 'react'
import { DEFAULT_FX } from '../audio/fx.js'
import FxPanel from './FxPanel.jsx'
import Knob from './Knob.jsx'

function VMeter({ read }) {
  const bar = useRef(null)
  useEffect(() => {
    let raf
    let shown = 0
    const tick = () => {
      shown = Math.max(read(), shown * 0.9)
      const db = shown > 0 ? 20 * Math.log10(shown) : -60
      const pct = Math.max(0, Math.min(100, ((db + 48) / 48) * 100))
      if (bar.current) {
        bar.current.style.height = `${pct}%`
        bar.current.style.background = shown >= 0.98 ? '#f43f5e' : shown > 0.7 ? '#facc15' : '#a3e635'
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [read])
  return (
    <div className="relative h-28 w-2 overflow-hidden rounded-sm bg-black">
      <div ref={bar} className="absolute inset-x-0 bottom-0" />
    </div>
  )
}

const vertical = { writingMode: 'vertical-lr', direction: 'rtl' }

const SLOTS = [
  { label: 'Filter', active: (fx) => fx.hp > DEFAULT_FX.hp + 1 || fx.lp < DEFAULT_FX.lp - 1 },
  { label: 'EQ', active: (fx) => fx.eqLow !== 0 || fx.eqMid !== 0 || fx.eqHigh !== 0 },
  { label: 'Delay', active: (fx) => fx.delayMix > 0 },
]

function Strip({ index, track, selected, routed, engine, dispatch }) {
  const update = (patch) => dispatch({ type: 'updateTrack', id: track.id, patch })
  const setFx = (patch) => dispatch({ type: 'updateFx', id: track.id, patch })
  const read = () => engine.trackLevel(track.id)
  return (
    <div
      className={`flex w-24 shrink-0 cursor-pointer flex-col items-center gap-2 rounded-md border px-1.5 py-2 ${
        selected ? 'border-zinc-400 bg-zinc-800/80' : 'border-zinc-800 bg-zinc-900/70 hover:border-zinc-600'
      }`}
      onPointerDown={() => !selected && dispatch({ type: 'set', patch: { selectedTrackId: track.id } })}
    >
      <div className="h-1 w-full rounded" style={{ background: track.color }} />
      <div className="flex w-full items-center gap-1 text-[10px] text-zinc-500">
        <span className="font-mono">{index + 1}</span>
        <span className="truncate text-xs font-semibold text-zinc-100">{track.name}</span>
      </div>
      <Knob
        label="Pan"
        size={34}
        value={track.fx.pan}
        min={-1}
        max={1}
        bipolar
        defaultValue={0}
        color={track.color}
        format={(v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)}
        onChange={(v) => setFx({ pan: v })}
      />
      <div className="flex items-end gap-2">
        <VMeter read={read} />
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.01}
          value={track.fx.volume}
          style={{ ...vertical, accentColor: track.color }}
          className="h-28 w-5"
          title={`${Math.round(track.fx.volume * 100)}%`}
          onChange={(e) => setFx({ volume: Number(e.target.value) })}
          onDoubleClick={() => setFx({ volume: 0.8 })}
        />
      </div>
      <div className="font-mono text-[10px] text-zinc-400">{Math.round(track.fx.volume * 100)}%</div>
      <div className="flex gap-1">
        <button
          className={`h-5 w-6 rounded text-[10px] font-bold ${track.mute ? 'bg-amber-400 text-zinc-900' : 'bg-zinc-800 text-zinc-400'}`}
          onClick={() => update({ mute: !track.mute })}
        >
          M
        </button>
        <button
          className={`h-5 w-6 rounded text-[10px] font-bold ${track.solo ? 'bg-cyan-400 text-zinc-900' : 'bg-zinc-800 text-zinc-400'}`}
          onClick={() => update({ solo: !track.solo })}
        >
          S
        </button>
      </div>
      <div className="flex w-full flex-col gap-0.5">
        {SLOTS.map((s) => (
          <div
            key={s.label}
            className={`rounded px-1 py-0.5 text-[10px] ${s.active(track.fx) ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-950 text-zinc-600'}`}
          >
            {s.active(track.fx) ? '●' : '○'} {s.label}
          </div>
        ))}
      </div>
      <div className="text-center text-[9px] leading-tight text-zinc-500" title={routed.join(', ')}>
        {routed.length ? `${routed.length} Kanal${routed.length > 1 ? 'e' : ''}` : 'Audio-Clips'}
      </div>
    </div>
  )
}

export default function Mixer({ state, dispatch, engine }) {
  const selected = state.tracks.find((t) => t.id === state.selectedTrackId) ?? state.tracks[0]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
        <div className="flex w-24 shrink-0 flex-col items-center gap-2 rounded-md border border-cyan-800 bg-cyan-950/30 px-1.5 py-2">
          <div className="h-1 w-full rounded bg-cyan-400" />
          <div className="text-xs font-semibold text-cyan-200">Master</div>
          <div className="h-[34px]" />
          <div className="flex items-end gap-2">
            <VMeter read={() => engine.level()} />
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.01}
              value={state.master.volume}
              style={{ ...vertical, accentColor: '#22d3ee' }}
              className="h-28 w-5"
              onChange={(e) => dispatch({ type: 'set', patch: { master: { ...state.master, volume: Number(e.target.value) } } })}
            />
          </div>
          <div className="font-mono text-[10px] text-zinc-400">{Math.round(state.master.volume * 100)}%</div>
          <button
            className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${state.master.limiter ? 'bg-cyan-400 text-zinc-900' : 'bg-zinc-800 text-zinc-400'}`}
            onClick={() => dispatch({ type: 'set', patch: { master: { ...state.master, limiter: !state.master.limiter } } })}
          >
            Limiter
          </button>
        </div>
        {state.tracks.map((t, i) => (
          <Strip
            key={t.id}
            index={i}
            track={t}
            selected={t.id === selected.id}
            routed={state.channels.filter((c) => c.insertId === t.id).map((c) => c.name)}
            engine={engine}
            dispatch={dispatch}
          />
        ))}
        <button
          className="w-16 shrink-0 rounded-md border border-dashed border-zinc-700 text-xs text-zinc-500 hover:border-zinc-500 hover:text-zinc-200"
          onClick={() => dispatch({ type: 'addTrack' })}
        >
          + Insert
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
        <FxPanel track={selected} dispatch={dispatch} />
      </div>
    </div>
  )
}
