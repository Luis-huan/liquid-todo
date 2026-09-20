import { addDays, fromDateKey, toDateKey } from './date'
import type { DateKey } from './types'

/** How far ahead the calendar lets you pick a day. */
export const CALENDAR_MAX_MONTHS = 12

export type PickBlock = 'past' | 'tomorrow' | 'taken' | null

/**
 * Why a day cannot be picked: it is not in the future, it is the pinned Tomorrow row, or it is
 * already on the list. `null` means the day can be added.
 */
export function pickBlock(dateKey: DateKey, todayKey: DateKey, added: DateKey[]): PickBlock {
  if (dateKey <= todayKey) return 'past'
  if (dateKey === addDays(todayKey, 1)) return 'tomorrow'
  if (added.includes(dateKey)) return 'taken'
  return null
}

export interface MonthRef {
  year: number
  month: number
}

export function monthOf(dateKey: DateKey): MonthRef {
  const date = fromDateKey(dateKey)
  return { year: date.getFullYear(), month: date.getMonth() }
}

export function shiftMonth(ref: MonthRef, delta: number): MonthRef {
  const date = new Date(ref.year, ref.month + delta, 1, 12, 0, 0, 0)
  return { year: date.getFullYear(), month: date.getMonth() }
}

/** Months are numbered from the month today is in, so the calendar cannot wander past the cap. */
export function monthOffset(ref: MonthRef, todayKey: DateKey): number {
  const today = monthOf(todayKey)
  return (ref.year - today.year) * 12 + (ref.month - today.month)
}

export function canShowMonth(ref: MonthRef, todayKey: DateKey): boolean {
  const offset = monthOffset(ref, todayKey)
  return offset >= 0 && offset <= CALENDAR_MAX_MONTHS
}

export interface MonthCell {
  dateKey: DateKey
  day: number
  inMonth: boolean
}

/** Six Monday-first weeks, padded with the neighbouring months so the grid never jumps. */
export function buildMonthGrid(ref: MonthRef): MonthCell[][] {
  const first = new Date(ref.year, ref.month, 1, 12, 0, 0, 0)
  const start = new Date(first)
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7))

  const weeks: MonthCell[][] = []
  for (let week = 0; week < 6; week += 1) {
    const cells: MonthCell[] = []
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(start)
      date.setDate(start.getDate() + week * 7 + day)
      cells.push({ dateKey: toDateKey(date), day: date.getDate(), inMonth: date.getMonth() === ref.month })
    }
    weeks.push(cells)
  }
  return weeks
}

export function formatMonthTitle(ref: MonthRef): string {
  return new Date(ref.year, ref.month, 1, 12, 0, 0, 0).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric'
  })
}

export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
