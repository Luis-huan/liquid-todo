import { useCallback, useEffect, useMemo, useState } from 'react'
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
import type { ColumnView, FutureRow, Snapshot, Task } from '../../shared/types'
import { api } from './api'
import { ColumnPanel } from './components/ColumnPanel'
import { GlassFilters } from './components/GlassSurface'
import { FuturePanel } from './components/FuturePanel'
import { ResizeHandles } from './components/ResizeHandles'
import { TaskPreview } from './components/TaskRow'
import { useWindowFrame } from './hooks/useWindowFrame'
import type { ImageSize } from './wallpaper'

const MAIN_MIN = { width: 820, height: 420 }
const FALLBACK_DISPLAY = { width: 1920, height: 1080 }

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [columns, setColumns] = useState<ColumnView[]>([])
  const [future, setFuture] = useState<FutureRow[]>([])
  const [image, setImage] = useState<ImageSize | null>(null)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [activeWidth, setActiveWidth] = useState<number | null>(null)
  const [noticeVisible, setNoticeVisible] = useState<number | null>(null)

  const { bounds, beginDrag, beginResize, interacting } = useWindowFrame(snapshot, {
    min: MAIN_MIN,
    fallback: FALLBACK_DISPLAY
  })

  const applySnapshot = useCallback(
    (next: Snapshot) => {
      setSnapshot(next)
      if (interacting.current) return
      setColumns(next.columns)
      setFuture(next.future)
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
  const openCalendar = useCallback(() => {
    void api.openCalendar()
  }, [])
  const removeFutureDate = useCallback((dateKey: string) => {
    void api.removeFutureDate(dateKey)
  }, [])

  // ------------------------------------------------------------- drag and drop

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  /** Every drop target on the board, the two fixed columns and each day of the Future list. */
  interface Container {
    dateKey: string
    tasks: Task[]
    readOnly: boolean
  }

  const containers = useMemo<Container[]>(
    () => [
      ...columns.map((column) => ({
        dateKey: column.dateKey,
        tasks: column.tasks,
        readOnly: column.readOnly
      })),
      ...future.map((row) => ({ dateKey: row.dateKey, tasks: row.tasks, readOnly: false }))
    ],
    [columns, future]
  )

  const findContainer = useCallback(
    (id: string): Container | undefined =>
      containers.find(
        (container) => container.dateKey === id || container.tasks.some((task) => task.id === id)
      ),
    [containers]
  )

  /** Applies one move to the local board so the drop lands before the server answers. */
  const moveLocally = useCallback(
    (fromKey: string, toKey: string, taskId: string, overId: string | null) => {
      const moved = containers
        .find((container) => container.dateKey === fromKey)
        ?.tasks.find((task) => task.id === taskId)
      if (!moved) return

      const update = (tasks: Task[], dateKey: string): Task[] => {
        if (dateKey === fromKey) return tasks.filter((task) => task.id !== taskId)
        if (dateKey !== toKey) return tasks
        const overIndex = overId ? tasks.findIndex((task) => task.id === overId) : -1
        const insertAt = overIndex === -1 ? tasks.length : overIndex
        const next = tasks.slice()
        next.splice(insertAt, 0, moved)
        return next
      }

      setColumns((previous) =>
        previous.map((column) => ({ ...column, tasks: update(column.tasks, column.dateKey) }))
      )
      setFuture((previous) => previous.map((row) => ({ ...row, tasks: update(row.tasks, row.dateKey) })))
    },
    [containers]
  )

  /**
   * Counts the rows sitting above the dragged card, which is the slot the user sees. The dragged
   * row itself is skipped, so the result matches "remove it, then insert it here".
   */
  const dropIndex = useCallback(
    (dateKey: string, draggedId: string, translated: { top: number; height: number } | null): number => {
      const container = document.querySelector(`[data-date="${dateKey}"]`)
      if (!container) return -1
      const rows = Array.from(container.querySelectorAll<HTMLElement>('.task')).filter(
        (row) => row.dataset.taskId !== draggedId
      )
      if (!translated) return rows.length
      const center = translated.top + translated.height / 2
      let index = 0
      for (const row of rows) {
        const rect = row.getBoundingClientRect()
        if (rect.top + rect.height / 2 < center) index += 1
      }
      return index
    },
    []
  )

  const onDragStart = (event: DragStartEvent): void => {
    const container = findContainer(String(event.active.id))
    setActiveTask(container?.tasks.find((task) => task.id === event.active.id) ?? null)
    // The floating card copies the width of the row it came from, so it can never grow past the
    // glass edge of a narrow column.
    setActiveWidth(Math.round(event.active.rect.current.initial?.width ?? 0) || null)
  }

  const onDragOver = (event: DragOverEvent): void => {
    const { active, over } = event
    if (!over) return
    const from = findContainer(String(active.id))
    const to = findContainer(String(over.id))
    if (!from || !to || from.dateKey === to.dateKey || to.readOnly) return
    moveLocally(from.dateKey, to.dateKey, String(active.id), String(over.id))
  }

  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    setActiveTask(null)
    setActiveWidth(null)
    const activeId = String(active.id)
    const from = findContainer(activeId)
    const to = over ? findContainer(String(over.id)) ?? from : from

    if (!from || !to || !over) {
      if (snapshot) {
        setColumns(snapshot.columns)
        setFuture(snapshot.future)
      }
      return
    }

    // Where the row actually ended up on screen decides the new position. Asking dnd-kit which
    // droppable was under the pointer used to resolve to the whole column whenever the list was
    // mostly empty, which made the drop a no-op.
    const translated = active.rect.current.translated
    const measured = dropIndex(to.dateKey, activeId, translated)
    const fallback = to.tasks.filter((task) => task.id !== activeId).length
    void api.moveTask(activeId, to.dateKey, measured < 0 ? fallback : measured)
  }

  const onDragCancel = (): void => {
    setActiveTask(null)
    setActiveWidth(null)
    if (snapshot) {
      setColumns(snapshot.columns)
      setFuture(snapshot.future)
    }
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
          <FuturePanel
            rows={future}
            backdrop={backdrop}
            image={image}
            windowBounds={bounds ?? backdrop.windowBounds}
            onHeaderPointerDown={beginDrag}
            onOpenCalendar={openCalendar}
            onAdd={addTask}
            onDelete={deleteTask}
            onEdit={editTask}
            onRemoveDate={removeFutureDate}
          />
        </div>
        <DragOverlay dropAnimation={null}>
          {activeTask ? <TaskPreview task={activeTask} width={activeWidth ?? undefined} /> : null}
        </DragOverlay>
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
