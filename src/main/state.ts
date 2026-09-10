import { join } from 'node:path'
import { app } from 'electron'
import { addDays, formatFullDate } from '../shared/date'
import { newId } from '../shared/ids'
import { loadStoreFile, writeStoreFile } from './persist'
import {
  RETENTION_DAYS,
  advanceDays,
  clampTaskText,
  findTask,
  normalizeTaskOrder,
  resolveCurrentDateKey
} from '../shared/rollover'
import type {
  AppNotice,
  BackdropInfo,
  ColumnId,
  ColumnView,
  DateKey,
  HistoryDay,
  HistoryPayload,
  Settings,
  Snapshot,
  StoreData,
  Task
} from '../shared/types'

const EMPTY_BACKDROP: BackdropInfo = {
  url: '',
  version: '0',
  source: 'none',
  fit: 'fill',
  display: { id: -1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
  spanBounds: { x: 0, y: 0, width: 1920, height: 1080 },
  windowBounds: { x: 0, y: 0, width: 960, height: 480 },
  backgroundColor: '#101014'
}

export type StateListener = (snapshot: Snapshot) => void

export class TodoState {
  private readonly file: string
  private data: StoreData
  private notice: AppNotice | null = null
  private noticeSeq = 0
  private saveTimer: NodeJS.Timeout | null = null
  private readonly listeners = new Set<StateListener>()
  private backdrop: BackdropInfo = EMPTY_BACKDROP
  private desktopLayer: Snapshot['desktopLayer'] = 'bottom'

  constructor(private readonly fakeDate: string | null) {
    this.file = join(app.getPath('userData'), 'data.json')
    this.data = this.load()
  }

  // ---------------------------------------------------------------- persistence

  private load(): StoreData {
    const todayKey = this.currentDateKey()
    const result = loadStoreFile(this.file, todayKey)
    if (result.corrupt) {
      this.setNotice('The data file was unreadable, so Liquid Todo started fresh.', 'warn')
    } else if (result.repaired) {
      this.setNotice('Some saved entries could not be read and were cleaned up.', 'warn')
    }
    return result.store
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.saveNow(), 250)
  }

  saveNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    try {
      writeStoreFile(this.file, this.data)
    } catch (error) {
      console.error('[liquid-todo] failed to persist state', error)
    }
  }

  // ---------------------------------------------------------------- clock / rollover

  currentDateKey(): DateKey {
    return resolveCurrentDateKey(new Date(), this.fakeDate)
  }

  /** Rolls the board forward when the calendar day has changed. Returns true when data changed. */
  tick(): boolean {
    const currentKey = this.currentDateKey()
    if (this.data.todayKey === currentKey) return false
    if (this.data.todayKey > currentKey) return false

    const result = advanceDays(this.data.todayKey, this.data.days, currentKey)
    this.data = { ...this.data, todayKey: result.todayKey, days: result.days }
    this.saveNow()
    this.emit()
    return true
  }

  // ---------------------------------------------------------------- reads

  get settings(): Settings {
    return this.data.settings
  }

  markEditable(dateKey: DateKey): boolean {
    return dateKey === this.data.todayKey || dateKey === addDays(this.data.todayKey, 1)
  }

  private column(id: ColumnId, label: string, dateKey: DateKey, readOnly: boolean): ColumnView {
    const tasks = normalizeTaskOrder(this.data.days[dateKey] ?? [])
    return {
      id,
      label,
      dateKey,
      dateLabel: formatFullDate(dateKey),
      readOnly,
      tasks,
      total: tasks.length,
      done: tasks.filter((task) => task.completedAt).length
    }
  }

  snapshot(): Snapshot {
    const todayKey = this.data.todayKey
    return {
      todayKey,
      columns: [
        this.column('yesterday', 'yesterday', addDays(todayKey, -1), true),
        this.column('today', 'today', todayKey, false),
        this.column('nextDay', 'next day', addDays(todayKey, 1), false)
      ],
      theme: 'light',
      desktopLayer: this.desktopLayer,
      desktopLayerRequested: this.data.settings.desktopLayer,
      backdrop: this.backdrop,
      settings: this.data.settings,
      notice: this.notice
    }
  }

  history(): HistoryPayload {
    const todayKey = this.data.todayKey
    const days: HistoryDay[] = []
    for (let offset = 1; offset < RETENTION_DAYS; offset += 1) {
      const dateKey = addDays(todayKey, -offset)
      const tasks = normalizeTaskOrder(this.data.days[dateKey] ?? [])
      days.push({
        dateKey,
        label: formatFullDate(dateKey),
        tasks,
        total: tasks.length,
        done: tasks.filter((task) => task.completedAt).length
      })
    }
    return { days }
  }

  // ---------------------------------------------------------------- mutations

  addTask(dateKey: DateKey, text: string): void {
    if (!this.markEditable(dateKey)) return
    const clean = clampTaskText(text)
    if (!clean) return
    const tasks = this.data.days[dateKey] ?? []
    const task: Task = {
      id: newId(),
      text: clean,
      createdAt: new Date().toISOString(),
      completedAt: null,
      order: tasks.length
    }
    this.data.days[dateKey] = [...tasks, task]
    this.commit()
  }

  setTaskText(id: string, text: string): void {
    const found = findTask(this.data.days, id)
    if (!found || !this.markEditable(found.dateKey)) return
    const clean = clampTaskText(text)
    if (!clean) {
      this.deleteTask(id)
      return
    }
    this.data.days[found.dateKey] = (this.data.days[found.dateKey] ?? []).map((task) =>
      task.id === id ? { ...task, text: clean } : task
    )
    this.commit()
  }

  toggleTask(id: string): void {
    const found = findTask(this.data.days, id)
    if (!found || !this.markEditable(found.dateKey)) return
    this.data.days[found.dateKey] = (this.data.days[found.dateKey] ?? []).map((task) =>
      task.id === id ? { ...task, completedAt: task.completedAt ? null : new Date().toISOString() } : task
    )
    this.commit()
  }

  deleteTask(id: string): void {
    const found = findTask(this.data.days, id)
    if (!found || !this.markEditable(found.dateKey)) return
    this.data.days[found.dateKey] = normalizeTaskOrder(
      (this.data.days[found.dateKey] ?? []).filter((task) => task.id !== id)
    )
    this.commit()
  }

  moveTask(id: string, toDateKey: DateKey, toIndex: number): void {
    const found = findTask(this.data.days, id)
    if (!found || !this.markEditable(found.dateKey) || !this.markEditable(toDateKey)) return

    const moving: Task = { ...found.task }
    delete moving.carriedFrom
    delete moving.movedToToday

    const source = (this.data.days[found.dateKey] ?? []).filter((task) => task.id !== id)
    const target = found.dateKey === toDateKey ? source : (this.data.days[toDateKey] ?? []).slice()
    const index = Math.max(0, Math.min(Math.round(toIndex), target.length))
    target.splice(index, 0, moving)

    this.data.days[found.dateKey] = normalizeTaskOrder(source)
    this.data.days[toDateKey] = normalizeTaskOrder(target)
    this.commit()
  }

  patchSettings(patch: Partial<Settings>): void {
    this.data.settings = {
      ...this.data.settings,
      ...patch,
      mainWindow: patch.mainWindow ?? this.data.settings.mainWindow,
      historyWindow: patch.historyWindow ?? this.data.settings.historyWindow
    }
    this.saveNow()
    this.emit()
  }

  updateWindowBounds(kind: 'mainWindow' | 'historyWindow', bounds: Settings['mainWindow']): void {
    this.data.settings = { ...this.data.settings, [kind]: bounds }
    this.scheduleSave()
  }

  private commit(): void {
    this.scheduleSave()
    this.emit()
  }

  // ---------------------------------------------------------------- wiring

  setBackdrop(backdrop: BackdropInfo): void {
    this.backdrop = backdrop
    this.emit()
  }

  setDesktopLayer(layer: Snapshot['desktopLayer']): void {
    this.desktopLayer = layer
    this.emit()
  }

  setNotice(text: string, kind: AppNotice['kind'] = 'info'): void {
    this.noticeSeq += 1
    this.notice = { id: this.noticeSeq, kind, text }
    this.emit()
  }

  clearNotice(id: number): void {
    if (this.notice?.id === id) {
      this.notice = null
      this.emit()
    }
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}
