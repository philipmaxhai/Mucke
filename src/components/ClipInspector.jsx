import { useState } from 'react'
import { beatSec, formatPosition } from '../state/project.js'

export default function ClipInspector({ clip, state, onUpdate, onSplit, onDuplicate, onLoopClip, onDelete, bufferDuration }) {
  const [origBpm, setOrigBpm] = useState('')
  if (!clip) {
    return (
      <div className="text-sm leading-relaxed text-zinc-500">
        Kein Clip ausgewählt. Nimm Tab-Audio auf oder zieh eine Audiodatei in die Timeline.
      </div>
    )
  }
  const beats = clip.length / beatSec(state.bpm)

  const applyRate = (rate) => {
    rate = Math.min(4, Math.max(0.25, rate))
    const maxLen = (bufferDuration - clip.offset) / rate
    onUpdate({ rate, length: Math.min(maxLen, (clip.length * clip.rate) / rate) })
  }

  const btn = 'rounded border border-zinc-700 px-2 py-1 text-xs hover:border-fuchsia-400 hover:text-fuchsia-200'

  return (
    <div className="flex flex-col gap-2 text-sm">
      <input
        className="rounded bg-transparent font-semibold text-zinc-100 outline-none focus:bg-zinc-800"
        value={clip.name}
        onChange={(e) => onUpdate({ name: e.target.value }, false)}
      />
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs text-zinc-400">
        <span>Start</span>
        <span className="text-zinc-200">{formatPosition(clip.start, state.bpm)}</span>
        <span>Länge</span>
        <span className="text-zinc-200">{beats.toFixed(2)} Beats</span>
        <span>Gain</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.01}
          value={clip.gain}
          onChange={(e) => onUpdate({ gain: Number(e.target.value) }, false)}
        />
        <span>Fade In</span>
        <input
          type="range"
          min={0}
          max={Math.min(16, beats / 2)}
          step={0.25}
          value={(clip.fadeIn || 0) / beatSec(state.bpm)}
          onChange={(e) => onUpdate({ fadeIn: Number(e.target.value) * beatSec(state.bpm) }, false)}
          title="Einblenden in Beats"
        />
        <span>Fade Out</span>
        <input
          type="range"
          min={0}
          max={Math.min(16, beats / 2)}
          step={0.25}
          value={(clip.fadeOut || 0) / beatSec(state.bpm)}
          onChange={(e) => onUpdate({ fadeOut: Number(e.target.value) * beatSec(state.bpm) }, false)}
          title="Ausblenden in Beats"
        />
        <span>Tempo</span>
        <span className="text-zinc-200">{(clip.rate * 100).toFixed(1)}%</span>
      </div>
      <div className="flex items-center gap-1 text-xs">
        <input
          className="w-16 rounded border border-zinc-700 bg-zinc-900 px-1 py-1 font-mono"
          placeholder="Orig-BPM"
          value={origBpm}
          onChange={(e) => setOrigBpm(e.target.value)}
        />
        <button
          className={btn}
          title="Varispeed wie am Plattenspieler: Clip wird schneller/langsamer (Tonhöhe ändert sich mit)"
          onClick={() => Number(origBpm) > 0 && applyRate(state.bpm / Number(origBpm))}
        >
          → {state.bpm} BPM
        </button>
        {clip.rate !== 1 && (
          <button className={btn} onClick={() => applyRate(1)}>
            1:1
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        <button className={btn} onClick={onSplit} title="Am Playhead schneiden (S)">
          Schneiden
        </button>
        <button className={btn} onClick={onDuplicate} title="Dahinter kopieren (Strg+D)">
          Duplizieren
        </button>
        <button className={btn} onClick={onLoopClip} title="Loop-Bereich auf diesen Clip setzen (P)">
          Als Loop
        </button>
        <button className={btn + ' hover:border-rose-400 hover:text-rose-300'} onClick={onDelete} title="Entf">
          Löschen
        </button>
      </div>
    </div>
  )
}
