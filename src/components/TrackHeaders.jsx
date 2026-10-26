import { LANE_H, RULER_H } from './Timeline.jsx'

export default function TrackHeaders({ state, dispatch }) {
  const update = (id, patch) => dispatch({ type: 'updateTrack', id, patch })
  return (
    <div className="w-48 shrink-0 border-r border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-2" style={{ height: RULER_H }}>
        <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Spuren</span>
        <button
          className="rounded px-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          onClick={() => dispatch({ type: 'addTrack' })}
        >
          + Spur
        </button>
      </div>
      {state.tracks.map((t) => {
        const selected = t.id === state.selectedTrackId
        return (
          <div
            key={t.id}
            className={`group relative flex flex-col justify-center gap-1.5 border-b border-zinc-800 px-3 ${selected ? 'bg-zinc-800/60' : 'bg-zinc-900/40 hover:bg-zinc-900'}`}
            style={{ height: LANE_H }}
            onPointerDown={() => !selected && dispatch({ type: 'set', patch: { selectedTrackId: t.id } })}
          >
            <div className="absolute inset-y-0 left-0 w-1" style={{ background: t.color, boxShadow: selected ? `0 0 10px ${t.color}` : 'none' }} />
            <div className="flex items-center gap-1">
              <input
                className="min-w-0 flex-1 truncate rounded bg-transparent text-sm font-medium text-zinc-100 outline-none focus:bg-zinc-800"
                value={t.name}
                onChange={(e) => update(t.id, { name: e.target.value })}
              />
              <button
                title="Spur löschen"
                className="hidden rounded px-1 text-xs text-zinc-500 hover:text-rose-400 group-hover:block"
                onClick={() => dispatch({ type: 'removeTrack', id: t.id })}
              >
                ✕
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                className={`h-5 w-6 rounded text-[10px] font-bold ${t.mute ? 'bg-amber-400 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-100'}`}
                onClick={() => update(t.id, { mute: !t.mute })}
                title="Mute"
              >
                M
              </button>
              <button
                className={`h-5 w-6 rounded text-[10px] font-bold ${t.solo ? 'bg-cyan-400 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-100'}`}
                onClick={() => update(t.id, { solo: !t.solo })}
                title="Solo"
              >
                S
              </button>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.01}
                value={t.fx.volume}
                title="Lautstärke"
                className="min-w-0 flex-1"
                style={{ accentColor: t.color }}
                onChange={(e) => dispatch({ type: 'updateFx', id: t.id, patch: { volume: Number(e.target.value) } })}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
