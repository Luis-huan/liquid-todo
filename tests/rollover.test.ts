import { describe, expect, it } from 'vitest'
import {
  advanceDays,
  bandInsertRange,
  clampTaskText,
  createEmptyStore,
  insertOpenTask,
  normalizeFutureDates,
  normalizeStore,
  normalizeTaskOrder,
  sortTaskBands,
  taskBand
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

    // the day that just ended keeps its record: what never got done moves to the top and is
    // flagged as moved, the finished work settles underneath
    const ended = result.days['2026-09-10']
    expect(ended.map((entry) => entry.id)).toEqual(['t2', 't1'])
    expect(ended[0].movedToToday).toBe(true)
    expect(ended[1].movedToToday).toBeUndefined()
    expect(ended.map((entry) => entry.order)).toEqual([0, 1])

    // unfinished work sits on top of tomorrow's plan, with a fresh id
    const today = result.days['2026-09-11']
    expect(today.map((entry) => entry.text)).toEqual(['today open', 'planned tomorrow', 'planned done'])
    expect(today[0].carriedFrom).toBe('2026-09-10')
    expect(today[0].id).not.toBe('t2')
    expect(today[0].movedToToday).toBeUndefined()
    expect(today.map((entry) => entry.order)).toEqual([0, 1, 2])
  })

  it('keeps carried work above the plan even when the plan already had an order', () => {
    const days: Record<string, Task[]> = {
      '2026-09-10': [task('t1', 'today open', false, 0)],
      '2026-09-11': [
        task('n1', 'planned first', false, 0),
        task('n2', 'planned second', false, 1),
        task('n3', 'planned third', false, 2)
      ]
    }

    const result = advanceDays('2026-09-10', days, '2026-09-11')
    const today = result.days['2026-09-11']

    expect(today.map((entry) => entry.text)).toEqual([
      'today open',
      'planned first',
      'planned second',
      'planned third'
    ])
    expect(today.map((entry) => entry.order)).toEqual([0, 1, 2, 3])
    expect(today[0].carriedFrom).toBe('2026-09-10')
  })

  it('stacks several carried tasks in their original order above the plan', () => {
    const days: Record<string, Task[]> = {
      '2026-09-10': [
        task('a', 'first open', false, 0),
        task('b', 'done', true, 1),
        task('c', 'second open', false, 2)
      ],
      '2026-09-11': [task('p', 'plan', false, 0)]
    }

    const result = advanceDays('2026-09-10', days, '2026-09-11')

    expect(result.days['2026-09-10'].map((entry) => entry.id)).toEqual(['a', 'c', 'b'])
    expect(result.days['2026-09-11'].map((entry) => entry.text)).toEqual([
      'first open',
      'second open',
      'plan'
    ])
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

  it('promotes a picked day into Tomorrow and merges it with the day that became today', () => {
    const days: Record<string, Task[]> = {
      '2026-09-18': [task('a', 'slipped today', false, 0)],
      '2026-09-19': [task('p', 'planned for tomorrow', false, 0)],
      '2026-09-20': [task('x', 'picked day', false, 0)]
    }

    // One midnight: 9/18 becomes yesterday, 9/19 becomes today, 9/20 stays picked.
    const first = advanceDays('2026-09-18', days, '2026-09-19', ['2026-09-20', '2026-09-25'])
    expect(first.todayKey).toBe('2026-09-19')
    expect(first.days['2026-09-19'].map((entry) => entry.text)).toEqual([
      'slipped today',
      'planned for tomorrow'
    ])
    expect(first.futureDates).toEqual(['2026-09-20', '2026-09-25'])

    // A second midnight: the picked day is today, and yesterday's leftovers stay above its plan.
    const second = advanceDays('2026-09-19', first.days, '2026-09-20', first.futureDates)
    expect(second.days['2026-09-20'].map((entry) => entry.text)).toEqual([
      'slipped today',
      'planned for tomorrow',
      'picked day'
    ])
    expect(second.futureDates).toEqual(['2026-09-25'])
  })

  it('drops picked days that the rollover has consumed', () => {
    const days: Record<string, Task[]> = { '2026-09-18': [task('a', 'open', false, 0)] }
    const result = advanceDays('2026-09-18', days, '2026-09-22', ['2026-09-19', '2026-09-21', '2026-09-24'])

    expect(result.todayKey).toBe('2026-09-22')
    expect(result.futureDates).toEqual(['2026-09-24'])
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

  it('sinks finished work without disturbing the open tasks', () => {
    const tasks: Task[] = [
      task('a', 'open one', false, 0),
      task('b', 'open two', false, 1),
      task('c', 'just finished', true, 2)
    ]

    expect(sortTaskBands(tasks).map((entry) => [entry.id, entry.order])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2]
    ])

    const mixed: Task[] = [
      task('done', 'was done first', true, 0),
      task('open', 'still open', false, 1),
      task('fresh', 'just ticked', true, 2)
    ]
    expect(sortTaskBands(mixed).map((entry) => entry.id)).toEqual(['open', 'done', 'fresh'])
  })

  it('keeps carried over work on top, and puts it back there when it is unticked', () => {
    const carried = { ...task('carried', 'from yesterday', false, 0), carriedFrom: '2026-09-14' }
    const open = task('open', 'added today', false, 1)
    const done = task('done', 'finished today', true, 2)

    expect([carried, open, done].map(taskBand)).toEqual([0, 1, 2])

    // Ticking the carried task off sends it to the bottom of the column ...
    const ticked = sortTaskBands([{ ...carried, completedAt: '2026-09-15T10:00:00.000Z' }, open, done])
    // both finished tasks share the last band, so they keep their relative order
    expect(ticked.map((entry) => entry.id)).toEqual(['open', 'carried', 'done'])

    // ... and unticking it must bring it back to the top of the open work, not below it.
    const unticked = sortTaskBands([open, done, { ...carried, completedAt: null }])
    expect(unticked.map((entry) => entry.id)).toEqual(['carried', 'open', 'done'])
  })

  it('restricts a task to its own band and leaves the other days alone', () => {
    const ordered: Task[] = [
      { ...task('carried', 'carried', false, 0), carriedFrom: '2026-09-14' },
      task('open-a', 'open a', false, 1),
      task('open-b', 'open b', false, 2),
      task('done', 'done', true, 3)
    ]

    expect(sortTaskBands(ordered).map((entry) => entry.id)).toEqual([
      'carried',
      'open-a',
      'open-b',
      'done'
    ])
    // An ordinary open task may only land between the carried block and the finished one.
    expect(bandInsertRange(ordered, 1)).toEqual({ start: 1, end: 3 })
    expect(bandInsertRange(ordered, 0)).toEqual({ start: 0, end: 1 })
    expect(bandInsertRange(ordered, 2)).toEqual({ start: 3, end: 4 })
  })

  it('adds a new task to the end of the open group, above the finished ones', () => {
    const tasks: Task[] = [
      task('a', 'open one', false, 0),
      task('b', 'finished', true, 1),
      task('c', 'open two', false, 2)
    ]
    const added = task('new', 'just added', false, 99)

    // The new row lands directly above the first finished task.
    expect(insertOpenTask(tasks, added).map((entry) => entry.id)).toEqual(['a', 'new', 'b', 'c'])
    expect(insertOpenTask(tasks, added).map((entry) => entry.order)).toEqual([0, 1, 2, 3])

    // Nothing finished: a new task is simply appended.
    const open: Task[] = [task('x', 'only open', false, 0)]
    expect(insertOpenTask(open, added).map((entry) => entry.id)).toEqual(['x', 'new'])

    // Everything finished: the new task still lands on top of the finished block.
    const allDone: Task[] = [task('d', 'done', true, 0)]
    expect(insertOpenTask(allDone, added).map((entry) => entry.id)).toEqual(['new', 'd'])

    // Carried over work stays above the new task, which stays above the finished work.
    const withCarried: Task[] = [
      { ...task('c', 'from yesterday', false, 0), carriedFrom: '2026-09-14' },
      task('o', 'open', false, 1),
      task('d', 'done', true, 2)
    ]
    expect(insertOpenTask(withCarried, added).map((entry) => entry.id)).toEqual(['c', 'o', 'new', 'd'])
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
    expect(store.version).toBe(4)
    expect(store.days).toEqual({})
    expect(store.futureDates).toEqual([])
    expect(store.settings.theme).toBe('system')
    expect(store.settings.mainWindow.width).toBe(760)
  })

  it('sorts, dedupes and drops past picked days', () => {
    expect(
      normalizeFutureDates(['2026-09-25', '2026-09-20', '2026-09-20', '2026-09-10', 'nope'], '2026-09-18')
    ).toEqual(['2026-09-20', '2026-09-25'])
    expect(normalizeFutureDates(undefined, '2026-09-18')).toEqual([])
  })

  it('reads picked days from an older store and repairs what it cannot use', () => {
    const legacy = normalizeStore(
      {
        version: 3,
        todayKey: '2026-09-18',
        days: { '2026-09-18': [task('a', 'open', false, 0)] },
        settings: { theme: 'dark', desktopLayer: 'auto', startAtLogin: true }
      },
      '2026-09-18'
    )
    expect(legacy.store.futureDates).toEqual([])
    expect(legacy.store.version).toBe(4)
    expect(legacy.store.settings.calendarWindow.width).toBe(300)

    const withPicks = normalizeStore(
      {
        version: 4,
        todayKey: '2026-09-18',
        days: {},
        futureDates: ['2026-09-21', 'junk', '2026-09-19'],
        settings: {}
      },
      '2026-09-18'
    )
    expect(withPicks.store.futureDates).toEqual(['2026-09-19', '2026-09-21'])
  })
})
