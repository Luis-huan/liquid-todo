import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/** Where the board keeps its data. Everything else (caches, backups) lands there too. */
export const DATA_DIR = 'D:\\缓存数据\\To do list'

export interface DataDirResult {
  path: string
  /** False when the configured folder could not be used and the default was kept. */
  relocated: boolean
  detail: string
}

function isWritable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    const probe = join(dir, '.write-probe')
    writeFileSync(probe, 'ok', 'utf8')
    rmSync(probe, { force: true })
    return true
  } catch {
    return false
  }
}

/** Copies a file without ever overwriting a newer one. */
function copyIfMissing(from: string, to: string): boolean {
  if (!existsSync(from)) return false
  try {
    copyFileSync(from, to)
    return true
  } catch {
    return false
  }
}

/** Moves one entry of the old profile into the new one, preferring a plain move. */
function moveEntry(from: string, to: string): void {
  if (!existsSync(from)) return
  try {
    renameSync(from, to)
  } catch {
    try {
      copyFileSync(from, to)
      rmSync(from, { force: true })
    } catch {
      /* leave the old file alone rather than risk losing it */
    }
  }
}

/**
 * Points the whole Electron profile at the configured folder and, on the first run afterwards,
 * brings the board data across from the old `%APPDATA%` profile and removes what is left of it.
 *
 * A dev run that was started with `--user-data-dir` keeps its own profile: that switch exists to
 * keep experiments away from the real board.
 */
export function useConfiguredDataDir(): DataDirResult {
  const override = process.argv.some((arg) => arg.startsWith('--user-data-dir'))
  const fallback = app.getPath('userData')
  if (override) {
    return { path: fallback, relocated: false, detail: 'user-data-dir override' }
  }
  if (!isWritable(DATA_DIR)) {
    return { path: fallback, relocated: false, detail: `${DATA_DIR} is not writable` }
  }

  const previous = fallback
  app.setPath('userData', DATA_DIR)
  migrateProfile(previous, DATA_DIR)
  clearUpdaterCache()
  return { path: DATA_DIR, relocated: true, detail: 'relocated' }
}

/** Brings the board file over, then clears the old profile out of the way. */
function migrateProfile(previous: string, next: string): void {
  if (!previous || previous === next || !existsSync(previous)) return

  const oldStore = join(previous, 'data.json')
  const newStore = join(next, 'data.json')
  if (existsSync(oldStore) && !existsSync(newStore)) {
    if (!copyIfMissing(oldStore, newStore)) return // keep the old profile intact on failure
  }

  // The store is safe now: hand over anything else worth keeping, then drop the old profile.
  for (const entry of ['data.json', 'settings.json']) {
    moveEntry(join(previous, entry), join(next, entry))
  }
  try {
    rmSync(previous, { recursive: true, force: true })
  } catch {
    /* a locked file would only mean the old folder lingers; the board already runs from the new one */
  }
}

/** electron-updater keeps a cache next to the profile; it belongs to the old location. */
function clearUpdaterCache(): void {
  const cache = join(app.getPath('appData'), '..', 'Local', 'liquid-todo-updater')
  if (!existsSync(cache)) return
  try {
    rmSync(cache, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

export function dataDirEntries(): string[] {
  try {
    return readdirSync(DATA_DIR)
  } catch {
    return []
  }
}
