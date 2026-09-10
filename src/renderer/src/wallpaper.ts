import type { BackdropInfo, Rect, ResizeAnchor } from '../../shared/types'

export interface ImageSize {
  width: number
  height: number
}

export interface WallpaperLayerStyle {
  backgroundImage: string
  backgroundPosition: string
  backgroundSize: string
  backgroundRepeat: string
  backgroundColor: string
}

/**
 * Aligns a copy of the desktop wallpaper so the panel glass refracts exactly what sits
 * behind the widget, matching the Windows wallpaper fit mode.
 */
export function wallpaperLayerStyle(
  backdrop: BackdropInfo,
  image: ImageSize | null,
  windowBounds: Rect,
  inset: number,
  panelOffset: { x: number; y: number } = { x: 0, y: 0 }
): WallpaperLayerStyle {
  const base: WallpaperLayerStyle = {
    backgroundImage: backdrop.url ? `url("${backdrop.url}")` : 'none',
    backgroundPosition: '0px 0px',
    backgroundSize: 'auto',
    backgroundRepeat: 'no-repeat',
    backgroundColor: backdrop.backgroundColor
  }
  if (!backdrop.url || !image || image.width === 0 || image.height === 0) return base

  const area = backdrop.fit === 'span' ? backdrop.spanBounds : backdrop.display.bounds
  const scaleFactor = backdrop.display.scaleFactor || 1
  let width = area.width
  let height = area.height
  let repeat = 'no-repeat'

  switch (backdrop.fit) {
    case 'stretch':
      break
    case 'fit': {
      const ratio = Math.min(area.width / image.width, area.height / image.height)
      width = image.width * ratio
      height = image.height * ratio
      break
    }
    case 'center':
      width = image.width / scaleFactor
      height = image.height / scaleFactor
      break
    case 'tile':
      width = image.width / scaleFactor
      height = image.height / scaleFactor
      repeat = 'repeat'
      break
    default: {
      const ratio = Math.max(area.width / image.width, area.height / image.height)
      width = image.width * ratio
      height = image.height * ratio
      break
    }
  }

  const originX = area.x + (area.width - width) / 2
  const originY = area.y + (area.height - height) / 2
  return {
    ...base,
    backgroundPosition: `${originX - (windowBounds.x + panelOffset.x + inset)}px ${
      originY - (windowBounds.y + panelOffset.y + inset)
    }px`,
    backgroundSize: repeat === 'repeat' ? `${width}px ${height}px` : `${width}px ${height}px`,
    backgroundRepeat: repeat
  }
}

/** Mirrors the main-process resize maths so the glass stays aligned while dragging an edge. */
export function previewResize(
  start: Rect,
  anchor: ResizeAnchor,
  dx: number,
  dy: number,
  min: { width: number; height: number },
  max: { width: number; height: number }
): Rect {
  let width = start.width
  let height = start.height

  if (anchor.includes('e')) width = start.width + dx
  if (anchor.includes('w')) width = start.width - dx
  if (anchor.includes('s')) height = start.height + dy
  if (anchor.includes('n')) height = start.height - dy

  width = Math.min(Math.max(Math.round(width), min.width), max.width)
  height = Math.min(Math.max(Math.round(height), min.height), max.height)

  return {
    x: anchor.includes('w') ? start.x + (start.width - width) : start.x,
    y: anchor.includes('n') ? start.y + (start.height - height) : start.y,
    width,
    height
  }
}
