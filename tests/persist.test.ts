import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadStoreFile, writeStoreFile } from '../src/main/persist'
import { createEmptyStore } from '../src/shared/rollover'

const folders: string[] = []

function scratch(): string {
  const folder = mkdtempSync(join(tmpdir(), 'liquid-todo-'))
  folders.push(folder)
  return join(folder, 'data.json')
}

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

describe('store persistence', () => {
  it('round trips a store and leaves no temp file behind', () => {
    const file = scratch()
    const store = createEmptyStore('2026-09-10')
    store.days['2026-09-10'] = [
      { id: 'a', text: 'write tests', createdAt: '2026-09-10T02:00:00.000Z', completedAt: null, order: 0 }
    ]

    writeStoreFile(file, store)
    const reopened = loadStoreFile(file, '2026-09-10')

    expect(reopened.corrupt).toBe(false)
    expect(reopened.store.days['2026-09-10'][0].text).toBe('write tests')
    expect(readdirSync(join(file, '..')).filter((name) => name.endsWith('.tmp'))).toHaveLength(0)
  })

  it('starts fresh and quarantines a corrupt file', () => {
    const file = scratch()
    writeFileSync(file, '{ this is not json', 'utf8')

    const result = loadStoreFile(file, '2026-09-10')

    expect(result.corrupt).toBe(true)
    expect(result.store.days).toEqual({})
    expect(result.store.todayKey).toBe('2026-09-10')
    expect(result.quarantined).toBeTruthy()
    expect(readFileSync(result.quarantined as string, 'utf8')).toBe('{ this is not json')
  })

  it('returns a fresh store when no file exists yet', () => {
    const file = scratch()
    const result = loadStoreFile(file, '2026-09-10')
    expect(result.corrupt).toBe(false)
    expect(result.repaired).toBe(false)
    expect(result.store.version).toBe(3)
  })
})
