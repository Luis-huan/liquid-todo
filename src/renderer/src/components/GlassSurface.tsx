import type { MutableRefObject } from 'react'
import type { BackdropInfo, Rect } from '../../../shared/types'
import { wallpaperLayerStyle, type ImageSize } from '../wallpaper'

interface Props {
  backdrop: BackdropInfo
  image: ImageSize | null
  windowBounds: Rect
  accent?: boolean
  compact?: boolean
  live?: boolean
  panelOffset?: { x: number; y: number }
}

export function GlassSurface({
  backdrop,
  image,
  windowBounds,
  accent = false,
  compact = false,
  live = false,
  panelOffset = { x: 0, y: 0 }
}: Props) {
  const blur = wallpaperLayerStyle(backdrop, image, windowBounds, compact ? -48 : -72, panelOffset)
  const refract = wallpaperLayerStyle(backdrop, image, windowBounds, 0, panelOffset)

  return (
    <div className="glass" data-live={live ? 'true' : 'false'} aria-hidden="true">
      {live ? (
        <>
          <div className="glass__blur" />
          <div className="glass__lens" />
        </>
      ) : (
        <>
          <div className="glass__wallpaper glass__wallpaper--blur" style={blur} />
          <div className="glass__wallpaper glass__wallpaper--refract" style={refract} />
        </>
      )}
      <div className="glass__fill" />
      <div className="glass__spec" />
      <div className="glass__rim" />
      <div className="glass__grain" />
      {accent ? <div className="glass__accent" /> : null}
    </div>
  )
}

interface LiveVideoProps {
  videoRef: MutableRefObject<HTMLVideoElement | null>
  windowBounds: Rect
  backdrop: BackdropInfo
}

/** Screen-aligned live capture of the desktop sitting behind the glass panels. */
export function LiveBackdropVideo({ videoRef, windowBounds, backdrop }: LiveVideoProps) {
  const { bounds } = backdrop.display
  return (
    <video
      ref={videoRef}
      className="live-backdrop"
      style={{
        left: `${bounds.x - windowBounds.x}px`,
        top: `${bounds.y - windowBounds.y}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`
      }}
      muted
      autoPlay
      playsInline
      disablePictureInPicture
    />
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
