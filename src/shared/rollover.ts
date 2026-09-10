import { addDays, isValidDateKey, toDateKey } from './date'
import { newId } from './ids'
import type { DateKey, Settings, StoreData, Task } from './types'

export const STORE_VERSION = 3
/** today plus the six preceding days. */
export const RETENTION_DAYS = 7
export const MAX_TASK_LENGTH = 200

export function clampTaskText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_TASK_LENGTH)
}

export function normalizeTaskOrder(tasks: Task[]): Task[] {
  return tasks
    .slice()
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
    .map((task, index) => (task.order === index ? task : { ...task, order: index }))
}

export function findTask(days: Record<DateKey, Task[]>, id: string): { dateKey: DateKey; task: Task } | null {
  for (const [dateKey, tasks] of Object.entries(days)) {
    const task = tasks.find((candidate) => candidate.id === id)
    if (task) return { dateKey, task }
  }
  return null
}

export interface AdvanceResult {
  days: Record<DateKey, Task[]>
  todayKey: DateKey
  advancedDays: number
  purged: DateKey[]
}

/**
 * Rolls the board forward day by day until `currentKey` becomes today.
 * - next day's plan (completed or not) becomes the new today
 * - unfinished tasks from the ending day are copied to the new today, on top
 * - the ending day keeps its original tasks, unfinished ones flagged `movedToToday`
 * - days older than the retention window are dropped (future buckets are kept)
 */
export function advanceDays(
  startingToday: DateKey,
  sourceDays: Record<DateKey, Task[]>,
  currentKey: DateKey
): AdvanceResult {
  const days: Record<DateKey, Task[]> = {}
  for (const [key, tasks] of Object.entries(sourceDays)) {
    days[key] = tasks.map((task) => ({ ...task }))
  }

  let todayKey = startingToday
  let advancedDays = 0

  while (todayKey < currentKey) {
    const endingKey = todayKey
    const nextKey = addDays(endingKey, 1)
    const endingTasks = days[endingKey] ?? []
    const plannedTasks = days[nextKey] ?? []

    days[endingKey] = endingTasks.map((task) =>
      task.completedAt ? task : { ...task, movedToToday: true }
    )

    const carried = endingTasks
      .filter((task) => !task.completedAt)
      .map((task) => ({
        ...task,
        id: newId(),
        completedAt: null,
        movedToToday: undefined,
        carriedFrom: task.carriedFrom ?? endingKey,
        order: 0
      }))

    days[nextKey] = normalizeTaskOrder([...carried, ...plannedTasks])
    todayKey = nextKey
    advancedDays += 1
  }

  const purged: DateKey[] = []
  if (todayKey <= currentKey) {
    const cutoff = addDays(currentKey, -(RETENTION_DAYS - 1))
    for (const key of Object.keys(days)) {
      if (key < cutoff) {
        delete days[key]
        purged.push(key)
      }
    }
  }

  return { days, todayKey, advancedDays, purged }
}

export interface NormalizedStore {
  store: StoreData
  repaired: boolean
  corrupt: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readTask(raw: unknown, index: number): Task | null {
  if (!isRecord(raw)) return null
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  if (!text) return null
  const createdAt = typeof raw.createdAt === 'string' && !Number.isNaN(Date.parse(raw.createdAt))
    ? raw.createdAt
    : new Date().toISOString()
  const completedAt = typeof raw.completedAt === 'string' && !Number.isNaN(Date.parse(raw.completedAt))
    ? raw.completedAt
    : null
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    text: text.slice(0, MAX_TASK_LENGTH),
    createdAt,
    completedAt,
    order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : index,
    ...(isValidDateKey(raw.carriedFrom) ? { carriedFrom: raw.carriedFrom } : {}),
    ...(raw.movedToToday === true ? { movedToToday: true } : {})
  }
}

function readWindow(raw: unknown, fallback: { x: number; y: number; width: number; height: number }) {
  if (!isRecord(raw)) return { ...fallback }
  const num = (value: unknown, alt: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : alt
  return {
    x: num(raw.x, fallback.x),
    y: num(raw.y, fallback.y),
    width: Math.max(320, num(raw.width, fallback.width)),
    height: Math.max(240, num(raw.height, fallback.height))
  }
}

export function defaultSettings(todayKey: DateKey): Settings {
  void todayKey
  return {
    theme: 'system',
    desktopLayer: 'auto',
    startAtLogin: true,
    mainWindow: { x: -1, y: -1, width: 760, height: 350 },
    historyWindow: { x: -1, y: -1, width: 340, height: 560 }
  }
}

export function createEmptyStore(todayKey: DateKey): StoreData {
  return { version: STORE_VERSION, todayKey, days: {}, settings: defaultSettings(todayKey) }
}

/** Coerces unknown JSON into a usable store; reports whether the payload looked corrupt. */
export function normalizeStore(raw: unknown, todayKey: DateKey): NormalizedStore {
  if (!isRecord(raw) || !isRecord(raw.days)) {
    return { store: createEmptyStore(todayKey), repaired: true, corrupt: true }
  }

  let repaired = false
  const storedVersion = typeof raw.version === 'number' ? raw.version : STORE_VERSION
  const days: Record<DateKey, Task[]> = {}
  for (const [key, value] of Object.entries(raw.days)) {
    if (!isValidDateKey(key) || !Array.isArray(value)) {
      repaired = true
      continue
    }
    const tasks: Task[] = []
    value.forEach((entry, index) => {
      const task = readTask(entry, index)
      if (task) tasks.push(task)
      else repaired = true
    })
    days[key] = normalizeTaskOrder(tasks)
  }

  const defaults = defaultSettings(todayKey)
  const rawSettings = isRecord(raw.settings) ? raw.settings : {}
  const settings: Settings = {
    theme:
      rawSettings.theme === 'light' || rawSettings.theme === 'dark' || rawSettings.theme === 'system'
        ? rawSettings.theme
        : defaults.theme,
    desktopLayer:
      rawSettings.desktopLayer === 'workerw' ||
      rawSettings.desktopLayer === 'bottom' ||
      rawSettings.desktopLayer === 'auto'
        ? rawSettings.desktopLayer
        : defaults.desktopLayer,
    startAtLogin: typeof rawSettings.startAtLogin === 'boolean' ? rawSettings.startAtLogin : defaults.startAtLogin,
    mainWindow: storedVersion < 3 ? defaults.mainWindow : readWindow(rawSettings.mainWindow, defaults.mainWindow),
    historyWindow:
      storedVersion < 3 ? defaults.historyWindow : readWindow(rawSettings.historyWindow, defaults.historyWindow)
  }

  const store: StoreData = {
    version: STORE_VERSION,
    todayKey: isValidDateKey(raw.todayKey) ? raw.todayKey : todayKey,
    days,
    settings
  }

  if (typeof raw.version === 'number' && raw.version > STORE_VERSION) repaired = true
  return { store, repaired, corrupt: false }
}

export function resolveCurrentDateKey(now: Date, fakeDate?: string | null): DateKey {
  if (fakeDate && isValidDateKey(fakeDate)) return fakeDate
  return toDateKey(now)
}
