import { spawn, type ChildProcess } from 'node:child_process'
import type { BrowserWindow } from 'electron'
import type { DesktopLayerRequest, DesktopLayerResolved } from '../shared/types'
import { resourcePath } from './paths'

export interface DesktopLayerResult {
  mode: DesktopLayerResolved
  requested: DesktopLayerRequest
  ok: boolean
  detail: string
}

export interface DesktopLayerStatus {
  /** The desktop window really owns the widget, so it sits behind every normal window. */
  pinned: boolean
  ownerClass: string
  topmost: boolean
  toolWindow: boolean
}

const REQUEST_TIMEOUT = 12_000

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
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

/**
 * Keeps one PowerShell process alive for the whole session and talks to it over stdio.
 *
 * Starting PowerShell per call takes about a second, which is far too slow for the ownership
 * checks that keep the widget glued to the desktop, so the native entry points are loaded once
 * and reused. It only ever touches the widget's own window.
 */
class DesktopLayerHost {
  private child: ChildProcess | null = null
  private buffer = ''
  private sequence = 0
  private readonly pending = new Map<number, PendingRequest>()
  private closed = false

  private ensureChild(): ChildProcess | null {
    if (this.closed) return null
    if (this.child && this.child.exitCode === null && !this.child.killed) return this.child
    this.child = null

    try {
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          resourcePath('desktop-layer.ps1'),
          '-Serve'
        ],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
      )
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => this.receive(chunk))
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        const text = String(chunk).trim()
        if (text) console.error('[liquid-todo] desktop layer host:', text)
      })
      child.on('error', (error) => {
        this.abort(new Error(`desktop layer host failed to start: ${error.message}`))
      })
      child.on('exit', (code) => {
        this.child = null
        this.abort(new Error(`desktop layer host exited (${code ?? 'unknown'})`))
      })
      this.child = child
      return child
    } catch (error) {
      console.error('[liquid-todo] desktop layer host could not start', error)
      return null
    }
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (line) this.complete(line)
      index = this.buffer.indexOf('\n')
    }
  }

  private complete(line: string): void {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(line) as Record<string, unknown>
    } catch {
      // PowerShell banners and similar noise are expected on a broken host; ignore them.
      return
    }
    const id = typeof payload.id === 'number' ? payload.id : null
    if (id === null) return
    const request = this.pending.get(id)
    if (!request) return
    this.pending.delete(id)
    clearTimeout(request.timer)
    request.resolve(payload)
  }

  /** Fails every in-flight request, e.g. when the host process died. */
  private abort(error: Error): void {
    for (const [id, request] of this.pending) {
      clearTimeout(request.timer)
      this.pending.delete(id)
      request.reject(error)
    }
  }

  async send(
    command: string,
    hwnd: string,
    mode?: DesktopLayerResolved
  ): Promise<Record<string, unknown> | null> {
    if (this.closed) return null
    const child = this.ensureChild()
    if (!child || !child.stdin || child.stdin.destroyed) return null

    this.sequence += 1
    const id = this.sequence
    const line = `${JSON.stringify({ id, cmd: command, hwnd, mode })}\n`

    const response = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`desktop layer host did not answer "${command}" in time`))
      }, REQUEST_TIMEOUT)
      this.pending.set(id, { resolve, reject, timer })
    })

    try {
      child.stdin.write(line)
    } catch {
      this.pending.delete(id)
      return null
    }

    try {
      return await response
    } catch (error) {
      console.error('[liquid-todo] desktop layer:', error instanceof Error ? error.message : error)
      return null
    }
  }

  dispose(): void {
    this.closed = true
    const child = this.child
    this.child = null
    this.abort(new Error('desktop layer host stopped'))
    if (!child) return
    try {
      child.stdin?.write(`${JSON.stringify({ id: 0, cmd: 'exit' })}\n`)
    } catch {
      /* the process is already gone */
    }
    child.kill()
  }
}

const host = new DesktopLayerHost()

/**
 * Reports where the widget currently sits. A widget that lost its desktop owner (Explorer
 * restarts, display or theme changes, a fullscreen game switching modes) turns into an ordinary
 * window, and lifting it then would push it in front of whatever the user is doing.
 */
export async function desktopLayerStatus(win: BrowserWindow): Promise<DesktopLayerStatus | null> {
  const hwnd = windowHandle(win)
  if (!hwnd) return null
  const reply = await host.send('status', hwnd)
  if (!reply || reply.ok !== true) return null
  return {
    pinned: reply.pinned === true,
    ownerClass: typeof reply.ownerClass === 'string' ? reply.ownerClass : '',
    topmost: reply.topmost === true,
    toolWindow: reply.toolWindow === true
  }
}

/** Pins the window to the wallpaper layer, falling back to a plain floating window. */
export async function applyDesktopLayer(
  win: BrowserWindow,
  requested: DesktopLayerRequest
): Promise<DesktopLayerResult> {
  const hwnd = windowHandle(win)
  if (!hwnd) return { mode: 'bottom', requested, ok: false, detail: 'window handle unavailable' }

  if (requested === 'bottom') {
    const reply = await host.send('attach', hwnd, 'bottom')
    return {
      mode: 'bottom',
      requested,
      ok: reply?.ok === true,
      detail: typeof reply?.parent === 'string' ? reply.parent : 'desktop-independent'
    }
  }

  const worker = await host.send('attach', hwnd, 'workerw')
  if (worker?.ok === true) {
    return { mode: 'workerw', requested, ok: true, detail: String(worker.parent ?? '') }
  }

  const fallback = await host.send('attach', hwnd, 'bottom')
  return {
    mode: 'bottom',
    requested,
    ok: false,
    detail: `${String(worker?.error || 'desktop attach failed')} / fallback:${
      fallback?.ok === true ? 'bottom' : 'failed'
    }`
  }
}

export function disposeDesktopLayer(): void {
  host.dispose()
}
