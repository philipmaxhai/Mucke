import { useCallback, useEffect, useState } from 'react'
import { desktopApi } from '../audio/desktop.js'

// Windows desktop app only: pick which apps get recorded, and mute apps in the Windows volume mixer.
export default function DesktopRecordDialog({ open, onClose, onStart, notify }) {
  const [apps, setApps] = useState([])
  const [picked, setPicked] = useState(() => new Set())
  const [mode, setMode] = useState('apps')
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await desktopApi().listApps()
      setApps(list)
      setPicked((prev) => {
        const next = new Set([...prev].filter((pid) => list.some((a) => a.pid === pid)))
        // preselect Spotify when nothing is picked yet
        if (!next.size) list.filter((a) => /spotify/i.test(a.name)).forEach((a) => next.add(a.pid))
        return next
      })
    } catch (err) {
      notify(`Apps konnten nicht gelesen werden: ${err?.message || err}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    if (!open) return
    refresh()
    const id = setInterval(refresh, 3000)
    return () => clearInterval(id)
  }, [open, refresh])

  if (!open) return null

  const toggle = (pid) =>
    setPicked((prev) => {
      const next = new Set(prev)
      next.has(pid) ? next.delete(pid) : next.add(pid)
      return next
    })

  const setMute = async (app) => {
    try {
      await desktopApi().setMute(app.pid, !app.muted)
      setApps((list) => list.map((a) => (a.pid === app.pid ? { ...a, muted: !app.muted } : a)))
    } catch (err) {
      notify(String(err?.message || err), 'error')
    }
  }

  const start = () => {
    if (mode === 'desktop') onStart([{ pid: 0, label: 'Desktop', mode: 'exclude' }])
    else onStart(apps.filter((a) => picked.has(a.pid)).map((a) => ({ pid: a.pid, label: a.label, mode: 'include' })))
  }

  const canStart = mode === 'desktop' || picked.size > 0

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onPointerDown={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Desktop-Audio aufnehmen</h2>
            <p className="text-xs text-zinc-500">Nimmt auf, was die gewählten Programme abspielen. Jede App landet auf einer eigenen Spur.</p>
          </div>
          <button className="text-zinc-500 hover:text-zinc-200" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="flex gap-2 text-sm">
          {[
            ['apps', 'Nur ausgewählte Apps'],
            ['desktop', 'Ganzer Desktop (ohne Mucke)'],
          ].map(([m, label]) => (
            <button
              key={m}
              className={`flex-1 rounded-md border px-3 py-2 ${mode === m ? 'border-rose-400 bg-rose-500/15 text-rose-100' : 'border-zinc-700 text-zinc-400 hover:text-zinc-100'}`}
              onClick={() => setMode(m)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            <span>Programme mit Ton</span>
            <button className="normal-case tracking-normal text-zinc-400 hover:text-zinc-100" onClick={refresh}>
              {loading ? 'lädt …' : '↻ Aktualisieren'}
            </button>
          </div>
          {!apps.length && !loading && (
            <div className="rounded-md border border-zinc-800 p-3 text-sm text-zinc-500">
              Keine Programme mit Audio gefunden. Starte die Wiedergabe in Spotify (oder einer anderen App) und klick auf Aktualisieren.
            </div>
          )}
          {apps.map((a) => (
            <div key={a.pid} className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-rose-500"
                disabled={mode === 'desktop'}
                checked={mode === 'desktop' || picked.has(a.pid)}
                onChange={() => toggle(a.pid)}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-zinc-100">{a.label}</div>
                <div className="font-mono text-[10px] text-zinc-500">
                  {a.name} · PID {a.pid}
                </div>
              </div>
              {a.active && <span className="text-xs text-lime-400" title="spielt gerade Ton ab">♪ spielt</span>}
              <button
                className={`rounded px-2 py-1 text-xs ${a.muted ? 'bg-amber-400 text-zinc-900' : 'border border-zinc-700 text-zinc-400 hover:text-zinc-100'}`}
                onClick={() => setMute(a)}
                title="In Windows stummschalten (Lautstärkemixer). Bei „Ganzer Desktop“ fehlt die App dann auch in der Aufnahme."
              >
                {a.muted ? '🔇 stumm' : '🔈 an'}
              </button>
            </div>
          ))}
        </div>

        <p className="text-xs leading-relaxed text-zinc-500">
          „Stumm“ schaltet die App im Windows-Lautstärkemixer stumm. Um eine App nur aus der Aufnahme rauszuhalten, nimm einfach „Nur
          ausgewählte Apps“ und lass sie abgewählt. Kopierschutz wird nicht umgangen: aufgenommen wird nur, was die App ohnehin an deine
          Lautsprecher schickt. Spotify verbietet Mitschnitte in den Nutzungsbedingungen, also bitte nur privat nutzen.
        </p>

        <div className="flex justify-end gap-2">
          <button className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500" onClick={onClose}>
            Abbrechen
          </button>
          <button
            className="rounded-md bg-rose-500 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-400 disabled:opacity-40"
            disabled={!canStart}
            onClick={start}
          >
            ● Aufnahme starten
          </button>
        </div>
      </div>
    </div>
  )
}
