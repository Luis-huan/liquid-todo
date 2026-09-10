import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, screen, shell, type BrowserWindowConstructorOptions } from 'electron'
import type { Rect } from '../shared/types'
import type { TodoState } from './state'
import { setWindowRole } from './windowRoles'

export const MAIN_MIN_SIZE = { width: 660, height: 300 }
export const HISTORY_MIN_SIZE = { width: 300, height: 320 }

const PRELOAD = join(__dirname, '../preload/index.js')

function rendererBase(): { url?: string; file?: string } {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (devServer) return { url: `${devServer}/index.html` }
  const file = join(__dirname, '../renderer/index.html')
  return existsSync(file) ? { file } : {}
}

function areaOf(bounds: Rect) {
  const displays = screen.getAllDisplays()
  const display =
    displays.find((entry) => {
      const area = entry.bounds
      return (
        bounds.x + bounds.width > area.x &&
        bounds.x < area.x + area.width &&
        bounds.y + bounds.height > area.y &&
        bounds.y < area.y + area.height
      )
    }) ?? screen.getPrimaryDisplay()
  return display.workArea
}

function clamp(bounds: Rect, min: { width: number; height: number }): Rect {
  const area = areaOf(bounds)
  const width = Math.min(Math.max(bounds.width, min.width), area.width)
  const height = Math.min(Math.max(bounds.height, min.height), area.height)
  const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - width)
  const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

function defaultPosition(width: number, height: number): Rect {
  const area = screen.getPrimaryDisplay().workArea
  const margin = 28
  return {
    x: Math.round(area.x + area.width - width - margin),
    y: Math.round(area.y + area.height - height - margin),
    width,
    height
  }
}

export function resolveMainBounds(state: TodoState): Rect {
  const saved = state.settings.mainWindow
  const base = saved.x < 0 || saved.y < 0 ? defaultPosition(saved.width, saved.height) : saved
  return clamp(base, MAIN_MIN_SIZE)
}

export function resolveHistoryBounds(state: TodoState): Rect {
  const saved = state.settings.historyWindow
  if (saved.x < 0 || saved.y < 0) {
    const main = resolveMainBounds(state)
    return clamp(
      { x: main.x - saved.width - 18, y: main.y, width: saved.width, height: saved.height },
      HISTORY_MIN_SIZE
    )
  }
  return clamp(saved, HISTORY_MIN_SIZE)
}

function baseOptions(bounds: Rect): BrowserWindowConstructorOptions {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    roundedCorners: false,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  }
}

function loadWindow(win: BrowserWindow, hash: string): void {
  const base = rendererBase()
  if (base.url) {
    void win.loadURL(hash ? `${base.url}${hash}` : base.url)
  } else if (base.file) {
    void win.loadFile(base.file, hash ? { hash: hash.replace(/^#/, '') } : undefined)
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
}

export function createMainWindow(state: TodoState): BrowserWindow {
  const bounds = resolveMainBounds(state)
  const win = new BrowserWindow({
    ...baseOptions(bounds),
    minWidth: MAIN_MIN_SIZE.width,
    minHeight: MAIN_MIN_SIZE.height
  })
  loadWindow(win, '')
  setWindowRole(win, 'main')
  return win
}

export function createHistoryWindow(state: TodoState): BrowserWindow {
  const bounds = resolveHistoryBounds(state)
  const win = new BrowserWindow({
    ...baseOptions(bounds),
    minWidth: HISTORY_MIN_SIZE.width,
    minHeight: HISTORY_MIN_SIZE.height
  })
  loadWindow(win, '#history')
  setWindowRole(win, 'history')
  return win
}
