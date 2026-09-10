import type { BrowserWindow } from 'electron'

export type WindowRole = 'main' | 'history'

const roles = new WeakMap<BrowserWindow, WindowRole>()

export function setWindowRole(win: BrowserWindow, role: WindowRole): void {
  roles.set(win, role)
}

export function windowRole(win: BrowserWindow | null | undefined): WindowRole | null {
  if (!win) return null
  return roles.get(win) ?? null
}
