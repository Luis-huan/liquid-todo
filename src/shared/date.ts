import type { DateKey } from './types'

export const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isValidDateKey(value: unknown): value is DateKey {
  if (typeof value !== 'string' || !DATE_KEY_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const probe = new Date(year, month - 1, day, 12, 0, 0, 0)
  return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day
}

/** Local-time calendar key. Never derived from ISO/UTC strings. */
export function toDateKey(date: Date): DateKey {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function fromDateKey(key: DateKey): Date {
  const [year, month, day] = key.split('-').map(Number)
  // Noon anchor keeps day arithmetic safe across daylight-saving boundaries.
  return new Date(year, month - 1, day, 12, 0, 0, 0)
}

export function addDays(key: DateKey, delta: number): DateKey {
  const date = fromDateKey(key)
  date.setDate(date.getDate() + delta)
  return toDateKey(date)
}

export function compareDateKeys(a: DateKey, b: DateKey): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

export function daysBetween(from: DateKey, to: DateKey): number {
  const ms = fromDateKey(to).getTime() - fromDateKey(from).getTime()
  return Math.round(ms / 86_400_000)
}

export function formatWeekday(key: DateKey): string {
  return fromDateKey(key).toLocaleDateString('en-US', { weekday: 'short' })
}

export function formatMonthDay(key: DateKey): string {
  return fromDateKey(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatFullDate(key: DateKey): string {
  return `${formatWeekday(key)}, ${formatMonthDay(key)}`
}
