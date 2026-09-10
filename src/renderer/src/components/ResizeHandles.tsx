import type { PointerEvent as ReactPointerEvent } from 'react'
import type { ResizeAnchor } from '../../../shared/types'

const ANCHORS: ResizeAnchor[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

interface Props {
  onStart: (anchor: ResizeAnchor, event: ReactPointerEvent<HTMLDivElement>) => void
}

export function ResizeHandles({ onStart }: Props) {
  return (
    <>
      {ANCHORS.map((anchor) => (
        <div
          key={anchor}
          className={`resize resize--${anchor}`}
          onPointerDown={(event) => onStart(anchor, event)}
        />
      ))}
    </>
  )
}
