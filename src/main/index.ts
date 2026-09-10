import { writeFileSync } from 'node:fs'
import { app, BrowserWindow, desktopCapturer, nativeTheme, powerMonitor, screen, session } from 'electron'
import type { BackdropMode, DesktopLayerRequest, ResolvedTheme, ThemeMode } from '../shared/types'
import { applyDesktopLayer } from './desktopLayer'
import { registerIpc } from './ipc'
import { TodoState } from './state'
import { createTray } from './tray'
import {
  buildBackdrop,
  refreshWallpaper,
  registerWallpaperProtocol,
  registerWallpaperScheme,
  startWallpaperWatch
} from './wallpaper'
import { createHistoryWindow, createMainWindow } from './windows'

const fakeDate = process.argv.find((arg) => arg.startsWith('--fake-date='))?.split('=')[1] ?? null
const capturePath = process.argv.find((arg) => arg.startsWith('--capture='))?.split('=')[1] ?? null
const backdropArg = process.argv.find((arg) => arg.startsWith('--backdrop='))?.split('=')[1] ?? null
const backdropOverride: BackdropMode | null =
  backdropArg === 'live' || backdropArg === 'wallpaper' ? (backdropArg as BackdropMode) : null
const layerArg = process.argv.find((arg) => arg.startsWith('--layer='))?.split('=')[1] ?? null
const layerOverride: DesktopLayerRequest | null =
  layerArg === 'workerw' || layerArg === 'bottom' || layerArg === 'auto'
    ? (layerArg as DesktopLayerRequest)
    : null
const openHistoryOnStart = process.argv.includes('--open-history')

registerWallpaperScheme()

let state: TodoState | null = null
let mainWindow: BrowserWindow | null = null
let historyWindow: BrowserWindow | null = null
let midnightTimer: NodeJS.Timeout | null = null
let minuteTimer: NodeJS.Timeout | null = null
let wallpaperTimer: NodeJS.Timeout | null = null
let alwaysOnTop = false

function applyContentProtection(): void {
  const live = effectiveBackdrop() === 'live'
  mainWindow?.setContentProtection(live)
  historyWindow?.setContentProtection(live)
}

/**
 * A widget that starts life fully covered by other windows is treated as occluded by Chromium
 * and never presents a frame, so nudge the window size once to force the first paint.
 */
function forceRepaint(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  win.webContents.invalidate()
}

function effectiveBackdrop(): BackdropMode {
  return backdropOverride ?? state?.settings.backdrop ?? 'live'
}

function effectiveLayer(): DesktopLayerRequest {
  return layerOverride ?? state?.settings.desktopLayer ?? 'auto'
}

function resolveTheme(): ResolvedTheme {
  const mode = state?.settings.theme ?? 'system'
  if (mode === 'light') return 'light'
  if (mode === 'dark') return 'dark'
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

function broadcast(): void {
  if (!state) return
  const snapshot = state.snapshot()
  snapshot.backdrop = buildBackdrop(mainWindow)
  snapshot.theme = resolveTheme()
  snapshot.settings = { ...snapshot.settings, backdrop: effectiveBackdrop() }
  const payload = { snapshot, history: state.history() }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('state:changed', payload)
  }
}

function scheduleMidnight(): void {
  if (midnightTimer) clearTimeout(midnightTimer)
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5, 0)
  midnightTimer = setTimeout(() => {
    state?.tick()
    scheduleMidnight()
  }, Math.max(1000, next.getTime() - now.getTime()))
}

async function pinWindow(win: BrowserWindow, requested: DesktopLayerRequest): Promise<void> {
  if (!state) return
  const result = await applyDesktopLayer(win, requested)
  console.log('[liquid-todo] desktop layer:', JSON.stringify(result))
  win.setAlwaysOnTop(alwaysOnTop)
  if (win === mainWindow) {
    state.setDesktopLayer(result.mode)
    if (requested !== 'bottom' && !result.ok) {
      state.setNotice(
        'Windows would not let the widget sit on the wallpaper layer, so it floats as a normal window instead.',
        'warn'
      )
    }
  }
}

function showMainWindow(): void {
  if (!mainWindow) return
  mainWindow.showInactive()
  applyContentProtection()
  forceRepaint(mainWindow)
  // Showing a Chromium window can drop the desktop ownership, so it is re-applied after.
  if (state) void pinWindow(mainWindow, effectiveLayer())
}

function toggleMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isVisible()) mainWindow.hide()
  else {
    mainWindow.showInactive()
    forceRepaint(mainWindow)
    if (state) void pinWindow(mainWindow, effectiveLayer())
  }
  applyContentProtection()
}

function openHistory(): void {
  if (!state) return
  if (!historyWindow || historyWindow.isDestroyed()) {
    historyWindow = createHistoryWindow(state)
    historyWindow.on('closed', () => {
      historyWindow = null
    })
    historyWindow.once('ready-to-show', () => {
      historyWindow?.show()
      applyContentProtection()
      forceRepaint(historyWindow)
    })
    void pinWindow(historyWindow, effectiveLayer())
    return
  }
  historyWindow.show()
}

async function refreshBackdrop(): Promise<void> {
  const changed = await refreshWallpaper(true)
  void changed
  state?.emit()
}

function applyLoginItem(enabled: boolean): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath })
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId('com.luis.liquidtodo')

  state = new TodoState(fakeDate)
  if (fakeDate) state.setNotice(`Debug date override active: ${fakeDate}`, 'info')

  await refreshWallpaper(true)
  registerWallpaperProtocol()

  mainWindow = createMainWindow(state)
  // "Show desktop" minimises every window; the widget belongs to the desktop, so it comes back.
  mainWindow.on('minimize', () => {
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      mainWindow.restore()
      void pinWindow(mainWindow, effectiveLayer())
    }, 40)
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Desktop capture powers the live glass backdrop; the widget itself is excluded from
  // the capture through content protection so the glass never films itself.
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] })
        const target = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
        const display = target ? screen.getDisplayMatching(target.getBounds()) : screen.getPrimaryDisplay()
        const source = sources.find((entry) => entry.display_id === String(display.id)) ?? sources[0]
        if (source) callback({ video: source })
        else callback({})
      } catch {
        callback({})
      }
    },
    { useSystemPicker: false }
  )

  registerIpc({
    state,
    openHistory,
    closeHistory: () => historyWindow?.close(),
    refreshBackdrop,
    applyDesktopLayer: async (requested) => {
      if (mainWindow) await pinWindow(mainWindow, requested)
    },
    applyLoginItem
  })

  createTray(state, {
    toggleVisibility: toggleMainWindow,
    isVisible: () => mainWindow?.isVisible() ?? false,
    openHistory,
    refreshBackdrop: () => {
      void refreshBackdrop()
    },
    setDesktopLayer: (mode) => {
      state?.patchSettings({ desktopLayer: mode })
      if (mainWindow) void pinWindow(mainWindow, mode)
      if (historyWindow) void pinWindow(historyWindow, mode)
    },
    setAlwaysOnTop: (value) => {
      alwaysOnTop = value
      mainWindow?.setAlwaysOnTop(value)
      historyWindow?.setAlwaysOnTop(value)
    },
    isAlwaysOnTop: () => alwaysOnTop,
    setTheme: (theme: ThemeMode) => {
      state?.patchSettings({ theme })
      broadcast()
    },
    setBackdrop: (mode: BackdropMode) => {
      state?.patchSettings({ backdrop: mode })
      applyContentProtection()
    }
  })

  apiState.commit()

  showMainWindow()
  applyContentProtection()
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.setAlwaysOnTop(alwaysOnTop)
    void pinWindow(mainWindow, effectiveLayer())
  }, 2000)

  // Safety net: some shell events (theme change, display change, explorer restart) reset ownership.
  setInterval(() => {
    if (mainWindow) void pinWindow(mainWindow, effectiveLayer())
  }, 300_000)

  if (capturePath) {
    setTimeout(() => {
      void mainWindow?.webContents.capturePage().then((image) => {
        writeFileSync(capturePath, image.toPNG())
        if (process.argv.includes('--capture-exit')) app.quit()
      })
    }, 3000)
  }

  if (openHistoryOnStart) setTimeout(() => openHistory(), 1200)

  state.tick()
  scheduleMidnight()
  minuteTimer = setInterval(() => state?.tick(), 60_000)
  wallpaperTimer = startWallpaperWatch(() => state?.emit())

  powerMonitor.on('resume', () => {
    state?.tick()
    void refreshBackdrop()
  })

  nativeTheme.on('updated', () => broadcast())
  app.on('second-instance', () => {
    showMainWindow()
  })
}

// Keeps the broadcast subscription alive for the lifetime of the process.
const apiState = {
  commit(): void {
    state?.subscribe(() => broadcast())
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('window-all-closed', () => {
    // The widget lives in the tray; closing windows must not end the process.
  })

  app.whenReady().then(bootstrap).catch((error) => {
    console.error('[liquid-todo] failed to start', error)
    app.quit()
  })
}

app.on('before-quit', () => {
  if (midnightTimer) clearTimeout(midnightTimer)
  if (minuteTimer) clearInterval(minuteTimer)
  if (wallpaperTimer) clearInterval(wallpaperTimer)
  state?.saveNow()
})

process.on('exit', () => {
  state?.saveNow()
})
