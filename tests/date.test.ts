import { describe, expect, it } from 'vitest'
import { addDays, compareDateKeys, formatFullDate, fromDateKey, isValidDateKey, toDateKey } from '../src/shared/date'

describe('date helpers', () => {
  it('uses the local calendar day, not UTC', () => {
    const lateEvening = new Date(2026, 8, 10, 23, 30, 0)
    expect(toDateKey(lateEvening)).toBe('2026-09-10')
    const earlyMorning = new Date(2026, 8, 11, 0, 30, 0)
    expect(toDateKey(earlyMorning)).toBe('2026-09-11')
  })

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-09-10', 6)).toBe('2026-09-16')
  })

  it('round trips a date key through local noon', () => {
    const key = '2026-09-10'
    expect(toDateKey(fromDateKey(key))).toBe(key)
  })

  it('validates keys', () => {
    expect(isValidDateKey('2026-09-10')).toBe(true)
    expect(isValidDateKey('2026-9-10')).toBe(false)
    expect(isValidDateKey('2026-02-31')).toBe(false)
    expect(isValidDateKey('nope')).toBe(false)
    expect(isValidDateKey(42)).toBe(false)
  })

  it('formats labels for the column headers', () => {
    expect(formatFullDate('2026-09-09')).toBe('Wed, Sep 9')
  })

  it('compares keys lexicographically by calendar order', () => {
    expect(compareDateKeys('2026-09-09', '2026-09-10')).toBe(-1)
    expect(compareDateKeys('2026-09-10', '2026-09-10')).toBe(0)
    expect(compareDateKeys('2026-10-01', '2026-09-30')).toBe(1)
  })
})
