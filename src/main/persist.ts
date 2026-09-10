import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createEmptyStore, normalizeStore } from '../shared/rollover'
import type { DateKey, StoreData } from '../shared/types'

export interface LoadResult {
  store: StoreData
  corrupt: boolean
  repaired: boolean
  quarantined: string | null
}

/** Reads the store, quarantining unreadable files instead of losing them. */
export function loadStoreFile(file: string, todayKey: DateKey): LoadResult {
  if (!existsSync(file)) {
    return { store: createEmptyStore(todayKey), corrupt: false, repaired: false, quarantined: null }
  }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { store: createEmptyStore(todayKey), corrupt: true, repaired: true, quarantined: quarantine(file) }
  }

  const normalized = normalizeStore(raw, todayKey)
  if (normalized.corrupt) {
    return { store: normalized.store, corrupt: true, repaired: true, quarantined: quarantine(file) }
  }
  return { store: normalized.store, corrupt: false, repaired: normalized.repaired, quarantined: null }
}

/** Writes through a temporary file so a crash can never leave a half-written store. */
export function writeStoreFile(file: string, data: StoreData): void {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8')
  try {
    renameSync(temp, file)
  } catch {
    // Some redirected profile folders live on another volume than their temp file,
    // so fall back to a copy instead of an atomic rename.
    copyFileSync(temp, file)
    try {
      unlinkSync(temp)
    } catch {
      /* the next write overwrites it anyway */
    }
  }
}

function quarantine(file: string): string | null {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = `${dirname(file)}/data.corrupt-${stamp}.json`
  try {
    copyFileSync(file, target)
    return target
  } catch {
    return null
  }
}
