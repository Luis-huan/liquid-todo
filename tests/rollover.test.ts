import { describe, expect, it } from 'vitest'
import {
  advanceDays,
  clampTaskText,
  createEmptyStore,
  normalizeStore,
  normalizeTaskOrder
} from '../src/shared/rollover'
import type { Task } from '../src/shared/types'

function task(id: string, text: string, done: boolean, order: number): Task {
  return {
    id,
    text,
    createdAt: '2026-09-09T09:00:00.000Z',
    completedAt: done ? '2026-09-09T10:00:00.000Z' : null,
    order
  }
}

describe('midnight rollover', () => {
  it('promotes tomorrow, carries unfinished work and freezes yesterday', () => {
    const days: Record<string, Task[]> = {
      '2026-09-09': [task('y1', 'yesterday done', true, 0), task('y2', 'yesterday open', false, 1)],
      '2026-09-10': [task('t1', 'today done', true, 0), task('t2', 'today open', false, 1)],
      '2026-09-11': [task('n1', 'planned tomorrow', false, 0), task('n2', 'planned done', true, 1)]
    }

    const result = advanceDays('2026-09-10', days, '2026-09-11')

    expect(result.todayKey).toBe('2026-09-11')
    expect(result.advancedDays).toBe(1)

    // yesterday stays untouched as history
    expect(result.days['2026-09-09'].map((entry) => entry.id)).toEqual(['y1', 'y2'])

    // the day that just ended keeps its record, unfinished entries flagged as moved
    const ended = result.days['2026-09-10']
    expect(ended.map((entry) => entry.id)).toEqual(['t1', 't2'])
    expect(ended[0].movedToToday).toBeUndefined()
    expect(ended[1].movedToToday).toBe(true)

    // unfinished work sits on top of tomorrow's plan, with a fresh id
    const today = result.days['2026-09-11']
    expect(today.map((entry) => entry.text)).toEqual(['today open', 'planned tomorrow', 'planned done'])
    expect(today[0].carriedFrom).toBe('2026-09-10')
    expect(today[0].id).not.toBe('t2')
    expect(today[0].movedToToday).toBeUndefined()
    expect(today.map((entry) => entry.order)).toEqual([0, 1, 2])
  })

  it('keeps the original origin when a task rolls over several days', () => {
    const days: Record<string, Task[]> = {
      '2026-09-08': [task('a', 'stubborn task', false, 0)]
    }

    const result = advanceDays('2026-09-08', days, '2026-09-11')

    expect(result.advancedDays).toBe(3)
    expect(result.days['2026-09-08'][0].movedToToday).toBe(true)
    const carried = result.days['2026-09-11']
    expect(carried).toHaveLength(1)
    expect(carried[0].text).toBe('stubborn task')
    expect(carried[0].carriedFrom).toBe('2026-09-08')
  })

  it('does not duplicate a task that is completed mid-way', () => {
    const days: Record<string, Task[]> = {
      '2026-09-09': [task('a', 'finish me', true, 0)]
    }
    const result = advanceDays('2026-09-09', days, '2026-09-10')
    expect(result.days['2026-09-09'][0].movedToToday).toBeUndefined()
    expect(result.days['2026-09-10'] ?? []).toHaveLength(0)
  })

  it('purges anything older than seven calendar days but keeps tomorrow', () => {
    const days: Record<string, Task[]> = {
      '2026-09-03': [task('old', 'day seven back', false, 0)],
      '2026-09-04': [task('edge', 'day six back, kept', false, 0)],
      '2026-09-13': [task('future', 'planned ahead of turn', false, 0)]
    }

    const result = advanceDays('2026-09-10', days, '2026-09-10')

    expect(result.purged).toEqual(['2026-09-03'])
    expect(result.days['2026-09-04']).toBeDefined()
    expect(result.days['2026-09-09']).toBeUndefined()
    expect(result.days['2026-09-13']).toBeDefined()
  })

  it('does nothing when the clock has not crossed midnight', () => {
    const days = { '2026-09-10': [task('a', 'same day', false, 0)] }
    const result = advanceDays('2026-09-10', days, '2026-09-10')
    expect(result.advancedDays).toBe(0)
    expect(result.days['2026-09-10'][0].movedToToday).toBeUndefined()
  })
})

describe('task helpers', () => {
  it('collapses whitespace and caps length', () => {
    expect(clampTaskText('  buy   milk  ')).toBe('buy milk')
    expect(clampTaskText('x'.repeat(400))).toHaveLength(200)
  })

  it('normalises order values', () => {
    const messy: Task[] = [task('b', 'second', false, 7), task('a', 'first', false, 2)]
    expect(normalizeTaskOrder(messy).map((entry) => [entry.id, entry.order])).toEqual([
      ['a', 0],
      ['b', 1]
    ])
  })
})

describe('store normalisation', () => {
  it('flags unreadable payloads as corrupt', () => {
    expect(normalizeStore(null, '2026-09-10').corrupt).toBe(true)
    expect(normalizeStore({ days: 'nope' }, '2026-09-10').corrupt).toBe(true)
    expect(normalizeStore({ days: {} }, '2026-09-10').store.todayKey).toBe('2026-09-10')
  })

  it('repairs individual bad entries without losing good ones', () => {
    const result = normalizeStore(
      {
        version: 1,
        todayKey: '2026-09-10',
        days: {
          '2026-09-10': [
            { id: 'keep', text: 'good task', createdAt: '2026-09-10T01:00:00.000Z', completedAt: null, order: 0 },
            { id: 'drop', text: '   ' },
            'nonsense'
          ],
          'not-a-date': []
        }
      },
      '2026-09-10'
    )

    expect(result.corrupt).toBe(false)
    expect(result.repaired).toBe(true)
    expect(Object.keys(result.store.days)).toEqual(['2026-09-10'])
    expect(result.store.days['2026-09-10'].map((entry) => entry.id)).toEqual(['keep'])
  })

  it('creates a complete default store', () => {
    const store = createEmptyStore('2026-09-10')
    expect(store.version).toBe(3)
    expect(store.settings.backdrop).toBe('wallpaper')
    expect(store.days).toEqual({})
    expect(store.settings.theme).toBe('system')
    expect(store.settings.mainWindow.width).toBe(760)
  })
})
