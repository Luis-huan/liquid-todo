import { app, Menu, nativeImage, Tray } from 'electron'
import { resourcePath } from './paths'
import type { TodoState } from './state'
import type { ThemeMode } from '../shared/types'

export interface TrayActions {
  toggleVisibility: () => void
  isVisible: () => boolean
  openHistory: () => void
  refreshBackdrop: () => void
  setDesktopLayer: (mode: 'workerw' | 'bottom') => void
  setAlwaysOnTop: (value: boolean) => void
  isAlwaysOnTop: () => boolean
  setTheme: (theme: ThemeMode) => void
}

let tray: Tray | null = null

function icon(): Electron.NativeImage {
  const image = nativeImage.createFromPath(resourcePath('tray.png'))
  return image.isEmpty() ? nativeImage.createEmpty() : image
}

export function createTray(state: TodoState, actions: TrayActions): Tray {
  tray = new Tray(icon())
  tray.setToolTip('Liquid Todo')
  tray.on('click', () => actions.toggleVisibility())

  let signature = ''
  const render = (): void => {
    const next = [
      actions.isVisible(),
      state.settings.desktopLayer,
      actions.isAlwaysOnTop(),
      state.settings.startAtLogin,
      state.settings.theme
    ].join('|')
    if (next === signature) return
    signature = next
    const menu = Menu.buildFromTemplate([
      {
        label: actions.isVisible() ? 'Hide widget' : 'Show widget',
        click: () => {
          actions.toggleVisibility()
          render()
        }
      },
      { label: 'Open history', click: () => actions.openHistory() },
      { type: 'separator' },
      { label: 'Refresh backdrop', click: () => actions.refreshBackdrop() },
      {
        label: 'Pin to desktop layer',
        type: 'checkbox',
        checked: state.settings.desktopLayer !== 'bottom',
        click: (item) => actions.setDesktopLayer(item.checked ? 'workerw' : 'bottom')
      },
      {
        label: 'Keep on top of windows',
        type: 'checkbox',
        checked: actions.isAlwaysOnTop(),
        click: (item) => actions.setAlwaysOnTop(item.checked)
      },
      {
        label: 'Glass look',
        submenu: (['system', 'light', 'dark'] as ThemeMode[]).map((theme) => ({
          label: theme === 'system' ? 'Follow Windows' : theme === 'light' ? 'Light glass' : 'Dark glass',
          type: 'radio' as const,
          checked: state.settings.theme === theme,
          click: () => {
            actions.setTheme(theme)
            render()
          }
        }))
      },
      { type: 'separator' },
      {
        label: 'Start with Windows',
        type: 'checkbox',
        checked: state.settings.startAtLogin,
        click: (item) => {
          state.patchSettings({ startAtLogin: item.checked })
          if (app.isPackaged) {
            app.setLoginItemSettings({
              openAtLogin: item.checked,
              path: process.execPath,
              name: 'Liquid Todo'
            })
          }
          render()
        }
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
    tray?.setContextMenu(menu)
  }

  render()
  const timer = setInterval(() => {
    if (!tray || tray.isDestroyed()) {
      clearInterval(timer)
      return
    }
    render()
  }, 1500)
  return tray
}
