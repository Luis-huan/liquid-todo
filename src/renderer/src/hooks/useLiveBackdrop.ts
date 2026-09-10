import { useEffect, useRef, useState } from 'react'
import type { Snapshot } from '../../../shared/types'
import { api } from '../api'

export type BackdropStatus = 'idle' | 'connecting' | 'live' | 'unavailable'

async function openStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 24 } as MediaTrackConstraints,
      audio: false
    })
  } catch {
    const sourceId = await api.getCaptureSource()
    if (!sourceId) throw new Error('no capture source')
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        // Electron's legacy desktop-capture constraints.
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxFrameRate: 24
        }
      } as unknown as MediaTrackConstraints
    })
  }
}

/**
 * Streams the desktop behind the widget so the glass shows the live background
 * (animated wallpapers included) instead of a static wallpaper file.
 */
export function useLiveBackdrop(snapshot: Snapshot | null) {
  const wanted = snapshot?.settings.backdrop === 'live'
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [status, setStatus] = useState<BackdropStatus>('idle')

  useEffect(() => {
    if (!wanted) {
      setStatus('idle')
      return
    }

    let stream: MediaStream | null = null
    let cancelled = false
    setStatus('connecting')

    openStream()
      .then((next) => {
        if (cancelled) {
          next.getTracks().forEach((track) => track.stop())
          return
        }
        stream = next
        next.getVideoTracks()[0]?.addEventListener('ended', () => setStatus('unavailable'))
        const element = videoRef.current
        if (element) {
          element.srcObject = next
          void element.play().catch(() => undefined)
        }
        setStatus('live')
      })
      .catch(() => {
        if (!cancelled) setStatus('unavailable')
      })

    return () => {
      cancelled = true
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [wanted])

  return { videoRef, status, active: wanted && status === 'live' }
}
