import { join } from 'node:path'
import { app } from 'electron'
import { addDays, formatFullDate } from '../shared/date'
import { newId } from '../shared/ids'
import { loadStoreFile, writeStoreFile } from './persist'
import {
  RETENTION_DAYS,
  advanceDays,
  assignSequentialOrder,
  bandInsertRange,
  clampTaskText,
  findTask,
  insertOpenTask,
  isDone,
  mergeFutureDates,
  moveMatchingLast,
  normalizeTaskOrder,
  resolveCurrentDateKey,
  sameDates,
  sortTaskBands,
  taskBand
} from '../shared/rollover'
import type {
  AppNotice,
  BackdropInfo,
  ColumnId,
  ColumnView,
  DateKey,
  HistoryDay,
  HistoryPayload,
  FutureRow,
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

/**
 * A day that is over is always presented as "what slipped stays on top": the unfinished tasks
 * first, the finished ones below them. New days are written in that shape when they are frozen
 * at rollover; this also covers days that were recorded under an older version, so History and
 * the Yesterday column agree. Only the display is rearranged — the stored order is untouched.
 *
 * Today is deliberately left alone: there the user's own drag order wins.
 */
function freezeOrder(tasks: Task[], frozen: boolean): Task[] {
  return frozen ? moveMatchingLast(tasks, isDone) : tasks
}

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
    this.healFutureDates()
  }

  /**
   * Puts back days that earlier versions dropped from the Future list while their tasks stayed in
   * the store, and writes the repaired board straight away so it cannot be lost again.
   */
  private healFutureDates(): void {
    const healed = mergeFutureDates(this.data.days, this.data.todayKey, this.data.futureDates)
    if (sameDates(healed, this.data.futureDates)) return
    this.data = { ...this.data, futureDates: healed }
    this.saveNow()
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

    const result = advanceDays(this.data.todayKey, this.data.days, currentKey, this.data.futureDates)
    this.data = {
      ...this.data,
      todayKey: result.todayKey,
      days: result.days,
      futureDates: mergeFutureDates(result.days, result.todayKey, result.futureDates)
    }
    this.saveNow()
    this.emit()
    return true
  }

  // ---------------------------------------------------------------- reads

  get settings(): Settings {
    return this.data.settings
  }

  /** Where the widget actually ended up: `workerw` when the desktop layer accepted it. */
  get desktopLayerMode(): Snapshot['desktopLayer'] {
    return this.desktopLayer
  }

  markEditable(dateKey: DateKey): boolean {
    // Today, tomorrow and any day the user put on the Future list.
    return dateKey >= this.data.todayKey
  }

  private column(id: ColumnId, label: string, dateKey: DateKey, readOnly: boolean): ColumnView {
    const tasks = freezeOrder(normalizeTaskOrder(this.data.days[dateKey] ?? []), readOnly)
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
        this.column('yesterday', 'Yesterday', addDays(todayKey, -1), true),
        this.column('today', 'Today', todayKey, false)
      ],
      future: this.futureRows(),
      theme: 'light',
      desktopLayer: this.desktopLayer,
      desktopLayerRequested: this.data.settings.desktopLayer,
      backdrop: this.backdrop,
      settings: this.data.settings,
      notice: this.notice
    }
  }

  /**
   * The Future column: the pinned Tomorrow row (always today + 1, whether or not it has tasks)
   * followed by the days the user picked, oldest first.
   */
  private futureRows(): FutureRow[] {
    const todayKey = this.data.todayKey
    const tomorrowKey = addDays(todayKey, 1)
    const row = (dateKey: DateKey, isTomorrow: boolean): FutureRow => {
      const tasks = normalizeTaskOrder(this.data.days[dateKey] ?? [])
      return {
        dateKey,
        label: formatFullDate(dateKey),
        isTomorrow,
        tasks,
        total: tasks.length
      }
    }

    const picked = this.data.futureDates
      .filter((dateKey) => dateKey > tomorrowKey)
      .sort()
      .map((dateKey) => row(dateKey, false))

    return [row(tomorrowKey, true), ...picked]
  }

  history(): HistoryPayload {
    const todayKey = this.data.todayKey
    const days: HistoryDay[] = []
    for (let offset = 1; offset < RETENTION_DAYS; offset += 1) {
      const dateKey = addDays(todayKey, -offset)
      const tasks = freezeOrder(normalizeTaskOrder(this.data.days[dateKey] ?? []), true)
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
    // Today keeps its finished tasks at the bottom, so a new task joins the open group instead
    // of landing underneath the crossed out ones. The next day's plan is a plain list.
    this.data.days[dateKey] =
      dateKey === this.data.todayKey ? insertOpenTask(tasks, task) : assignSequentialOrder([...tasks, task])
    // Adding a task to a day that is not on the Future list puts it there, so the row appears.
    this.registerFutureDate(dateKey)
    this.commit()
  }

  /** Days the user picked in the calendar. Today and tomorrow are not pickable. */
  addFutureDate(dateKey: DateKey): void {
    if (!this.registerFutureDate(dateKey)) return
    this.commit()
  }

  /** Drops a picked day; tomorrow, today and the past are never removable. */
  removeFutureDate(dateKey: DateKey): void {
    const tomorrowKey = addDays(this.data.todayKey, 1)
    if (dateKey <= tomorrowKey) return
    if (!this.data.futureDates.includes(dateKey)) return

    const futureDates = this.data.futureDates.filter((entry) => entry !== dateKey)
    const days = { ...this.data.days }
    delete days[dateKey]
    this.data = { ...this.data, days, futureDates }
    this.commit()
  }

  /** Returns true when the day was actually added to the Future list. */
  private registerFutureDate(dateKey: DateKey): boolean {
    const tomorrowKey = addDays(this.data.todayKey, 1)
    if (dateKey <= tomorrowKey) return false
    if (this.data.futureDates.includes(dateKey)) return false
    this.data = { ...this.data, futureDates: [...this.data.futureDates, dateKey].sort() }
    return true
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
    const toggled = (this.data.days[found.dateKey] ?? []).map((task) =>
      task.id === id ? { ...task, completedAt: task.completedAt ? null : new Date().toISOString() } : task
    )
    // Today re-sorts into its bands: carried work stays on top, the finished task drops to the
    // bottom, and unticking puts a carried task back where it belongs instead of at the end of
    // the ordinary open list.
    this.data.days[found.dateKey] =
      found.dateKey === this.data.todayKey ? sortTaskBands(toggled) : normalizeTaskOrder(toggled)
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

    // Badges travel with the task: dragging never clears "carried over", only ticking it off does.
    const moving: Task = { ...found.task }

    const source = normalizeTaskOrder(
      (this.data.days[found.dateKey] ?? []).filter((task) => task.id !== id)
    )
    const target =
      found.dateKey === toDateKey ? source : normalizeTaskOrder(this.data.days[toDateKey] ?? [])
    const index = this.placementIndex(target, moving, toIndex, toDateKey)
    const next = target.slice()
    next.splice(index, 0, moving)

    this.data.days[found.dateKey] = source
    this.data.days[toDateKey] = assignSequentialOrder(next)
    this.commit()
  }

  /**
   * Today only allows a task inside its own band: carried over work stays on top, finished work
   * stays at the bottom, and the ordinary open tasks are the ones you can order freely. Any
   * other day is a plain list and accepts the drop as it comes.
   */
  private placementIndex(target: Task[], moving: Task, requested: number, dateKey: DateKey): number {
    const wanted = Math.max(0, Math.round(Number.isFinite(requested) ? requested : 0))
    if (dateKey !== this.data.todayKey) return Math.min(wanted, target.length)
    const { start, end } = bandInsertRange(target, taskBand(moving))
    return Math.min(Math.max(wanted, start), end)
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

  updateWindowBounds(
    kind: 'mainWindow' | 'historyWindow' | 'calendarWindow',
    bounds: Settings['mainWindow']
  ): void {
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
    if (this.desktopLayer === layer) return
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
