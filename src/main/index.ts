import { writeFileSync } from 'node:fs'
import { app, BrowserWindow, nativeTheme, powerMonitor } from 'electron'
import type { DesktopLayerRequest, ResolvedTheme, Snapshot, ThemeMode } from '../shared/types'
import { applyDesktopLayer, desktopLayerStatus, disposeDesktopLayer } from './desktopLayer'
import { DATA_DIR, useConfiguredDataDir } from './dataDir'
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
import { createCalendarWindow, createHistoryWindow, createMainWindow } from './windows'

const fakeDate = process.argv.find((arg) => arg.startsWith('--fake-date='))?.split('=')[1] ?? null
const capturePath = process.argv.find((arg) => arg.startsWith('--capture='))?.split('=')[1] ?? null
const layerArg = process.argv.find((arg) => arg.startsWith('--layer='))?.split('=')[1] ?? null
const layerOverride: DesktopLayerRequest | null =
  layerArg === 'workerw' || layerArg === 'bottom' || layerArg === 'auto'
    ? (layerArg as DesktopLayerRequest)
    : null
const openHistoryOnStart = process.argv.includes('--open-history')
const openCalendarOnStart = process.argv.includes('--open-calendar')
const LOGIN_ITEM_NAME = 'Liquid Todo'

registerWallpaperScheme()

// Point the whole profile (data.json plus every Chromium cache) at the configured folder before
// anything reads a path from it.
const dataDir = useConfiguredDataDir()

let state: TodoState | null = null
let mainWindow: BrowserWindow | null = null
let historyWindow: BrowserWindow | null = null
let calendarWindow: BrowserWindow | null = null
let midnightTimer: NodeJS.Timeout | null = null
let minuteTimer: NodeJS.Timeout | null = null
let wallpaperTimer: NodeJS.Timeout | null = null
let layerTimer: NodeJS.Timeout | null = null
let layerProbe: Promise<void> | null = null
let alwaysOnTop = false
/** The desktop layer retries while the app runs, so the fallback warning is shown only once. */
let layerWarningShown = false
/** How often the widget re-checks that the desktop still owns it. */
const LAYER_CHECK_MS = 12_000

/**
 * A widget that starts life fully covered by other windows is treated as occluded by Chromium
 * and never presents a frame, so nudge the window size once to force the first paint.
 */
function forceRepaint(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  win.webContents.invalidate()
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

/**
 * Samples the desktop under the frame of the window that asked for it, so each window
 * blurs exactly what sits behind itself instead of copying the main window's slice.
 */
function snapshotFor(win: BrowserWindow | null): Snapshot {
  if (!state) throw new Error('state not ready')
  const snapshot = state.snapshot()
  snapshot.backdrop = buildBackdrop(win)
  snapshot.theme = resolveTheme()
  return snapshot
}

function broadcast(): void {
  if (!state) return
  const history = state.history()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send('state:changed', { snapshot: snapshotFor(win), history })
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

/**
 * The widget can only float above other windows when the desktop pin is off, so the two settings
 * are exclusive: on the desktop layer it is never topmost.
 */
function applyAlwaysOnTop(): void {
  const pinned = state?.settings.desktopLayer !== 'bottom'
  const value = pinned ? false : alwaysOnTop
  for (const win of [mainWindow, historyWindow, calendarWindow]) {
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(value)
  }
}

async function pinWindow(win: BrowserWindow, requested: DesktopLayerRequest): Promise<void> {
  if (!state) return
  const result = await applyDesktopLayer(win, requested)
  console.log('[liquid-todo] desktop layer:', JSON.stringify(result))
  applyAlwaysOnTop()
  if (win === mainWindow) {
    state.setDesktopLayer(result.mode)
    if (result.ok || requested === 'bottom') {
      layerWarningShown = false
    } else if (!layerWarningShown) {
      layerWarningShown = true
      state.setNotice(
        'Windows would not let the widget sit on the wallpaper layer, so it floats as a normal window instead.',
        'warn'
      )
    }
  }
}

/**
 * Re-checks the desktop ownership and quietly re-attaches when it was lost.
 *
 * Windows drops the desktop owner on Explorer restarts, display and theme changes, and when a
 * fullscreen game or video switches modes. Re-attaching blindly is what used to shove the widget
 * in front of every window, so the check runs first and the lift inside the helper only happens
 * once the desktop really owns the window again. No notice is raised here: it is a repair, not a
 * problem the user has to act on.
 */
async function ensureDesktopPin(): Promise<void> {
  const win = mainWindow
  if (!state || !win || win.isDestroyed()) return
  if (layerProbe) return layerProbe

  layerProbe = (async () => {
    const requested = effectiveLayer()
    const status = await desktopLayerStatus(win)
    const historyStatus =
      historyWindow && !historyWindow.isDestroyed() ? await desktopLayerStatus(historyWindow) : null
    const calendarStatus =
      calendarWindow && !calendarWindow.isDestroyed() ? await desktopLayerStatus(calendarWindow) : null

    // No answer (host restarting, policy blocked it): leave the windows exactly as they are.
    if (!status) return

    if (requested === 'bottom') {
      if (status.pinned) await pinWindow(win, 'bottom')
      return
    }
    if (!status.pinned || status.topmost || !status.toolWindow) {
      await pinWindow(win, requested)
    }
    if (historyWindow && !historyWindow.isDestroyed() && historyStatus && !historyStatus.pinned) {
      await pinWindow(historyWindow, requested)
    }
    if (calendarWindow && !calendarWindow.isDestroyed() && calendarStatus && !calendarStatus.pinned) {
      await pinWindow(calendarWindow, requested)
    }
  })()

  try {
    await layerProbe
  } finally {
    layerProbe = null
  }
}

function showMainWindow(): void {
  if (!mainWindow) return
  mainWindow.showInactive()
  forceRepaint(mainWindow)
  // Showing a Chromium window can drop the desktop ownership, so it is checked afterwards.
  if (state) void ensureDesktopPin()
}

function toggleMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isVisible()) mainWindow.hide()
  else {
    mainWindow.showInactive()
    forceRepaint(mainWindow)
    if (state) void ensureDesktopPin()
  }
}

/**
 * "Show desktop" minimises every window. On the desktop layer the widget belongs to the desktop,
 * so it comes straight back; as an ordinary window it is meant to disappear with everything else.
 */
function reviveFromMinimize(): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  if (state?.desktopLayerMode !== 'workerw') return
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.restore()
    void ensureDesktopPin()
  }, 40)
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
      forceRepaint(historyWindow)
    })
    void pinWindow(historyWindow, effectiveLayer())
    return
  }
  historyWindow.show()
}

/**
 * The calendar is a small window of its own that follows the same layer rules as the board: it
 * is where the Future column gets its days from, so it opens beside the widget.
 */
function openCalendar(): void {
  if (!state) return
  if (!calendarWindow || calendarWindow.isDestroyed()) {
    calendarWindow = createCalendarWindow(state)
    calendarWindow.on('closed', () => {
      calendarWindow = null
    })
    calendarWindow.once('ready-to-show', () => {
      calendarWindow?.show()
      forceRepaint(calendarWindow)
    })
    void pinWindow(calendarWindow, effectiveLayer())
    return
  }
  calendarWindow.show()
}

async function refreshBackdrop(): Promise<void> {
  const changed = await refreshWallpaper(true)
  void changed
  state?.emit()
}

function applyLoginItem(enabled: boolean): void {
  if (!app.isPackaged) return
  // Only touch the registry when the state differs, so a manual change in Windows
  // Task Manager is not overwritten on every launch.
  if (app.getLoginItemSettings().openAtLogin === enabled) return
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, name: LOGIN_ITEM_NAME })
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId('com.luis.liquidtodo')

  state = new TodoState(fakeDate)
  if (fakeDate) state.setNotice(`Debug date override active: ${fakeDate}`, 'info')
  if (dataDir.detail !== 'user-data-dir override' && !dataDir.relocated) {
    state.setNotice(
      `${DATA_DIR} could not be used, so the board is running from the default folder instead.`,
      'warn'
    )
  }

  await refreshWallpaper(true)
  registerWallpaperProtocol()

  mainWindow = createMainWindow(state)
  mainWindow.on('minimize', reviveFromMinimize)
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  registerIpc({
    state,
    snapshotFor,
    openHistory,
    closeHistory: () => historyWindow?.close(),
    openCalendar,
    closeCalendar: () => calendarWindow?.close(),
    refreshBackdrop,
    applyDesktopLayer: async (requested) => {
      if (mainWindow) await pinWindow(mainWindow, requested)
    },
    // Windows reshuffles the z-order whenever a window is moved or resized, so the desktop
    // ownership is checked again once a drag or resize gesture ends.
    onFrameSettled: () => {
      void ensureDesktopPin()
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
      // Floating above every window and living on the desktop layer cannot both be true.
      if (mode !== 'bottom') alwaysOnTop = false
      if (mainWindow) void pinWindow(mainWindow, mode)
      if (historyWindow) void pinWindow(historyWindow, mode)
      if (calendarWindow) void pinWindow(calendarWindow, mode)
    },
    setAlwaysOnTop: (value) => {
      alwaysOnTop = value
      // Asking to float above other windows means leaving the desktop layer behind.
      if (value && state?.settings.desktopLayer !== 'bottom') {
        state?.patchSettings({ desktopLayer: 'bottom' })
        if (mainWindow) void pinWindow(mainWindow, 'bottom')
        if (historyWindow) void pinWindow(historyWindow, 'bottom')
        if (calendarWindow) void pinWindow(calendarWindow, 'bottom')
        return
      }
      applyAlwaysOnTop()
    },
    isAlwaysOnTop: () => alwaysOnTop,
    setTheme: (theme: ThemeMode) => {
      state?.patchSettings({ theme })
      broadcast()
    },
  })

  apiState.commit()

  applyLoginItem(state.settings.startAtLogin)
  showMainWindow()
  setTimeout(() => {
    applyAlwaysOnTop()
    void ensureDesktopPin()
  }, 2000)

  // Safety net: shell events (theme change, display change, Explorer restart) drop the desktop
  // ownership, which is what used to let the widget climb in front of other windows.
  layerTimer = setInterval(() => {
    void ensureDesktopPin()
  }, LAYER_CHECK_MS)

  if (capturePath) {
    setTimeout(() => {
      void mainWindow?.webContents.capturePage().then((image) => {
        writeFileSync(capturePath, image.toPNG())
        if (process.argv.includes('--capture-exit')) app.quit()
      })
    }, 3000)
  }

  if (openHistoryOnStart) setTimeout(() => openHistory(), 1200)
  if (openCalendarOnStart) setTimeout(() => openCalendar(), 1200)

  state.tick()
  scheduleMidnight()
  minuteTimer = setInterval(() => state?.tick(), 60_000)
  wallpaperTimer = startWallpaperWatch(() => state?.emit())

  powerMonitor.on('resume', () => {
    state?.tick()
    void refreshBackdrop()
    void ensureDesktopPin()
  })

  nativeTheme.on('updated', () => {
    broadcast()
    void ensureDesktopPin()
  })
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
  if (layerTimer) clearInterval(layerTimer)
  disposeDesktopLayer()
  state?.saveNow()
})

process.on('exit', () => {
  state?.saveNow()
})
