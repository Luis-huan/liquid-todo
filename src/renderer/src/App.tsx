import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import type { ColumnView, Snapshot, Task } from '../../shared/types'
import { api } from './api'
import { ColumnPanel } from './components/ColumnPanel'
import { GlassFilters } from './components/GlassSurface'

import { ResizeHandles } from './components/ResizeHandles'
import { TaskPreview } from './components/TaskRow'
import { useWindowFrame } from './hooks/useWindowFrame'
import type { ImageSize } from './wallpaper'

const MAIN_MIN = { width: 820, height: 420 }
const FALLBACK_DISPLAY = { width: 1920, height: 1080 }

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [columns, setColumns] = useState<ColumnView[]>([])
  const [image, setImage] = useState<ImageSize | null>(null)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [noticeVisible, setNoticeVisible] = useState<number | null>(null)
  const crossMoved = useRef(false)

  const { bounds, beginDrag, beginResize, interacting } = useWindowFrame(snapshot, {
    min: MAIN_MIN,
    fallback: FALLBACK_DISPLAY
  })

  const applySnapshot = useCallback(
    (next: Snapshot) => {
      setSnapshot(next)
      if (!interacting.current) setColumns(next.columns)
    },
    [interacting]
  )

  useEffect(() => {
    let alive = true
    void api.getSnapshot().then((next) => {
      if (alive) applySnapshot(next)
    })
    const unsubscribe = api.onSnapshot(applySnapshot)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [applySnapshot])

  const wallpaperUrl = snapshot?.backdrop.url ?? ''
  useEffect(() => {
    if (!wallpaperUrl) {
      setImage(null)
      return
    }
    const probe = new Image()
    probe.onload = () => setImage({ width: probe.naturalWidth, height: probe.naturalHeight })
    probe.onerror = () => setImage(null)
    probe.src = wallpaperUrl
  }, [wallpaperUrl])

  useEffect(() => {
    if (snapshot) document.documentElement.dataset.theme = snapshot.theme
  }, [snapshot])

  const notice = snapshot?.notice ?? null
  useEffect(() => {
    if (!notice) {
      setNoticeVisible(null)
      return
    }
    setNoticeVisible(notice.id)
    const timer = setTimeout(() => setNoticeVisible(null), 8000)
    return () => clearTimeout(timer)
  }, [notice])

  // ------------------------------------------------------------- task mutations

  const addTask = useCallback((dateKey: string, text: string) => {
    void api.addTask(dateKey, text)
  }, [])
  const toggleTask = useCallback((id: string) => {
    void api.toggleTask(id)
  }, [])
  const deleteTask = useCallback((id: string) => {
    void api.deleteTask(id)
  }, [])
  const editTask = useCallback((id: string, text: string) => {
    void api.setTaskText(id, text)
  }, [])
  const openHistory = useCallback(() => {
    void api.openHistory()
  }, [])

  // ------------------------------------------------------------- drag and drop

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const findColumn = useCallback(
    (id: string): ColumnView | undefined =>
      columns.find((column) => column.dateKey === id || column.tasks.some((task) => task.id === id)),
    [columns]
  )

  const onDragStart = (event: DragStartEvent): void => {
    const column = findColumn(String(event.active.id))
    setActiveTask(column?.tasks.find((task) => task.id === event.active.id) ?? null)
    crossMoved.current = false
  }

  const onDragOver = (event: DragOverEvent): void => {
    const { active, over } = event
    if (!over) return
    const from = findColumn(String(active.id))
    const to = findColumn(String(over.id))
    if (!from || !to || from.dateKey === to.dateKey || to.readOnly) return

    crossMoved.current = true
    setColumns((previous) =>
      previous.map((column) => {
        if (column.dateKey === from.dateKey) {
          return { ...column, tasks: column.tasks.filter((task) => task.id !== active.id) }
        }
        if (column.dateKey === to.dateKey) {
          const moved = from.tasks.find((task) => task.id === active.id)
          if (!moved) return column
          const overIndex = column.tasks.findIndex((task) => task.id === String(over.id))
          const insertAt = overIndex === -1 ? column.tasks.length : overIndex
          const next = column.tasks.slice()
          next.splice(insertAt, 0, moved)
          return { ...column, tasks: next }
        }
        return column
      })
    )
  }

  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    setActiveTask(null)
    const column = findColumn(String(active.id))

    if (!column || !over) {
      if (snapshot) setColumns(snapshot.columns)
      crossMoved.current = false
      return
    }

    const overId = String(over.id)
    const sameColumnPath = !crossMoved.current && overId !== column.dateKey
    const index = sameColumnPath
      ? column.tasks.findIndex((task) => task.id === overId)
      : column.tasks.findIndex((task) => task.id === active.id)

    void api.moveTask(String(active.id), column.dateKey, index < 0 ? column.tasks.length : index)
    crossMoved.current = false
  }

  const onDragCancel = (): void => {
    setActiveTask(null)
    crossMoved.current = false
    if (snapshot) setColumns(snapshot.columns)
  }

  const backdrop = useMemo(
    () =>
      snapshot?.backdrop ?? {
        url: '',
        version: '0',
        source: 'none' as const,
        fit: 'fill' as const,
        display: { id: -1, bounds: { x: 0, y: 0, ...FALLBACK_DISPLAY }, scaleFactor: 1 },
        spanBounds: { x: 0, y: 0, ...FALLBACK_DISPLAY },
        windowBounds: { x: 0, y: 0, width: 960, height: 480 },
        backgroundColor: '#101014'
      },
    [snapshot]
  )

  return (
    <div className="widget" data-ready={snapshot ? 'true' : 'false'}>
      <GlassFilters />
            <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="columns">
          {columns.map((column) => (
            <ColumnPanel
              key={column.dateKey}
              column={column}
              backdrop={backdrop}
              image={image}
              windowBounds={bounds ?? backdrop.windowBounds}
              accent={column.id === 'today'}
              onHeaderPointerDown={beginDrag}
              onToggle={toggleTask}
              onDelete={deleteTask}
              onEdit={editTask}
              onAdd={addTask}
              onOpenHistory={openHistory}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>{activeTask ? <TaskPreview task={activeTask} /> : null}</DragOverlay>
      </DndContext>
      <ResizeHandles onStart={beginResize} />
      {notice && noticeVisible === notice.id ? (
        <div className="notice" data-kind={notice.kind} onPointerDown={() => setNoticeVisible(null)}>
          {notice.text}
        </div>
      ) : null}
    </div>
  )
}
