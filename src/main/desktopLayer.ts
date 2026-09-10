import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { BrowserWindow } from 'electron'
import type { DesktopLayerRequest, DesktopLayerResolved } from '../shared/types'
import { resourcePath } from './paths'

const execFileAsync = promisify(execFile)

export interface DesktopLayerResult {
  mode: DesktopLayerResolved
  requested: DesktopLayerRequest
  ok: boolean
  detail: string
}

function windowHandle(win: BrowserWindow): string | null {
  try {
    const buffer = win.getNativeWindowHandle()
    if (buffer.length >= 8) return buffer.readBigInt64LE(0).toString()
    if (buffer.length >= 4) return String(buffer.readInt32LE(0))
    return null
  } catch {
    return null
  }
}

async function runScript(hwnd: string, mode: 'workerw' | 'bottom'): Promise<{ ok: boolean; mode: string; parent: string; error: string }> {
  const script = resourcePath('desktop-layer.ps1')
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Hwnd', hwnd, '-Mode', mode],
    { windowsHide: true, timeout: 15_000 }
  )
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? ''
  return JSON.parse(line)
}

async function attach(win: BrowserWindow, mode: 'workerw' | 'bottom') {
  const hwnd = windowHandle(win)
  if (!hwnd) return { ok: false, mode, parent: 'unknown', error: 'window handle unavailable' }
  try {
    return await runScript(hwnd, mode)
  } catch (error) {
    return {
      ok: false,
      mode,
      parent: 'unknown',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/** Pins the window to the wallpaper layer, falling back to a plain floating window. */
export async function applyDesktopLayer(win: BrowserWindow, requested: DesktopLayerRequest): Promise<DesktopLayerResult> {
  if (requested === 'bottom') {
    const result = await attach(win, 'bottom')
    return { mode: 'bottom', requested, ok: result.ok, detail: result.parent }
  }

  const worker = await attach(win, 'workerw')
  if (worker.ok) {
    return { mode: 'workerw', requested, ok: true, detail: worker.parent }
  }

  const fallback = await attach(win, 'bottom')
  return {
    mode: 'bottom',
    requested,
    ok: false,
    detail: `${worker.error || 'desktop attach failed'} / fallback:${fallback.parent}`
  }
}

export function desktopLayerScriptPath(): string {
  return join('resources', 'desktop-layer.ps1')
}
