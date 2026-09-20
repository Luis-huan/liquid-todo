import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  buildMonthGrid,
  canShowMonth,
  formatMonthTitle,
  monthOf,
  pickBlock,
  shiftMonth,
  WEEKDAY_INITIALS,
  type MonthRef
} from '../../shared/calendar'
import type { Snapshot } from '../../shared/types'
import { api } from './api'
import { GlassFilters, GlassSurface } from './components/GlassSurface'
import { useElementOffset } from './hooks/useElementOffset'
import { useWindowFrame } from './hooks/useWindowFrame'
import type { ImageSize } from './wallpaper'

const CALENDAR_SIZE = { width: 300, height: 370 }
const FALLBACK_DISPLAY = { width: 1920, height: 1080 }

const BLOCK_TITLE: Record<string, string> = {
  past: 'That day has already passed',
  tomorrow: 'Tomorrow is already on the list',
  taken: 'That day is already on the list'
}

export default function CalendarApp() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [image, setImage] = useState<ImageSize | null>(null)
  const [shown, setShown] = useState<MonthRef | null>(null)

  const { bounds, beginDrag } = useWindowFrame(snapshot, {
    min: CALENDAR_SIZE,
    fallback: FALLBACK_DISPLAY
  })
  const [panelRef, panelOffset] = useElementOffset<HTMLElement>()

  useEffect(() => {
    let alive = true
    void api.getSnapshot().then((next) => {
      if (alive) setSnapshot(next)
    })
    const unsubscribe = api.onSnapshot((next) => setSnapshot(next))
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

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
    void api.closeCalendar()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const todayKey = snapshot?.todayKey ?? ''
  const taken = useMemo(() => (snapshot?.future ?? []).map((row) => row.dateKey), [snapshot])
  const month = shown ?? (todayKey ? monthOf(todayKey) : null)

  const backdrop = useMemo(
    () =>
      snapshot?.backdrop ?? {
        url: '',
        version: '0',
        source: 'none' as const,
        fit: 'fill' as const,
        display: { id: -1, bounds: { x: 0, y: 0, ...FALLBACK_DISPLAY }, scaleFactor: 1 },
        spanBounds: { x: 0, y: 0, ...FALLBACK_DISPLAY },
        windowBounds: { x: 0, y: 0, ...CALENDAR_SIZE },
        backgroundColor: '#101014'
      },
    [snapshot]
  )

  const grid = useMemo(() => (month ? buildMonthGrid(month) : []), [month])
  const canGoBack = month ? canShowMonth(shiftMonth(month, -1), todayKey) : false
  const canGoForward = month ? canShowMonth(shiftMonth(month, 1), todayKey) : false

  const pick = (dateKey: string): void => {
    void api.pickFutureDate(dateKey)
  }

  return (
    <div className="widget widget--calendar" data-ready={snapshot ? 'true' : 'false'}>
      <GlassFilters />
      <section className="calendar" ref={panelRef}>
        <GlassSurface
          backdrop={backdrop}
          image={image}
          windowBounds={bounds ?? backdrop.windowBounds}
          compact
          panelOffset={panelOffset}
        />
        <header className="calendar__header" onPointerDown={beginDrag}>
          <div>
            <h2 className="calendar__title">Add a day</h2>
            <p className="calendar__subtitle">Pick a day for the Future list</p>
          </div>
          <button
            type="button"
            className="panel__icon"
            aria-label="Close calendar"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={close}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 7l10 10M17 7L7 17" />
            </svg>
          </button>
        </header>

        {month ? (
          <div className="calendar__body">
            <div className="calendar__month">
              <button
                type="button"
                className="calendar__nav"
                aria-label="Previous month"
                disabled={!canGoBack}
                onClick={() => setShown(shiftMonth(month, -1))}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M14 7l-5 5 5 5" />
                </svg>
              </button>
              <span className="calendar__month-label">{formatMonthTitle(month)}</span>
              <button
                type="button"
                className="calendar__nav"
                aria-label="Next month"
                disabled={!canGoForward}
                onClick={() => setShown(shiftMonth(month, 1))}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M10 7l5 5-5 5" />
                </svg>
              </button>
            </div>

            <div className="calendar__weekdays" aria-hidden="true">
              {WEEKDAY_INITIALS.map((initial, index) => (
                <span key={`${initial}-${index}`}>{initial}</span>
              ))}
            </div>

            <div className="calendar__grid">
              {grid.flat().map((cell) => {
                const block = pickBlock(cell.dateKey, todayKey, taken)
                const usable = block === null && canShowMonth(monthOf(cell.dateKey), todayKey)
                return (
                  <button
                    key={cell.dateKey}
                    type="button"
                    className="calendar__day"
                    data-in-month={cell.inMonth ? 'true' : 'false'}
                    data-block={block ?? 'none'}
                    data-today={cell.dateKey === todayKey ? 'true' : 'false'}
                    disabled={!usable}
                    title={block ? BLOCK_TITLE[block] : 'Add this day to Future'}
                    onClick={() => pick(cell.dateKey)}
                  >
                    {cell.day}
                  </button>
                )
              })}
            </div>

            <p className="calendar__hint">Today is not selectable, and tomorrow keeps its own row.</p>
          </div>
        ) : null}
      </section>
    </div>
  )
}
