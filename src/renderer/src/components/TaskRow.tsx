import { useEffect, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { formatMonthDay } from '../../../shared/date'
import type { Task } from '../../../shared/types'

interface Props {
  task: Task
  readOnly: boolean
  onToggle: (id: string) => void
  onDelete: (id: string) => void
  onEdit: (id: string, text: string) => void
}

export function TaskRow({ task, readOnly, onToggle, onDelete, onEdit }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.text)
  const inputRef = useRef<HTMLInputElement>(null)
  const done = Boolean(task.completedAt)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: readOnly || editing
  })

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  useEffect(() => {
    setDraft(task.text)
  }, [task.text])

  const commit = (): void => {
    setEditing(false)
    if (draft.trim() && draft.trim() !== task.text) onEdit(task.id, draft)
    else if (!draft.trim()) setDraft(task.text)
  }

  return (
    <li
      ref={setNodeRef}
      className="task"
      data-done={done ? 'true' : 'false'}
      data-dragging={isDragging ? 'true' : 'false'}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <button
        type="button"
        className="task__check"
        aria-label={done ? 'Mark as not done' : 'Mark as done'}
        aria-pressed={done}
        disabled={readOnly}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onToggle(task.id)}
      >
        <svg viewBox="0 0 24 24">
          <path d="M5.5 12.6l4.2 4.2L18.6 7.6" />
        </svg>
      </button>

      <div className="task__body">
        {editing ? (
          <input
            ref={inputRef}
            className="task__input"
            value={draft}
            maxLength={200}
            onChange={(event) => setDraft(event.target.value)}
            onPointerDown={(event) => event.stopPropagation()}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit()
              if (event.key === 'Escape') {
                setDraft(task.text)
                setEditing(false)
              }
            }}
          />
        ) : (
          <span
            className="task__text"
            onDoubleClick={() => {
              if (readOnly) return
              setEditing(true)
            }}
          >
            {task.text}
          </span>
        )}
        {task.carriedFrom && !editing ? (
          <span className="task__chip" title={`Carried over from ${formatMonthDay(task.carriedFrom)}`}>
            carried over
          </span>
        ) : null}
        {task.movedToToday && !editing ? <span className="task__chip task__chip--moved">moved to today</span> : null}
      </div>

      {readOnly ? null : (
        <button
          type="button"
          className="task__delete"
          aria-label="Delete task"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onDelete(task.id)}
        >
          <svg viewBox="0 0 24 24">
            <path d="M7 7l10 10M17 7L7 17" />
          </svg>
        </button>
      )}
    </li>
  )
}

export function TaskPreview({ task }: { task: Task }) {
  return (
    <li className="task task--overlay" data-done={task.completedAt ? 'true' : 'false'}>
      <span className="task__check task__check--ghost">
        <svg viewBox="0 0 24 24">
          <path d="M5.5 12.6l4.2 4.2L18.6 7.6" />
        </svg>
      </span>
      <div className="task__body">
        <span className="task__text">{task.text}</span>
      </div>
    </li>
  )
}
