import { app, BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from 'electron'
import type { DateKey, Rect, ResizeAnchor, Settings, Snapshot } from '../shared/types'
import { MAIN_MIN_SIZE, HISTORY_MIN_SIZE } from './windows'
import { windowRole } from './windowRoles'
import type { TodoState } from './state'

interface DragSession {
  kind: 'drag' | 'resize'
  anchor: ResizeAnchor
  start: Rect
}

const sessions = new Map<number, DragSession>()

export interface IpcContext {
  state: TodoState
  snapshotFor: (win: BrowserWindow | null) => Snapshot
  openHistory: () => void
  closeHistory: () => void
  refreshBackdrop: () => Promise<void>
  applyDesktopLayer: (requested: Settings['desktopLayer']) => Promise<void>
  applyLoginItem: (enabled: boolean) => void
}

function senderWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

function minSizeFor(win: BrowserWindow): { width: number; height: number } {
  return windowRole(win) === 'history' ? HISTORY_MIN_SIZE : MAIN_MIN_SIZE
}

function boundsKey(win: BrowserWindow): 'historyWindow' | 'mainWindow' {
  return windowRole(win) === 'history' ? 'historyWindow' : 'mainWindow'
}

function computeResize(
  start: Rect,
  anchor: ResizeAnchor,
  dx: number,
  dy: number,
  min: { width: number; height: number }
): Rect {
  const area = screen.getDisplayMatching(start).workArea
  let width = start.width
  let height = start.height

  if (anchor.includes('e')) width = start.width + dx
  if (anchor.includes('w')) width = start.width - dx
  if (anchor.includes('s')) height = start.height + dy
  if (anchor.includes('n')) height = start.height - dy

  width = Math.min(Math.max(Math.round(width), min.width), area.width)
  height = Math.min(Math.max(Math.round(height), min.height), area.height)

  const x = anchor.includes('w') ? start.x + (start.width - width) : start.x
  const y = anchor.includes('n') ? start.y + (start.height - height) : start.y
  return { x, y, width, height }
}

export function registerIpc(context: IpcContext): void {
  const { state } = context

  ipcMain.handle('state:get', (event) => context.snapshotFor(senderWindow(event)))
  ipcMain.handle('history:get', () => context.state.history())
  ipcMain.handle('history:open', () => context.openHistory())
  ipcMain.handle('history:close', () => context.closeHistory())
  ipcMain.handle('backdrop:refresh', () => context.refreshBackdrop())
  ipcMain.handle('app:quit', () => app.quit())

  ipcMain.handle('task:add', (_event, dateKey: DateKey, text: string) => {
    state.addTask(dateKey, text)
  })
  ipcMain.handle('task:setText', (_event, id: string, text: string) => {
    state.setTaskText(id, text)
  })
  ipcMain.handle('task:toggle', (_event, id: string) => {
    state.toggleTask(id)
  })
  ipcMain.handle('task:delete', (_event, id: string) => {
    state.deleteTask(id)
  })
  ipcMain.handle('task:move', (_event, id: string, toDateKey: DateKey, toIndex: number) => {
    state.moveTask(id, toDateKey, toIndex)
  })

  ipcMain.handle('settings:patch', async (_event, patch: Partial<Settings>) => {
    const previousLayer = state.settings.desktopLayer
    state.patchSettings(patch)
    if (patch.startAtLogin !== undefined) context.applyLoginItem(patch.startAtLogin)
    if (patch.desktopLayer !== undefined && patch.desktopLayer !== previousLayer) {
      await context.applyDesktopLayer(patch.desktopLayer)
    }
  })

  ipcMain.handle('window:drag-start', (event) => {
    const win = senderWindow(event)
    if (!win) return
    sessions.set(event.sender.id, { kind: 'drag', anchor: 'se', start: win.getBounds() })
  })

  ipcMain.handle('window:drag-move', (event, dx: number, dy: number) => {
    const win = senderWindow(event)
    const session = sessions.get(event.sender.id)
    if (!win || !session) return
    win.setBounds({
      x: Math.round(session.start.x + dx),
      y: Math.round(session.start.y + dy),
      width: session.start.width,
      height: session.start.height
    })
  })

  ipcMain.handle('window:drag-end', (event) => {
    const win = senderWindow(event)
    sessions.delete(event.sender.id)
    if (!win) return
    const bounds = win.getBounds()
    state.updateWindowBounds(boundsKey(win), bounds)
    state.emit()
  })

  ipcMain.handle('window:resize-start', (event, anchor: ResizeAnchor) => {
    const win = senderWindow(event)
    if (!win) return
    sessions.set(event.sender.id, { kind: 'resize', anchor, start: win.getBounds() })
  })

  ipcMain.handle('window:resize-move', (event, dx: number, dy: number) => {
    const win = senderWindow(event)
    const session = sessions.get(event.sender.id)
    if (!win || !session) return
    win.setBounds(computeResize(session.start, session.anchor, dx, dy, minSizeFor(win)))
  })

  ipcMain.handle('window:resize-end', (event) => {
    const win = senderWindow(event)
    sessions.delete(event.sender.id)
    if (!win) return
    const bounds = win.getBounds()
    state.updateWindowBounds(boundsKey(win), bounds)
    state.emit()
  })
}
