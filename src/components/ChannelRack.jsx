import { useEffect, useRef, useState } from 'react'
import { DRUMS, SYNTHS } from '../audio/instruments.js'
import { STEPS_PER_BAR, patternDuration } from '../audio/patterns.js'
import { makeChannel } from '../state/project.js'

const small = 'rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-40'

// Current 16th step while the pattern loop plays, or -1.
export function usePlayStep(engine, playing, state, pattern) {
  const [step, setStep] = useState(-1)
  useEffect(() => {
    if (!playing || state.mode !== 'pattern' || !pattern) {
      setStep(-1)
      return
    }
    let raf
    const stepSec = 60 / state.bpm / 4
    const total = pattern.bars * STEPS_PER_BAR
    const tick = () => {
      setStep(Math.floor(engine.position() / stepSec) % total)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engine, playing, state.mode, state.bpm, pattern])
  return step
}

export function PatternBar({ state, dispatch, pattern, onAddToPlaylist }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="h-8 rounded border border-zinc-700 bg-zinc-900 px-2 text-sm font-semibold"
        style={{ color: pattern.color }}
        value={pattern.id}
        onChange={(e) => dispatch({ type: 'set', patch: { currentPatternId: e.target.value } })}
      >
        {state.patterns.map((p) => (
          <option key={p.id} value={p.id} className="bg-zinc-900 text-zinc-100">
            {p.name}
          </option>
        ))}
      </select>
      <input
        className="h-8 w-28 rounded border border-zinc-800 bg-transparent px-2 text-sm outline-none focus:border-zinc-600"
        value={pattern.name}
        title="Pattern umbenennen"
        onChange={(e) => dispatch({ type: 'updatePattern', id: pattern.id, patch: { name: e.target.value } })}
      />
      <button className={small} onClick={() => dispatch({ type: 'addPattern' })} title="Neues leeres Pattern">
        + Neu
      </button>
      <button className={small} onClick={() => dispatch({ type: 'addPattern', cloneOf: pattern.id })} title="Pattern kopieren">
        ⧉ Klonen
      </button>
      <button
        className={small}
        disabled={state.patterns.length <= 1}
        onClick={() => dispatch({ type: 'removePattern', id: pattern.id })}
        title="Pattern löschen (auch aus der Playlist)"
      >
        ✕
      </button>
      <label className="flex items-center gap-1 text-xs text-zinc-400">
        Länge
        <select
          className="rounded border border-zinc-700 bg-zinc-900 px-1 py-1 font-mono"
          value={pattern.bars}
          onChange={(e) => {
            const bars = Number(e.target.value)
            // grow step rows by repeating the existing bars, like FL does when you lengthen a pattern
            const steps = {}
            for (const [id, row] of Object.entries(pattern.steps)) {
              steps[id] = Array.from({ length: bars * STEPS_PER_BAR }, (_, i) => row[i] ?? row[i % Math.max(1, row.length)] ?? 0)
            }
            dispatch({ type: 'updatePattern', id: pattern.id, patch: { bars, steps } })
          }}
        >
          {[1, 2, 4, 8].map((b) => (
            <option key={b} value={b}>
              {b} {b === 1 ? 'Takt' : 'Takte'}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-zinc-400" title="Swing verschiebt jede zweite 16tel nach hinten">
        Swing
        <input
          type="range"
          min={0}
          max={0.6}
          step={0.01}
          value={pattern.swing}
          onChange={(e) => dispatch({ type: 'updatePattern', id: pattern.id, patch: { swing: Number(e.target.value) } })}
        />
        <span className="w-8 font-mono">{Math.round(pattern.swing * 100)}%</span>
      </label>
      <button
        className={`${small} ml-auto border-orange-500/60 text-orange-200`}
        onClick={onAddToPlaylist}
        title="Pattern an der Playhead-Position auf die ausgewählte Spur der Playlist legen"
      >
        ⤓ In Playlist
      </button>
    </div>
  )
}

function StepRow({ steps, total, color, playStep, onChange }) {
  const paint = useRef(null)
  const row = Array.from({ length: total }, (_, i) => steps?.[i] ?? 0)
  const set = (i, v) => {
    if (row[i] === v) return
    const next = [...row]
    next[i] = v
    onChange(next)
  }
  return (
    <div className="flex gap-[3px]" onPointerUp={() => (paint.current = null)} onPointerLeave={() => (paint.current = null)}>
      {row.map((v, i) => {
        const beatShade = Math.floor(i / 4) % 2 === 0
        return (
          <button
            key={i}
            className={`h-7 w-6 shrink-0 rounded-sm border transition-colors ${i % 16 === 0 && i ? 'ml-1.5' : ''} ${
              playStep === i ? 'border-zinc-100' : 'border-black/40'
            }`}
            style={{
              background: v > 0 ? color : beatShade ? '#3f3f46' : '#27272a',
              boxShadow: v > 0 ? `0 0 8px ${color}88` : 'none',
              opacity: v > 0 ? 0.45 + v * 0.55 : 1,
            }}
            onPointerDown={(e) => {
              e.preventDefault()
              e.currentTarget.releasePointerCapture?.(e.pointerId)
              const nv = e.button === 2 ? 0 : v > 0 ? 0 : 1
              paint.current = nv
              set(i, nv)
            }}
            onPointerEnter={() => paint.current !== null && set(i, paint.current)}
            onContextMenu={(e) => e.preventDefault()}
          />
        )
      })}
    </div>
  )
}

function AddChannelMenu({ state, dispatch, sampleOptions, onLoadSample }) {
  return (
    <select
      className={small}
      value=""
      onChange={(e) => {
        const v = e.target.value
        e.target.value = ''
        if (!v) return
        const insertId = state.selectedTrackId
        const [kind, preset] = v.split(':')
        if (kind === 'file') return onLoadSample()
        if (kind === 'drum') {
          dispatch({ type: 'addChannel', channel: makeChannel('drum', preset, DRUMS.find((d) => d.id === preset).label, insertId) })
        } else if (kind === 'synth') {
          const s = SYNTHS.find((d) => d.id === preset)
          dispatch({ type: 'addChannel', channel: makeChannel('synth', preset, s.label, insertId, { root: s.root }) })
        } else if (kind === 'sample') {
          const opt = sampleOptions.find((o) => o.id === preset)
          dispatch({ type: 'addChannel', channel: makeChannel('sample', null, opt?.name ?? 'Sample', insertId, { sampleId: preset }) })
        }
      }}
    >
      <option value="">+ Kanal …</option>
      <optgroup label="Drums">
        {DRUMS.map((d) => (
          <option key={d.id} value={`drum:${d.id}`}>
            {d.label}
          </option>
        ))}
      </optgroup>
      <optgroup label="Synth">
        {SYNTHS.map((d) => (
          <option key={d.id} value={`synth:${d.id}`}>
            {d.label}
          </option>
        ))}
      </optgroup>
      <optgroup label="Sampler">
        <option value="file:">Audiodatei laden …</option>
        {sampleOptions.map((o) => (
          <option key={o.id} value={`sample:${o.id}`}>
            Aus Clip: {o.name}
          </option>
        ))}
      </optgroup>
    </select>
  )
}

export default function ChannelRack({ state, dispatch, engine, playing, pattern, sampleOptions, onLoadSample, onAddToPlaylist }) {
  const playStep = usePlayStep(engine, playing, state, pattern)
  const total = pattern.bars * STEPS_PER_BAR
  const update = (id, patch) => dispatch({ type: 'updateChannel', id, patch })

  return (
    <div className="flex flex-col gap-3">
      <PatternBar state={state} dispatch={dispatch} pattern={pattern} onAddToPlaylist={onAddToPlaylist} />
      <div className="overflow-x-auto pb-1">
        <div className="flex w-max flex-col gap-1">
          {state.channels.map((ch) => {
            const track = state.tracks.find((t) => t.id === ch.insertId)
            const color = track?.color ?? '#a1a1aa'
            const noteCount = pattern.notes[ch.id]?.length ?? 0
            const presets = ch.kind === 'drum' ? DRUMS : ch.kind === 'synth' ? SYNTHS : null
            return (
              <div key={ch.id} className="group flex items-center gap-2">
                <button
                  className={`h-4 w-4 shrink-0 rounded-full border ${ch.mute ? 'border-zinc-600 bg-zinc-800' : 'border-lime-300 bg-lime-400 shadow-[0_0_6px_#a3e635]'}`}
                  onClick={() => update(ch.id, { mute: !ch.mute })}
                  title="Kanal an/aus"
                />
                <button
                  className={`h-5 w-5 shrink-0 rounded text-[10px] font-bold ${ch.solo ? 'bg-cyan-400 text-zinc-900' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-200'}`}
                  onClick={() => update(ch.id, { solo: !ch.solo })}
                  title="Solo"
                >
                  S
                </button>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={ch.pan}
                  title={`Pan ${Math.round(ch.pan * 100)}`}
                  className="w-10"
                  onChange={(e) => update(ch.id, { pan: Number(e.target.value) })}
                  onDoubleClick={() => update(ch.id, { pan: 0 })}
                />
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.01}
                  value={ch.volume}
                  title={`Lautstärke ${Math.round(ch.volume * 100)}%`}
                  className="w-14"
                  style={{ accentColor: color }}
                  onChange={(e) => update(ch.id, { volume: Number(e.target.value) })}
                />
                <select
                  className="w-14 shrink-0 rounded border border-zinc-800 bg-zinc-900 px-0.5 py-1 font-mono text-[10px]"
                  style={{ color }}
                  value={ch.insertId}
                  title="Mixer-Insert, auf den dieser Kanal geht"
                  onChange={(e) => update(ch.id, { insertId: e.target.value })}
                >
                  {state.tracks.map((t, i) => (
                    <option key={t.id} value={t.id} className="bg-zinc-900 text-zinc-100">
                      {i + 1} {t.name}
                    </option>
                  ))}
                </select>
                <button
                  className="w-28 shrink-0 truncate rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-left text-xs font-semibold text-zinc-100 hover:border-zinc-400"
                  style={{ borderLeft: `4px solid ${color}` }}
                  onClick={() => engine.preview(ch)}
                  title="Anhören"
                >
                  {ch.name}
                </button>
                {presets ? (
                  <select
                    className="w-20 shrink-0 rounded border border-zinc-800 bg-zinc-900 px-0.5 py-1 text-[10px] text-zinc-400"
                    value={ch.preset}
                    title="Sound"
                    onChange={(e) => {
                      const p = presets.find((x) => x.id === e.target.value)
                      update(ch.id, { preset: p.id, ...(p.root ? { root: p.root } : {}) })
                      engine.preview({ ...ch, preset: p.id })
                    }}
                  >
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    className="w-20 shrink-0 rounded border border-zinc-800 bg-zinc-900 px-0.5 py-1 text-[10px] text-zinc-400"
                    value={ch.sampleId ?? ''}
                    title="Sample"
                    onChange={(e) => update(ch.id, { sampleId: e.target.value })}
                  >
                    {!sampleOptions.some((o) => o.id === ch.sampleId) && <option value={ch.sampleId ?? ''}>{ch.name}</option>}
                    {sampleOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="number"
                  min={-24}
                  max={24}
                  value={ch.pitch}
                  title="Tonhöhe in Halbtönen"
                  className="w-10 shrink-0 rounded border border-zinc-800 bg-zinc-900 px-1 py-1 font-mono text-[10px] text-zinc-400"
                  onChange={(e) => update(ch.id, { pitch: Math.max(-24, Math.min(24, Number(e.target.value) || 0)) })}
                />
                <StepRow
                  steps={pattern.steps[ch.id]}
                  total={total}
                  color={color}
                  playStep={playStep}
                  onChange={(steps) => dispatch({ type: 'setSteps', id: pattern.id, channelId: ch.id, steps })}
                />
                <button
                  className={`ml-1 h-7 shrink-0 rounded border px-2 text-xs ${
                    noteCount
                      ? 'border-fuchsia-400/70 bg-fuchsia-500/15 text-fuchsia-200'
                      : 'border-zinc-700 text-zinc-400 hover:text-zinc-100'
                  }`}
                  onClick={() => dispatch({ type: 'set', patch: { dock: 'piano', pianoChannelId: ch.id } })}
                  title="In der Piano Roll bearbeiten"
                >
                  🎹{noteCount ? ` ${noteCount}` : ''}
                </button>
                <button
                  className="h-7 shrink-0 rounded px-1 text-xs text-zinc-600 hover:text-rose-400"
                  onClick={() => dispatch({ type: 'removeChannel', id: ch.id })}
                  title="Kanal löschen"
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <AddChannelMenu state={state} dispatch={dispatch} sampleOptions={sampleOptions} onLoadSample={onLoadSample} />
        <span>
          Klick = Step an/aus · ziehen = malen · Rechtsklick = löschen · Name = anhören · 🎹 = Melodie in der Piano Roll ·{' '}
          {patternDuration(pattern, state.bpm).toFixed(2)} s pro Durchlauf
        </span>
      </div>
    </div>
  )
}
