import { execFile } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app, desktopCapturer, protocol, screen, type BrowserWindow } from 'electron'
import type { BackdropInfo, Rect, WallpaperFit } from '../shared/types'
import { userDataPath } from './paths'

const execFileAsync = promisify(execFile)

export const WALLPAPER_SCHEME = 'liquid-wallpaper'

type WallpaperSource = 'transcoded' | 'registry' | 'capture' | 'none'

interface WallpaperFile {
  path: string
  source: WallpaperSource
  mtimeMs: number
}

interface DesktopRegistry {
  wallPaper: string
  style: string
  tile: string
  background: string
}

let currentFile: WallpaperFile | null = null
let registry: DesktopRegistry | null = null
let fit: WallpaperFit = 'fill'
let backgroundColor = '#101014'

export function registerWallpaperScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: WALLPAPER_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true, stream: true }
    }
  ])
}

function sniffMime(buffer: Buffer): string {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg'
  if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png'
  if (buffer.length > 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp'
  if (buffer.length > 3 && buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif'
  if (buffer.length > 12 && buffer[8] === 0x57 && buffer[9] === 0x45) return 'image/webp'
  return 'application/octet-stream'
}

export function registerWallpaperProtocol(): void {
  protocol.handle(WALLPAPER_SCHEME, async () => {
    const file = currentFile
    if (!file) return new Response('', { status: 404 })
    try {
      const buffer = readFileSync(file.path)
      return new Response(buffer, {
        headers: { 'content-type': sniffMime(buffer), 'cache-control': 'no-cache' }
      })
    } catch {
      return new Response('', { status: 404 })
    }
  })
}

async function readDesktopRegistry(force = false): Promise<DesktopRegistry> {
  if (registry && !force) return registry
  const command = [
    "$d = Get-ItemProperty 'HKCU:\\Control Panel\\Desktop';",
    "$c = Get-ItemProperty 'HKCU:\\Control Panel\\Colors';",
    '@{ wallPaper = [string]$d.WallPaper; style = [string]$d.WallpaperStyle;',
    'tile = [string]$d.TileWallpaper; background = [string]$c.Background }',
    '| ConvertTo-Json -Compress'
  ].join(' ')
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: 10_000 }
    )
    const parsed = JSON.parse(stdout.trim()) as Partial<DesktopRegistry>
    registry = {
      wallPaper: parsed.wallPaper ?? '',
      style: parsed.style ?? '',
      tile: parsed.tile ?? '',
      background: parsed.background ?? ''
    }
  } catch {
    registry = { wallPaper: '', style: '', tile: '', background: '' }
  }
  return registry
}

function resolveFit(reg: DesktopRegistry): WallpaperFit {
  if (reg.tile === '1') return 'tile'
  switch (reg.style) {
    case '10':
      return 'fill'
    case '6':
      return 'fit'
    case '2':
      return 'stretch'
    case '0':
      return 'center'
    case '22':
      return 'span'
    default:
      return 'fill'
  }
}

function parseBackgroundColor(value: string): string | null {
  const parts = value.trim().split(/\s+/).map(Number)
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null
  const hex = parts
    .slice(0, 3)
    .map((part) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, '0'))
    .join('')
  return `#${hex}`
}

function statFile(path: string): WallpaperFile | null {
  try {
    const info = statSync(path)
    if (!info.isFile() || info.size === 0) return null
    return { path, source: 'none', mtimeMs: info.mtimeMs }
  } catch {
    return null
  }
}

interface WallpaperPresence {
  path: string
  exists: boolean
  mtimeMs: number
}

function lookForWallpaper(reg: DesktopRegistry): WallpaperPresence[] {
  const candidates: string[] = []
  const transcoded = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper')
  candidates.push(transcoded)
  if (reg.wallPaper) candidates.push(reg.wallPaper)

  return candidates.map((path) => {
    const info = statFile(path)
    return { path, exists: Boolean(info), mtimeMs: info?.mtimeMs ?? 0 }
  })
}

async function captureDesktop(): Promise<string | null> {
  try {
    const primary = screen.getPrimaryDisplay()
    const width = Math.round(primary.bounds.width * primary.scaleFactor)
    const height = Math.round(primary.bounds.height * primary.scaleFactor)
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height }
    })
    const source = sources.find((entry) => entry.display_id === String(primary.id)) ?? sources[0]
    if (!source || source.thumbnail.isEmpty()) return null
    const target = userDataPath('backdrop-capture.png')
    writeFileSync(target, source.thumbnail.toPNG())
    return target
  } catch {
    return null
  }
}

/** Detects the wallpaper currently in use; returns true when the picture changed. */
export async function refreshWallpaper(force = false): Promise<boolean> {
  const reg = await readDesktopRegistry(force)
  const [transcoded, fromRegistry] = lookForWallpaper(reg)

  let next: WallpaperFile | null = null
  if (transcoded.exists) {
    next = { path: transcoded.path, source: 'transcoded', mtimeMs: transcoded.mtimeMs }
  } else if (fromRegistry.exists) {
    next = { path: fromRegistry.path, source: 'registry', mtimeMs: fromRegistry.mtimeMs }
  } else {
    const captured = await captureDesktop()
    if (captured) {
      const info = statFile(captured)
      if (info) next = { path: captured, source: 'capture', mtimeMs: info.mtimeMs }
    }
  }

  const nextFit = resolveFit(reg)
  const nextBackground = parseBackgroundColor(reg.background) ?? '#101014'

  const changed =
    force ||
    next?.path !== currentFile?.path ||
    next?.mtimeMs !== currentFile?.mtimeMs ||
    nextFit !== fit ||
    nextBackground !== backgroundColor

  currentFile = next
  fit = nextFit
  backgroundColor = nextBackground
  return changed
}

export function wallpaperSignature(): string {
  if (!currentFile) return '0'
  return `${currentFile.mtimeMs}-${currentFile.source}`
}

function unionBounds(rects: Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function buildBackdrop(win: BrowserWindow | null): BackdropInfo {
  const windowBounds = win ? win.getBounds() : { x: 0, y: 0, width: 960, height: 480 }
  const display = screen.getDisplayMatching(windowBounds)
  const spanBounds = unionBounds(screen.getAllDisplays().map((entry) => entry.bounds))
  const signature = wallpaperSignature()

  return {
    url: currentFile ? `${WALLPAPER_SCHEME}://current/?v=${encodeURIComponent(signature)}` : '',
    version: signature,
    source: currentFile?.source ?? 'none',
    fit,
    display: { id: display.id, bounds: display.bounds, scaleFactor: display.scaleFactor },
    spanBounds,
    windowBounds,
    backgroundColor
  }
}

export function startWallpaperWatch(onChange: () => void): NodeJS.Timeout {
  return setInterval(() => {
    void refreshWallpaper(false).then((changed) => {
      if (changed) onChange()
    })
  }, 60_000)
}
