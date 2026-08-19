import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { IpcEvents } from '@shared/ipc'
import type { OpenCodeAlertEvent } from '@shared/types'
import { registerIpcHandlers } from './ipc'
import { OpenCodeManager } from './opencode/manager'
import { OpenCodeAlertManager } from './opencode/alerts'
import { OpenCodeTuiStatusManager } from './opencode/tui-status'
import { OpenCodeTokenRatePluginManager } from './opencode/token-rate'
import { PtyManager } from './pty/manager'
import { initWorkspaceStore } from './store/workspace'
import { adjustZoomFactor, DEFAULT_ZOOM_FACTOR, getZoomAction } from './zoom'

let mainWindow: BrowserWindow | null = null

const opencodeAlertManager = new OpenCodeAlertManager({
  getWindow: () => mainWindow,
  beep: () => shell.beep()
})

const opencodeTuiStatusManager = new OpenCodeTuiStatusManager({
  onStatus: (update) => {
    if (update.status === 'attention' || update.status === 'completed' || update.status === 'error') {
      opencodeAlertManager.alert({
        sessionId: update.sessionId,
        source: 'tui',
        kind: update.status,
        ...(update.attentionReason ? { attentionReason: update.attentionReason } : {})
      })
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcEvents.opencodeTuiStatus, update)
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
const opencodeManager = new OpenCodeManager({
  onStream: (chunk) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcEvents.opencodeStream, chunk)
    }
  },
  onAlert: (event: OpenCodeAlertEvent) => {
    opencodeAlertManager.alert(event)
  }
})

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
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('focus', () => opencodeAlertManager.clearFlashing())
  mainWindow.on('closed', () => {
    opencodeAlertManager.clearFlashing()
    mainWindow = null
  })

  // Nothing in this app should ever navigate away or open a second window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
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
    initWorkspaceStore(app.getPath('userData'))
    await opencodeTuiStatusManager.configure(app.getPath('userData'))
    await opencodeAlertManager.configure(app.getPath('userData'))
    registerIpcHandlers(
      ptyManager,
      opencodeManager,
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
    opencodeManager.disposeAll()
  })
}
