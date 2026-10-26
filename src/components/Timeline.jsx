import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { songEnd } from '../audio/schedule.js'
import { beatSec, snapTime, splitClip, uid } from '../state/project.js'

export const RULER_H = 28
export const LANE_H = 84
const EDGE = 7
const CLIP_HEADER = 15
const MIN_LEN = 0.02

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

export default function Timeline({ state, dispatch, engine, playing, onSeek, onDropFiles }) {
  const scrollRef = useRef(null)
  const canvasRef = useRef(null)
  const playheadRef = useRef(null)
  const dragRef = useRef(null)
  const pendingScroll = useRef(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const [width, setWidth] = useState(800)

  const { zoom, tracks, clips, loop } = state
  const totalSec = Math.max(songEnd(clips) + 60, loop.end + 30, width / zoom + 10, 180)
  const contentW = Math.ceil(totalSec * zoom)
  const height = RULER_H + tracks.length * LANE_H

  // --- drawing ---------------------------------------------------------------

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const scroller = scrollRef.current
    if (!canvas || !scroller) return
    const s = stateRef.current
    const w = scroller.clientWidth
    const h = RULER_H + s.tracks.length * LANE_H
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const sx = scroller.scrollLeft
    const z = s.zoom
    const beat = beatSec(s.bpm)
    const pxBeat = beat * z
    const t0 = sx / z
    const t1 = (sx + w) / z

    ctx.fillStyle = '#0c0c0f'
    ctx.fillRect(0, 0, w, h)

    // alternating 4-bar phrases make 8/16-bar house structures easy to read
    const phrase = beat * 16
    for (let p = Math.floor(t0 / phrase); p * phrase < t1; p++) {
      if (p % 2) continue
      ctx.fillStyle = '#111116'
      ctx.fillRect(p * phrase * z - sx, RULER_H, phrase * z, h - RULER_H)
    }

    // lanes
    s.tracks.forEach((t, i) => {
      const y = RULER_H + i * LANE_H
      if (t.id === s.selectedTrackId) {
        ctx.fillStyle = 'rgba(255,255,255,0.025)'
        ctx.fillRect(0, y, w, LANE_H)
      }
      ctx.fillStyle = '#1f1f24'
      ctx.fillRect(0, y + LANE_H - 1, w, 1)
    })

    // grid
    const steps = [0.25, 0.5, 1, 4, 8, 16, 32, 64]
    const step = steps.find((st) => st * pxBeat >= 9) ?? 64
    for (let b = Math.floor(t0 / beat / step) * step; b * beat <= t1; b += step) {
      const x = Math.round(b * beat * z - sx) + 0.5
      const isBar = Math.abs(b % 4) < 1e-6
      const isBeat = Math.abs(b % 1) < 1e-6
      ctx.fillStyle = isBar ? (Math.abs(b % 16) < 1e-6 ? '#4b4b55' : '#34343c') : isBeat ? '#24242a' : '#18181d'
      ctx.fillRect(x, RULER_H, 1, h - RULER_H)
    }

    // loop region over lanes
    const lx0 = s.loop.start * z - sx
    const lx1 = s.loop.end * z - sx
    if (s.loop.enabled) {
      ctx.fillStyle = 'rgba(232,121,249,0.06)'
      ctx.fillRect(lx0, RULER_H, lx1 - lx0, h - RULER_H)
    }

    // clips
    for (const clip of s.clips) {
      const lane = s.tracks.findIndex((t) => t.id === clip.trackId)
      if (lane < 0) continue
      const x = clip.start * z - sx
      const cw = clip.length * z
      if (x > w || x + cw < 0) continue
      const track = s.tracks[lane]
      const y = RULER_H + lane * LANE_H + 3
      const ch = LANE_H - 7
      const selected = clip.id === s.selectedClipId

      ctx.save()
      roundRect(ctx, x + 0.5, y + 0.5, Math.max(2, cw - 1), ch, 4)
      ctx.fillStyle = hexA(track.color, track.mute ? 0.06 : 0.16)
      ctx.fill()
      ctx.lineWidth = selected ? 2 : 1
      ctx.strokeStyle = selected ? '#fafafa' : hexA(track.color, 0.7)
      ctx.stroke()
      ctx.clip()

      ctx.fillStyle = hexA(track.color, track.mute ? 0.2 : 0.55)
      ctx.fillRect(x, y, cw, CLIP_HEADER)
      ctx.fillStyle = '#09090b'
      ctx.font = '600 10px Inter, system-ui, sans-serif'
      ctx.fillText(clip.name, Math.max(x, 0) + 5, y + 11)

      const peaks = engine.peaks.get(clip.bufferId)
      if (peaks) {
        const mid = y + CLIP_HEADER + (ch - CLIP_HEADER) / 2
        const amp = ((ch - CLIP_HEADER) / 2 - 2) * Math.min(2, clip.gain)
        ctx.fillStyle = track.mute ? '#52525b' : track.color
        const pxStart = Math.max(0, Math.floor(x))
        const pxEnd = Math.min(w, Math.ceil(x + cw))
        const secPerPx = clip.rate / z
        for (let px = pxStart; px < pxEnd; px++) {
          const src = clip.offset + (px - x) * secPerPx
          let i0 = Math.floor(src * peaks.rate)
          const i1 = Math.max(i0 + 1, Math.floor((src + secPerPx) * peaks.rate))
          let lo = 0
          let hi = 0
          for (; i0 < i1 && i0 < peaks.min.length; i0++) {
            if (i0 < 0) continue
            if (peaks.min[i0] < lo) lo = peaks.min[i0]
            if (peaks.max[i0] > hi) hi = peaks.max[i0]
          }
          const top = mid - Math.min(1, hi) * amp
          ctx.fillRect(px, top, 1, Math.max(1, (Math.min(1, hi) - Math.max(-1, lo)) * amp))
        }
      }
      ctx.restore()
    }

    // ruler
    ctx.fillStyle = '#16161a'
    ctx.fillRect(0, 0, w, RULER_H)
    if (s.loop.end > s.loop.start) {
      ctx.fillStyle = s.loop.enabled ? 'rgba(232,121,249,0.55)' : 'rgba(161,161,170,0.25)'
      ctx.fillRect(lx0, 2, lx1 - lx0, 9)
    }
    const barPx = pxBeat * 4
    const labelEvery = [1, 2, 4, 8, 16, 32, 64].find((n) => n * barPx >= 34) ?? 64
    ctx.font = '10px "JetBrains Mono", ui-monospace, monospace'
    for (let bar = Math.floor(t0 / (beat * 4)); bar * beat * 4 <= t1; bar++) {
      if (bar % labelEvery) continue
      const x = Math.round(bar * beat * 4 * z - sx) + 0.5
      ctx.fillStyle = '#52525b'
      ctx.fillRect(x, 12, 1, RULER_H - 12)
      ctx.fillStyle = bar % 4 === 0 ? '#e4e4e7' : '#a1a1aa'
      ctx.fillText(String(bar + 1), x + 4, RULER_H - 6)
    }
    ctx.fillStyle = '#27272a'
    ctx.fillRect(0, RULER_H - 1, w, 1)
  }, [engine])

  useEffect(() => {
    draw()
  }, [draw, state, width])

  useLayoutEffect(() => {
    if (pendingScroll.current !== null && scrollRef.current) {
      scrollRef.current.scrollLeft = pendingScroll.current
      pendingScroll.current = null
      draw()
    }
  }, [zoom, draw])

  useEffect(() => {
    const el = scrollRef.current
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Ctrl/Cmd + wheel zooms around the mouse position.
  useEffect(() => {
    const el = scrollRef.current
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const s = stateRef.current
      const mx = e.clientX - el.getBoundingClientRect().left
      const t = (el.scrollLeft + mx) / s.zoom
      const z = Math.min(1200, Math.max(4, s.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
      pendingScroll.current = Math.max(0, t * z - mx)
      dispatch({ type: 'set', patch: { zoom: z } })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [dispatch])

  // playhead
  useEffect(() => {
    const el = playheadRef.current
    if (!playing) {
      el.style.transform = `translateX(${state.playhead * zoom}px)`
      return
    }
    let raf
    const loopFn = () => {
      const pos = engine.position()
      const px = pos * stateRef.current.zoom
      el.style.transform = `translateX(${px}px)`
      const sc = scrollRef.current
      if (!dragRef.current && (px > sc.scrollLeft + sc.clientWidth - 40 || px < sc.scrollLeft)) {
        sc.scrollLeft = Math.max(0, px - 60)
      }
      raf = requestAnimationFrame(loopFn)
    }
    raf = requestAnimationFrame(loopFn)
    return () => cancelAnimationFrame(raf)
  }, [playing, state.playhead, zoom, engine])

  // --- interaction -----------------------------------------------------------

  const locate = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft
    const y = e.clientY - rect.top
    return { x, y, t: x / stateRef.current.zoom }
  }

  const hit = (x, y) => {
    const s = stateRef.current
    if (y < RULER_H) return { area: 'ruler' }
    const lane = Math.floor((y - RULER_H) / LANE_H)
    const track = s.tracks[lane]
    if (!track) return { area: 'none' }
    for (let i = s.clips.length - 1; i >= 0; i--) {
      const c = s.clips[i]
      if (c.trackId !== track.id) continue
      const cx0 = c.start * s.zoom
      const cx1 = (c.start + c.length) * s.zoom
      if (x < cx0 || x > cx1) continue
      let edge = 'body'
      if (cx1 - cx0 > EDGE * 3) {
        if (x - cx0 < EDGE) edge = 'left'
        else if (cx1 - x < EDGE) edge = 'right'
      }
      return { area: 'clip', clip: c, edge, lane, track }
    }
    return { area: 'lane', lane, track }
  }

  const onPointerDown = (e) => {
    if (e.button !== 0) return
    const s = stateRef.current
    const { x, y, t } = locate(e)
    const h = hit(x, y)
    e.currentTarget.setPointerCapture(e.pointerId)

    if (h.area === 'ruler') {
      dragRef.current = { mode: 'ruler', x0: x, t0: t, moved: false }
      return
    }
    if (h.area === 'clip') {
      let base = s.clips
      let target = h.clip
      if (e.altKey && h.edge === 'body') {
        target = { ...h.clip, id: uid('c') }
        base = [...s.clips, target]
        dispatch({ type: 'setClips', clips: base })
      }
      dispatch({ type: 'set', patch: { selectedClipId: target.id, selectedTrackId: h.track.id } })
      dragRef.current = {
        mode: h.edge === 'body' ? 'move' : `trim-${h.edge}`,
        x0: x,
        y0: y,
        lane0: h.lane,
        orig: target,
        base,
        prev: s.clips,
        moved: base !== s.clips,
      }
      return
    }
    if (h.area === 'lane') {
      dispatch({ type: 'set', patch: { selectedClipId: null, selectedTrackId: h.track.id } })
      onSeek(snapTime(t, s, e.shiftKey))
    }
  }

  const onPointerMove = (e) => {
    const s = stateRef.current
    const { x, y } = locate(e)
    const d = dragRef.current
    if (!d) {
      const h = hit(x, y)
      canvasRef.current.style.cursor =
        h.area === 'clip' ? (h.edge === 'body' ? 'grab' : 'ew-resize') : h.area === 'ruler' ? 'text' : 'default'
      return
    }
    const free = e.shiftKey
    const dt = (x - d.x0) / s.zoom

    if (d.mode === 'ruler') {
      if (Math.abs(x - d.x0) < 4 && !d.moved) return
      d.moved = true
      const a = snapTime(Math.min(d.t0, d.t0 + dt), s, free)
      let b = snapTime(Math.max(d.t0, d.t0 + dt), s, free)
      if (b <= a) b = a + beatSec(s.bpm) * (s.snap || 1)
      dispatch({ type: 'set', patch: { loop: { enabled: true, start: a, end: b } } })
      return
    }

    const o = d.orig
    const buffer = engine.buffers.get(o.bufferId)
    const bufDur = buffer ? buffer.duration : o.offset + o.length * o.rate
    let patch
    if (d.mode === 'move') {
      const lane = Math.min(s.tracks.length - 1, Math.max(0, d.lane0 + Math.round((y - d.y0) / LANE_H)))
      patch = { start: snapTime(o.start + dt, s, free), trackId: s.tracks[lane].id }
      canvasRef.current.style.cursor = 'grabbing'
    } else if (d.mode === 'trim-left') {
      const end = o.start + o.length
      const minStart = Math.max(0, o.start - o.offset / o.rate)
      const ns = Math.min(end - MIN_LEN, Math.max(minStart, snapTime(o.start + dt, s, free)))
      patch = { start: ns, offset: o.offset + (ns - o.start) * o.rate, length: end - ns }
    } else {
      const maxEnd = o.start + (bufDur - o.offset) / o.rate
      const ne = Math.min(maxEnd, Math.max(o.start + MIN_LEN, snapTime(o.start + o.length + dt, s, free)))
      patch = { length: ne - o.start }
    }
    d.moved = true
    dispatch({ type: 'setClips', clips: d.base.map((c) => (c.id === o.id ? { ...o, ...patch } : c)) })
  }

  const onPointerUp = (e) => {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    const s = stateRef.current
    if (d.mode === 'ruler') {
      if (!d.moved) onSeek(snapTime(d.t0, s, e.shiftKey))
      return
    }
    if (d.moved) dispatch({ type: 'setClips', clips: s.clips, record: true, prev: d.prev })
  }

  const onDoubleClick = (e) => {
    const s = stateRef.current
    const { x, y, t } = locate(e)
    const h = hit(x, y)
    if (h.area === 'ruler') {
      dispatch({ type: 'set', patch: { loop: { ...s.loop, enabled: !s.loop.enabled } } })
      return
    }
    if (h.area !== 'clip') return
    const parts = splitClip(h.clip, snapTime(t, s, e.shiftKey))
    if (!parts) return
    dispatch({ type: 'setClips', record: true, clips: s.clips.flatMap((c) => (c.id === h.clip.id ? parts : [c])) })
    dispatch({ type: 'set', patch: { selectedClipId: parts[1].id } })
  }

  const onDrop = (e) => {
    e.preventDefault()
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('audio/') || /\.(wav|mp3|ogg|flac|m4a|aac|aiff?)$/i.test(f.name))
    if (!files.length) return
    const s = stateRef.current
    const { x, y, t } = locate(e)
    const h = hit(x, Math.max(y, RULER_H))
    onDropFiles(files, h.track?.id ?? s.selectedTrackId, snapTime(t, s))
  }

  return (
    <div
      ref={scrollRef}
      className="timeline-scroll relative overflow-x-auto overflow-y-hidden"
      onScroll={draw}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div className="relative" style={{ width: contentW, height }}>
        <canvas
          ref={canvasRef}
          className="sticky left-0 top-0 block"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={onDoubleClick}
        />
        <div
          ref={playheadRef}
          className="pointer-events-none absolute left-0 top-0 w-px bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]"
          style={{ height }}
        >
          <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-white" />
        </div>
      </div>
    </div>
  )
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
