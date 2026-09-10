import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * Tracks where an element sits inside the window. Panels use it to sample their own slice of
 * the desktop wallpaper instead of copying the window's origin.
 */
export function useElementOffset<T extends HTMLElement>(): [RefObject<T>, { x: number; y: number }] {
  const ref = useRef<T>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  useLayoutEffect(() => {
    const measure = (): void => {
      const element = ref.current
      if (!element) return
      const rect = element.getBoundingClientRect()
      setOffset((previous) =>
        Math.abs(previous.x - rect.left) < 0.5 && Math.abs(previous.y - rect.top) < 0.5
          ? previous
          : { x: rect.left, y: rect.top }
      )
    }

    measure()
    const observer = new ResizeObserver(measure)
    if (ref.current) observer.observe(ref.current)
    window.addEventListener('resize', measure)
    const timer = window.setInterval(measure, 1000)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.clearInterval(timer)
    }
  }, [])

  return [ref, offset]
}
