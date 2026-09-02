import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { IpcEvents } from '@shared/ipc'
import { registerIpcHandlers } from './ipc'
import { OpenCodeAlertManager } from './opencode/alerts'
import { OpenCodeTuiStatusManager } from './opencode/tui-status'
import { OpenCodeTokenRatePluginManager } from './opencode/token-rate'
import { PtyManager } from './pty/manager'
import { initWorkspaceStore } from './store/workspace'
import { initGitRepositoryStore } from './store/git-repositories'
import { adjustZoomFactor, DEFAULT_ZOOM_FACTOR, getZoomAction } from './zoom'
import { handleWindowOpen } from './external-links'

let mainWindow: BrowserWindow | null = null

const opencodeAlertManager = new OpenCodeAlertManager({
  getWindow: () => mainWindow,
  beep: () => shell.beep()
})

const opencodeTuiStatusManager = new OpenCodeTuiStatusManager({
  onStatus: (update) => {
    if (update.status === 'attention' || update.status === 'completed' || update.status === 'error') {
      opencodeAlertManager.alert()
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcEvents.opencodeTuiStatus, update)
    }
  },
  onInstances: (update) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcEvents.opencodeTuiInstances, update)
    }
  }
})
const opencodeTokenRatePluginManager = new OpenCodeTokenRatePluginManager()

const ptyManager = new PtyManager({
  onData: (chunk) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcEvents.ptyData, chunk)
    }
  },
  onDirectory: (update) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcEvents.ptyDirectory, update)
    }
  },
  onExit: (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcEvents.ptyExit, info)
    }
  }
}, [opencodeTuiStatusManager, opencodeTokenRatePluginManager])
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#0b0d10',
    autoHideMenuBar: true,
    title: 'mde',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // MDE does not provide spell checking, so do not initialize Chromium's
      // OS spelling services for ordinary text fields.
      spellcheck: false,
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('focus', () => opencodeAlertManager.clearFlashing())
  mainWindow.on('closed', () => {
    opencodeAlertManager.clearFlashing()
    mainWindow = null
  })

  // Nothing in this app should ever navigate away or open a second window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) =>
    handleWindowOpen(url, (safeUrl) => {
      void shell.openExternal(safeUrl)
    })
  )
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const action = getZoomAction(input)
    if (!action) return

    event.preventDefault()
    const current = mainWindow?.webContents.getZoomFactor() ?? DEFAULT_ZOOM_FACTOR
    mainWindow?.webContents.setZoomFactor(adjustZoomFactor(current, action))
  })

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Chromium force-loses the oldest WebGL context once a renderer process holds more
// than sixteen (kMaxActiveWebGLContexts), which garbles whichever terminal it picks.
// Terminals hold the GPU renderer only while their pane is on screen, so this is just
// headroom for the overshoot while a layout change swaps panes.
app.commandLine.appendSwitch('max-active-webgl-contexts', '32')

// Two instances would race each other writing workspace.json.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(async () => {
    // Chromium's default resolver mode silently upgrades name resolution to
    // DNS-over-HTTPS whenever the system resolver is a recognized provider. MDE
    // resolves no hostnames of its own, so turning it off removes the last path
    // by which this process could open a connection rather than falling back to
    // plaintext DNS. Electron requires this call after `ready`.
    app.configureHostResolver({ secureDnsMode: 'off' })
    initWorkspaceStore(app.getPath('userData'))
    initGitRepositoryStore(app.getPath('userData'))
    await opencodeTuiStatusManager.configure(app.getPath('userData'))
    await opencodeAlertManager.configure(app.getPath('userData'))
    registerIpcHandlers(
      ptyManager,
      opencodeTuiStatusManager,
      opencodeTokenRatePluginManager,
      opencodeAlertManager
    )
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    opencodeAlertManager.dispose()
    ptyManager.disposeAll()
    opencodeTuiStatusManager.disposeAll()
  })
}
