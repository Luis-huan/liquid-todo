import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Rect, ResizeAnchor, Snapshot } from '../../../shared/types'
import { api } from '../api'
import { previewResize } from '../wallpaper'

interface Options {
  min: { width: number; height: number }
  fallback: { width: number; height: number }
}

export function useWindowFrame(snapshot: Snapshot | null, { min, fallback }: Options) {
  const [bounds, setBounds] = useState<Rect | null>(null)
  const interacting = useRef(false)

  useEffect(() => {
    if (!snapshot || interacting.current) return
    setBounds(snapshot.backdrop.windowBounds)
  }, [snapshot])

  const beginDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      const start = bounds ?? snapshot?.backdrop.windowBounds
      if (!start) return
      event.preventDefault()
      const startX = event.screenX
      const startY = event.screenY
      interacting.current = true
      void api.windowDragStart()

      const onMove = (moveEvent: PointerEvent): void => {
        const dx = moveEvent.screenX - startX
        const dy = moveEvent.screenY - startY
        setBounds({ ...start, x: start.x + dx, y: start.y + dy })
        void api.windowDragMove(dx, dy)
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        void api.windowDragEnd()
        window.setTimeout(() => {
          interacting.current = false
        }, 120)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [bounds, snapshot]
  )

  const beginResize = useCallback(
    (anchor: ResizeAnchor, event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      const start = bounds ?? snapshot?.backdrop.windowBounds
      if (!start) return
      event.stopPropagation()
      const startX = event.screenX
      const startY = event.screenY
      const max = snapshot?.backdrop.display.bounds ?? fallback
      interacting.current = true
      void api.windowResizeStart(anchor)

      const onMove = (moveEvent: PointerEvent): void => {
        const dx = moveEvent.screenX - startX
        const dy = moveEvent.screenY - startY
        setBounds(previewResize(start, anchor, dx, dy, min, { width: max.width, height: max.height }))
        void api.windowResizeMove(dx, dy)
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        void api.windowResizeEnd()
        window.setTimeout(() => {
          interacting.current = false
        }, 120)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [bounds, snapshot, min, fallback]
  )

  return { bounds, beginDrag, beginResize, interacting }
}
