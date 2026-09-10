import type { BackdropInfo, Rect } from '../../../shared/types'
import { wallpaperLayerStyle, type ImageSize } from '../wallpaper'

interface Props {
  backdrop: BackdropInfo
  image: ImageSize | null
  windowBounds: Rect
  accent?: boolean
  compact?: boolean
  panelOffset?: { x: number; y: number }
}

export function GlassSurface({
  backdrop,
  image,
  windowBounds,
  accent = false,
  compact = false,
  panelOffset = { x: 0, y: 0 }
}: Props) {
  const blur = wallpaperLayerStyle(backdrop, image, windowBounds, compact ? -48 : -72, panelOffset)
  const refract = wallpaperLayerStyle(backdrop, image, windowBounds, 0, panelOffset)

  return (
    <div className="glass" aria-hidden="true">
      <div className="glass__wallpaper glass__wallpaper--blur" style={blur} />
      <div className="glass__wallpaper glass__wallpaper--refract" style={refract} />
      <div className="glass__fill" />
      <div className="glass__spec" />
      <div className="glass__rim" />
      <div className="glass__grain" />
      {accent ? <div className="glass__accent" /> : null}
    </div>
  )
}

export function GlassFilters() {
  return (
    <svg className="glass-filters" aria-hidden="true" focusable="false">
      <filter id="liquid-refraction" x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.006 0.011" numOctaves="2" seed="9" result="noise" />
        <feGaussianBlur in="noise" stdDeviation="9" result="soft" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="soft"
          scale="34"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
      <filter id="liquid-refraction-soft" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.004 0.008" numOctaves="2" seed="4" result="noise" />
        <feGaussianBlur in="noise" stdDeviation="7" result="soft" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="soft"
          scale="22"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  )
}
