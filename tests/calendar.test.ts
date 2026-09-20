import { describe, expect, it } from 'vitest'
import {
  CALENDAR_MAX_MONTHS,
  buildMonthGrid,
  canShowMonth,
  formatMonthTitle,
  monthOf,
  pickBlock,
  shiftMonth
} from '../src/shared/calendar'

describe('calendar picking rules', () => {
  const today = '2026-09-18'
  const added = ['2026-09-20', '2026-09-23']

  it('blocks today, the past, the Tomorrow row and days already on the list', () => {
    expect(pickBlock('2026-09-17', today, added)).toBe('past')
    expect(pickBlock('2026-09-18', today, added)).toBe('past')
    expect(pickBlock('2026-09-19', today, added)).toBe('tomorrow')
    expect(pickBlock('2026-09-20', today, added)).toBe('taken')
    expect(pickBlock('2026-09-21', today, added)).toBe(null)
    expect(pickBlock('2026-09-23', today, added)).toBe('taken')
  })

  it('walks months across year boundaries and caps the range', () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 })
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 })
    expect(monthOf(today)).toEqual({ year: 2026, month: 8 })

    expect(canShowMonth(monthOf(today), today)).toBe(true)
    expect(canShowMonth(shiftMonth(monthOf(today), -1), today)).toBe(false)
    expect(canShowMonth(shiftMonth(monthOf(today), CALENDAR_MAX_MONTHS), today)).toBe(true)
    expect(canShowMonth(shiftMonth(monthOf(today), CALENDAR_MAX_MONTHS + 1), today)).toBe(false)
  })
})

describe('calendar month grid', () => {
  it('lays September 2026 out as six Monday-first weeks', () => {
    const grid = buildMonthGrid({ year: 2026, month: 8 })

    expect(grid).toHaveLength(6)
    expect(grid.every((week) => week.length === 7)).toBe(true)
    // 1 September 2026 is a Tuesday, so the first cell is the Monday of the week before.
    expect(grid[0][0].dateKey).toBe('2026-08-31')
    expect(grid[0][0].inMonth).toBe(false)
    expect(grid[0][1].dateKey).toBe('2026-09-01')
    expect(grid[0][1].inMonth).toBe(true)

    const inMonth = grid.flat().filter((cell) => cell.inMonth)
    expect(inMonth).toHaveLength(30)
    expect(inMonth[0].dateKey).toBe('2026-09-01')
    expect(inMonth.at(-1)?.dateKey).toBe('2026-09-30')
  })

  it('titles the month for the header', () => {
    expect(formatMonthTitle({ year: 2026, month: 8 })).toBe('September 2026')
  })
})
