import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { BackdropInfo, ColumnView, Rect, Task } from '../../../shared/types'
import type { ImageSize } from '../wallpaper'
import { GlassSurface } from './GlassSurface'
import { TaskRow } from './TaskRow'
import { useElementOffset } from '../hooks/useElementOffset'

interface Props {
  column: ColumnView
  backdrop: BackdropInfo
  image: ImageSize | null
  windowBounds: Rect
  accent: boolean
  onHeaderPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onToggle: (id: string) => void
  onDelete: (id: string) => void
  onEdit: (id: string, text: string) => void
  onAdd: (dateKey: string, text: string) => void
  onOpenHistory: () => void
}

const EMPTY_TEXT: Record<string, string> = {
  yesterday: 'Nothing was on this list.',
  today: 'Nothing here yet — add your first task.',
  nextDay: 'Plan tomorrow…'
}

export function ColumnPanel({
  column,
  backdrop,
  image,
  windowBounds,
  accent,
  onHeaderPointerDown,
  onToggle,
  onDelete,
  onEdit,
  onAdd,
  onOpenHistory
}: Props) {
  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const { setNodeRef, isOver } = useDroppable({ id: column.dateKey, disabled: column.readOnly })
  const [panelRef, panelOffset] = useElementOffset<HTMLElement>()

  const submit = (): void => {
    const text = draft.trim()
    setComposing(false)
    setDraft('')
    if (text) onAdd(column.dateKey, text)
  }

  const tasks: Task[] = column.tasks

  return (
    <section className="panel" ref={panelRef} data-accent={accent ? 'true' : 'false'}>
      <GlassSurface
        backdrop={backdrop}
        image={image}
        windowBounds={windowBounds}
        accent={accent}
        panelOffset={panelOffset}
      />

      <header className="panel__header" onPointerDown={onHeaderPointerDown}>
        <div className="panel__titles">
          <h2 className="panel__label">{column.label}</h2>
          <p className="panel__date">{column.dateLabel}</p>
        </div>
        <div className="panel__meta">
          <span className="panel__count">
            {column.done} <span className="panel__count-divider">/</span> {column.total}
          </span>
          {column.id === 'yesterday' ? (
            <button
              type="button"
              className="panel__icon"
              title="Open history"
              aria-label="Open history"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onOpenHistory}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 12h.01M12 12h.01M18 12h.01" />
              </svg>
            </button>
          ) : null}
          {column.readOnly ? null : (
            <button
              type="button"
              className="panel__icon panel__icon--add"
              title="Add a task"
              aria-label="Add a task"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setComposing(true)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5.5v13M5.5 12h13" />
              </svg>
            </button>
          )}
        </div>
      </header>

      <ul className="panel__list" ref={setNodeRef} data-over={isOver ? 'true' : 'false'}>
        <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              readOnly={column.readOnly}
              onToggle={onToggle}
              onDelete={onDelete}
              onEdit={onEdit}
            />
          ))}
        </SortableContext>
        {tasks.length === 0 ? <li className="panel__empty">{EMPTY_TEXT[column.id]}</li> : null}
      </ul>

      {composing ? (
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <span className="composer__dot" />
          <input
            autoFocus
            className="composer__input"
            value={draft}
            maxLength={200}
            placeholder="New task"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={submit}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setDraft('')
                setComposing(false)
              }
            }}
          />
        </form>
      ) : null}
    </section>
  )
}
