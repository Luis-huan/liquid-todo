import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/** Resolves a bundled file both in dev (repo/resources) and in the packaged app (resources/). */
export function resourcePath(name: string): string {
  const packaged = join(process.resourcesPath, name)
  if (existsSync(packaged)) return packaged
  return join(app.getAppPath(), 'resources', name)
}

export function userDataPath(...parts: string[]): string {
  return join(app.getPath('userData'), ...parts)
}
