import { contextBridge, ipcRenderer } from 'electron'
import type { DateKey, HistoryPayload, LiquidTodoApi, ResizeAnchor, Settings, Snapshot } from '../shared/types'

type StatePayload = { snapshot: Snapshot; history: HistoryPayload }

const api: LiquidTodoApi = {
  getSnapshot: () => ipcRenderer.invoke('state:get') as Promise<Snapshot>,
  addTask: (dateKey: DateKey, text: string) => ipcRenderer.invoke('task:add', dateKey, text),
  setTaskText: (id: string, text: string) => ipcRenderer.invoke('task:setText', id, text),
  toggleTask: (id: string) => ipcRenderer.invoke('task:toggle', id),
  deleteTask: (id: string) => ipcRenderer.invoke('task:delete', id),
  moveTask: (id: string, toDateKey: DateKey, toIndex: number) =>
    ipcRenderer.invoke('task:move', id, toDateKey, toIndex),
  getHistory: () => ipcRenderer.invoke('history:get') as Promise<HistoryPayload>,
  patchSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:patch', patch),
  refreshBackdrop: () => ipcRenderer.invoke('backdrop:refresh'),
  getCaptureSource: () => ipcRenderer.invoke('capture:source') as Promise<string | null>,
  openHistory: () => ipcRenderer.invoke('history:open'),
  closeHistory: () => ipcRenderer.invoke('history:close'),
  quit: () => ipcRenderer.invoke('app:quit'),
  windowDragStart: () => ipcRenderer.invoke('window:drag-start'),
  windowDragMove: (dx: number, dy: number) => ipcRenderer.invoke('window:drag-move', dx, dy),
  windowDragEnd: () => ipcRenderer.invoke('window:drag-end'),
  windowResizeStart: (anchor: ResizeAnchor) => ipcRenderer.invoke('window:resize-start', anchor),
  windowResizeMove: (dx: number, dy: number) => ipcRenderer.invoke('window:resize-move', dx, dy),
  windowResizeEnd: () => ipcRenderer.invoke('window:resize-end'),
  onSnapshot: (callback: (snapshot: Snapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: StatePayload): void => {
      callback(payload.snapshot)
    }
    ipcRenderer.on('state:changed', listener)
    return () => {
      ipcRenderer.removeListener('state:changed', listener)
    }
  },
  onHistory: (callback: (payload: HistoryPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: StatePayload): void => {
      callback(payload.history)
    }
    ipcRenderer.on('state:changed', listener)
    return () => {
      ipcRenderer.removeListener('state:changed', listener)
    }
  }
}

contextBridge.exposeInMainWorld('liquidTodo', api)
