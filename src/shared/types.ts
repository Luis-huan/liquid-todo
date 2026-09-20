export type DateKey = string
export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'
export type DesktopLayerRequest = 'auto' | 'workerw' | 'bottom'
export type DesktopLayerResolved = 'workerw' | 'bottom'
export type WallpaperFit = 'fill' | 'fit' | 'stretch' | 'center' | 'span' | 'tile'
export type ColumnId = 'yesterday' | 'today'
export type ResizeAnchor = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export interface Task {
  id: string
  text: string
  createdAt: string
  completedAt: string | null
  carriedFrom?: DateKey
  movedToToday?: boolean
  order: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type WindowGeometry = Rect

export interface Settings {
  theme: ThemeMode
  desktopLayer: DesktopLayerRequest
  startAtLogin: boolean
  mainWindow: WindowGeometry
  historyWindow: WindowGeometry
  calendarWindow: WindowGeometry
}

export interface StoreData {
  version: number
  todayKey: DateKey
  days: Record<DateKey, Task[]>
  /** Days the user picked in the calendar. Today+1 (Tomorrow) is implicit and never stored. */
  futureDates: DateKey[]
  settings: Settings
}

export interface ColumnView {
  id: ColumnId
  label: string
  dateLabel: string
  dateKey: DateKey
  readOnly: boolean
  tasks: Task[]
  total: number
  done: number
}

/**
 * One day in the Future column: the pinned Tomorrow row first, then the days the user picked,
 * oldest first. Tasks live under their own date.
 */
export interface FutureRow {
  dateKey: DateKey
  label: string
  /** The Tomorrow row is the day after today; it is always present and cannot be removed. */
  isTomorrow: boolean
  tasks: Task[]
  total: number
}

export interface DisplayInfo {
  id: number
  bounds: Rect
  scaleFactor: number
}

export interface BackdropInfo {
  url: string
  version: string
  source: 'transcoded' | 'registry' | 'capture' | 'none'
  fit: WallpaperFit
  display: DisplayInfo
  spanBounds: Rect
  windowBounds: WindowGeometry
  backgroundColor: string
}

export interface AppNotice {
  id: number
  kind: 'info' | 'warn'
  text: string
}

export interface Snapshot {
  todayKey: DateKey
  columns: ColumnView[]
  future: FutureRow[]
  theme: ResolvedTheme
  desktopLayer: DesktopLayerResolved
  desktopLayerRequested: DesktopLayerRequest
  backdrop: BackdropInfo
  settings: Settings
  notice: AppNotice | null
}

export interface HistoryDay {
  dateKey: DateKey
  label: string
  tasks: Task[]
  total: number
  done: number
}

export interface HistoryPayload {
  days: HistoryDay[]
}

export interface LiquidTodoApi {
  getSnapshot(): Promise<Snapshot>
  addTask(dateKey: DateKey, text: string): Promise<void>
  setTaskText(id: string, text: string): Promise<void>
  toggleTask(id: string): Promise<void>
  deleteTask(id: string): Promise<void>
  moveTask(id: string, toDateKey: DateKey, toIndex: number): Promise<void>
  addFutureDate(dateKey: DateKey): Promise<void>
  removeFutureDate(dateKey: DateKey): Promise<void>
  /** Adds the day and closes the calendar window, the whole "pick a date" gesture. */
  pickFutureDate(dateKey: DateKey): Promise<void>
  getHistory(): Promise<HistoryPayload>
  patchSettings(patch: Partial<Settings>): Promise<void>
  refreshBackdrop(): Promise<void>
  openHistory(): Promise<void>
  closeHistory(): Promise<void>
  openCalendar(): Promise<void>
  closeCalendar(): Promise<void>
  quit(): Promise<void>
  windowDragStart(): Promise<void>
  windowDragMove(dx: number, dy: number): Promise<void>
  windowDragEnd(): Promise<void>
  windowResizeStart(anchor: ResizeAnchor): Promise<void>
  windowResizeMove(dx: number, dy: number): Promise<void>
  windowResizeEnd(): Promise<void>
  onSnapshot(cb: (snapshot: Snapshot) => void): () => void
  onHistory(cb: (payload: HistoryPayload) => void): () => void
}
