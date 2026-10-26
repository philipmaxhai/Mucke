import Knob from './Knob.jsx'
import { DEFAULT_FX, DELAY_DIVISIONS } from '../audio/fx.js'

const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : Math.round(v)) + ' Hz'
const db = (v) => (v <= -29.5 ? 'KILL' : `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`)
const pct = (v) => `${Math.round(v * 100)}%`
const panFmt = (v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)

function Group({ title, children }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">{title}</div>
      <div className="flex items-start gap-3">{children}</div>
    </div>
  )
}

export default function FxPanel({ track, dispatch }) {
  if (!track) return null
  const fx = track.fx
  const set = (patch) => dispatch({ type: 'updateFx', id: track.id, patch })
  const color = track.color

  return (
    <div className="flex flex-wrap items-stretch gap-3">
      <div className="flex min-w-32 flex-col justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">FX-Kette</div>
          <div className="text-lg font-semibold" style={{ color }}>
            {track.name}
          </div>
        </div>
        <button
          className="self-start rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          onClick={() => set({ ...DEFAULT_FX, volume: fx.volume, pan: fx.pan })}
        >
          FX zurücksetzen
        </button>
      </div>

      <Group title="Filter">
        <Knob label="Highpass" value={fx.hp} min={20} max={8000} log defaultValue={20} format={hz} color={color} onChange={(v) => set({ hp: v })} />
        <Knob label="Lowpass" value={fx.lp} min={60} max={20000} log defaultValue={20000} format={hz} color={color} onChange={(v) => set({ lp: v })} />
      </Group>

      <Group title="EQ">
        <Knob label="Low" value={fx.eqLow} min={-30} max={6} bipolar defaultValue={0} format={db} color={color} onChange={(v) => set({ eqLow: v })} />
        <Knob label="Mid" value={fx.eqMid} min={-30} max={6} bipolar defaultValue={0} format={db} color={color} onChange={(v) => set({ eqMid: v })} />
        <Knob label="High" value={fx.eqHigh} min={-30} max={6} bipolar defaultValue={0} format={db} color={color} onChange={(v) => set({ eqHigh: v })} />
      </Group>

      <Group title="Delay">
        <Knob label="Mix" value={fx.delayMix} min={0} max={1} defaultValue={0} format={pct} color={color} onChange={(v) => set({ delayMix: v })} />
        <Knob label="Feedback" value={fx.delayFeedback} min={0} max={0.9} defaultValue={0.35} format={pct} color={color} onChange={(v) => set({ delayFeedback: v })} />
        <div className="flex flex-col items-center gap-1">
          <select
            className="mt-2 rounded border border-zinc-700 bg-zinc-900 px-1 py-1 font-mono text-xs"
            value={fx.delayBeats}
            onChange={(e) => set({ delayBeats: Number(e.target.value) })}
          >
            {DELAY_DIVISIONS.map((d) => (
              <option key={d.beats} value={d.beats}>
                {d.label}
              </option>
            ))}
          </select>
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Zeit</div>
        </div>
      </Group>

      <Group title="Kanal">
        <Knob label="Volume" value={fx.volume} min={0} max={1.5} defaultValue={0.8} format={pct} color={color} onChange={(v) => set({ volume: v })} />
        <Knob label="Pan" value={fx.pan} min={-1} max={1} bipolar defaultValue={0} format={panFmt} color={color} onChange={(v) => set({ pan: v })} />
      </Group>
    </div>
  )
}
