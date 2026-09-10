import { useCallback, useEffect, useMemo, useState } from 'react'
import type { HistoryPayload, Snapshot, Task } from '../../shared/types'
import { api } from './api'
import { GlassFilters, GlassSurface } from './components/GlassSurface'

import { ResizeHandles } from './components/ResizeHandles'
import { useWindowFrame } from './hooks/useWindowFrame'
import { useElementOffset } from './hooks/useElementOffset'
import type { ImageSize } from './wallpaper'

const HISTORY_MIN = { width: 300, height: 320 }
const FALLBACK_DISPLAY = { width: 1920, height: 1080 }

function TaskLine({ task }: { task: Task }) {
  const done = Boolean(task.completedAt)
  return (
    <li className="history__task" data-done={done ? 'true' : 'false'}>
      <span className="history__mark">{done ? '✓' : '·'}</span>
      <span className="history__text">{task.text}</span>
      {task.movedToToday ? <span className="history__chip">moved to today</span> : null}
    </li>
  )
}

export default function HistoryApp() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [history, setHistory] = useState<HistoryPayload | null>(null)
  const [image, setImage] = useState<ImageSize | null>(null)

  const { bounds, beginDrag, beginResize } = useWindowFrame(snapshot, {
    min: HISTORY_MIN,
    fallback: FALLBACK_DISPLAY
  })
  const [panelRef, panelOffset] = useElementOffset<HTMLElement>()

  useEffect(() => {
    let alive = true
    void api.getSnapshot().then((next) => {
      if (alive) setSnapshot(next)
    })
    void api.getHistory().then((next) => {
      if (alive) setHistory(next)
    })
    const stopSnapshot = api.onSnapshot((next) => setSnapshot(next))
    const stopHistory = api.onHistory((next) => setHistory(next))
    return () => {
      alive = false
      stopSnapshot()
      stopHistory()
    }
  }, [])

  useEffect(() => {
    void api.getHistory().then(setHistory)
  }, [snapshot?.todayKey])

  const wallpaperUrl = snapshot?.backdrop.url ?? ''
  useEffect(() => {
    if (!wallpaperUrl) return
    const probe = new Image()
    probe.onload = () => setImage({ width: probe.naturalWidth, height: probe.naturalHeight })
    probe.onerror = () => setImage(null)
    probe.src = wallpaperUrl
  }, [wallpaperUrl])

  useEffect(() => {
    if (snapshot) document.documentElement.dataset.theme = snapshot.theme
  }, [snapshot])

  const close = useCallback(() => {
    void api.closeHistory()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const backdrop = useMemo(
    () =>
      snapshot?.backdrop ?? {
        url: '',
        version: '0',
        source: 'none' as const,
        fit: 'fill' as const,
        display: { id: -1, bounds: { x: 0, y: 0, ...FALLBACK_DISPLAY }, scaleFactor: 1 },
        spanBounds: { x: 0, y: 0, ...FALLBACK_DISPLAY },
        windowBounds: { x: 0, y: 0, width: 340, height: 560 },
        backgroundColor: '#101014'
      },
    [snapshot]
  )

  const windowBounds = bounds ?? backdrop.windowBounds

  return (
    <div className="widget widget--history" data-ready={snapshot ? 'true' : 'false'}>
      <GlassFilters />
            <section className="history" ref={panelRef}>
        <GlassSurface
          backdrop={backdrop}
          image={image}
          windowBounds={windowBounds}
          compact
          panelOffset={panelOffset}
        />
        <header className="history__header" onPointerDown={beginDrag}>
          <div>
            <h2 className="history__title">history</h2>
            <p className="history__subtitle">last 6 days</p>
          </div>
          <button type="button" className="panel__icon" aria-label="Close history" onPointerDown={(e) => e.stopPropagation()} onClick={close}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 7l10 10M17 7L7 17" />
            </svg>
          </button>
        </header>
        <div className="history__scroll">
          {(history?.days ?? []).map((day) => (
            <section className="history__day" key={day.dateKey}>
              <div className="history__day-head">
                <h3 className="history__day-label">{day.label}</h3>
                <span className="history__day-count">
                  {day.done} <span className="panel__count-divider">/</span> {day.total}
                </span>
              </div>
              {day.tasks.length === 0 ? (
                <p className="history__empty">Nothing recorded.</p>
              ) : (
                <ul className="history__tasks">
                  {day.tasks.map((task) => (
                    <TaskLine key={task.id} task={task} />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </section>
      <ResizeHandles onStart={beginResize} />
    </div>
  )
}
