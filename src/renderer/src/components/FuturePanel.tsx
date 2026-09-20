import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { BackdropInfo, FutureRow, Rect } from '../../../shared/types'
import type { ImageSize } from '../wallpaper'
import { GlassSurface } from './GlassSurface'
import { TaskRow } from './TaskRow'
import { useElementOffset } from '../hooks/useElementOffset'

interface Props {
  rows: FutureRow[]
  backdrop: BackdropInfo
  image: ImageSize | null
  windowBounds: Rect
  onHeaderPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onOpenCalendar: () => void
  onAdd: (dateKey: string, text: string) => void
  onDelete: (id: string) => void
  onEdit: (id: string, text: string) => void
  onRemoveDate: (dateKey: string) => void
}

interface RowProps {
  row: FutureRow
  onAdd: (dateKey: string, text: string) => void
  onDelete: (id: string) => void
  onEdit: (id: string, text: string) => void
  onRemoveDate: (dateKey: string) => void
}

function FutureDayRow({ row, onAdd, onDelete, onEdit, onRemoveDate }: RowProps) {
  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const [confirming, setConfirming] = useState(false)
  const { setNodeRef, isOver } = useDroppable({ id: row.dateKey })

  const submit = (): void => {
    const text = draft.trim()
    setComposing(false)
    setDraft('')
    if (text) onAdd(row.dateKey, text)
  }

  const requestRemove = (): void => {
    if (row.total === 0) {
      onRemoveDate(row.dateKey)
      return
    }
    setConfirming(true)
  }

  return (
    <section
      className="future-day"
      data-date={row.dateKey}
      data-tomorrow={row.isTomorrow ? 'true' : 'false'}
      data-over={isOver ? 'true' : 'false'}
      ref={setNodeRef}
    >
      <header className="future-day__head">
        <h3 className="future-day__label">{row.isTomorrow ? 'Tomorrow' : row.label}</h3>
        {row.isTomorrow ? <span className="future-day__date">{row.label}</span> : null}
        <div className="future-day__actions">
          {row.isTomorrow ? null : (
            <button
              type="button"
              className="future-day__icon future-day__icon--remove"
              title="Remove this day"
              aria-label="Remove this day"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={requestRemove}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 7l10 10M17 7L7 17" />
              </svg>
            </button>
          )}
          <button
            type="button"
            className="future-day__icon"
            title="Add a task"
            aria-label={`Add a task on ${row.label}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setComposing(true)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5.5v13M5.5 12h13" />
            </svg>
          </button>
        </div>
      </header>

      {confirming ? (
        <div className="future-day__confirm">
          <span className="future-day__confirm-text">
            {`Delete this day and its ${row.total} task${row.total === 1 ? '' : 's'}?`}
          </span>
          <div className="future-day__confirm-actions">
            <button
              type="button"
              className="future-day__confirm-button"
              data-kind="danger"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                setConfirming(false)
                onRemoveDate(row.dateKey)
              }}
            >
              Delete
            </button>
            <button
              type="button"
              className="future-day__confirm-button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <ul className="future-day__list">
        <SortableContext items={row.tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
          {row.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              readOnly={false}
              showCheck={false}
              onToggle={() => undefined}
              onDelete={onDelete}
              onEdit={onEdit}
            />
          ))}
        </SortableContext>
      </ul>

      {composing ? (
        <form
          className="composer composer--future"
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

export function FuturePanel({
  rows,
  backdrop,
  image,
  windowBounds,
  onHeaderPointerDown,
  onOpenCalendar,
  onAdd,
  onDelete,
  onEdit,
  onRemoveDate
}: Props) {
  const [panelRef, panelOffset] = useElementOffset<HTMLElement>()

  return (
    <section className="panel panel--future" ref={panelRef}>
      <GlassSurface
        backdrop={backdrop}
        image={image}
        windowBounds={windowBounds}
        panelOffset={panelOffset}
      />

      <header className="panel__header" onPointerDown={onHeaderPointerDown}>
        <div className="panel__titles">
          <h2 className="panel__label">Future</h2>
        </div>
        <div className="panel__meta">
          <button
            type="button"
            className="panel__icon"
            title="Add a day"
            aria-label="Add a day"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onOpenCalendar}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 12h.01M12 12h.01M18 12h.01" />
            </svg>
          </button>
        </div>
      </header>

      <div className="panel__list panel__list--future">
        {rows.map((row) => (
          <FutureDayRow
            key={row.dateKey}
            row={row}
            onAdd={onAdd}
            onDelete={onDelete}
            onEdit={onEdit}
            onRemoveDate={onRemoveDate}
          />
        ))}
      </div>
    </section>
  )
}
