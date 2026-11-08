import { join } from 'node:path'
import { app, BrowserWindow, nativeImage, nativeTheme, screen, session, shell } from 'electron'
import { IpcEvents } from '@shared/ipc'
import { registerIpcHandlers } from './ipc'
import { rendererEntryUrl } from './ipc-security'
import { getMiniWindowAction, MiniWindowController } from './mini-window'
import { TitleBarController } from './window-chrome'
import { TaskbarAttention } from './taskbar-attention'
import { BADGE_SIZE, badgeBitmap } from './taskbar-badge'
import { PtyManager } from './pty/manager'
import { TerminalDirectoryStore } from './pty/directories'
import { initWorkspaceStore } from './store/workspace'
import { InboxStore, INBOX_FILE } from './inbox/store'
import { InboxRecorder } from './inbox/recorder'
import { InboxDraftStore } from './inbox/drafts'
import { InboxChatService } from './inbox/chat'
import { InboxWorktrees } from './inbox/worktree'
import { OpenCodeServiceClient } from './opencode/service/client'
import { createOpenCodeConfigService } from './opencode/config'
import { discoverOpenCodeService } from './opencode/service/discovery'
import { readGitTerminalInfo } from './git'
import { adjustZoomFactor, DEFAULT_ZOOM_FACTOR, getZoomAction } from './zoom'
import { handleWindowOpen } from './external-links'
import { installPermissionPolicy } from './permissions'
import { installRendererProtocol, registerRendererScheme } from './renderer-protocol'

let mainWindow: BrowserWindow | null = null
let inboxStore: InboxStore | null = null
let inboxRecorder: InboxRecorder | null = null
let inboxDrafts: InboxDraftStore | null = null
let inboxChat: InboxChatService | null = null
let quitPrepared = false
const rendererUrl = rendererEntryUrl(app.isPackaged, process.env.ELECTRON_RENDERER_URL)

// Shrinks this window into the always-on-top Inbox list; the screen module is only
// touched when F12 is pressed, which is always after `ready`.
const miniWindow = new MiniWindowController({
  getWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
  workAreaFor: (bounds) => screen.getDisplayMatching(bounds).workArea,
  onChange: (mode) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcEvents.windowModeChanged, mode)
    }
  }
})

const titleBar = new TitleBarController({
  platform: process.platform,
  getWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
  setThemeSource: (source) => {
    nativeTheme.themeSource = source
  }
})

// Flashes, colours and badges the taskbar button when a thread needs the person; the renderer decides when.
const taskbarAttention = new TaskbarAttention({
  platform: process.platform,
  getWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
  badge: (tone, count) =>
    nativeImage.createFromBitmap(badgeBitmap(tone, count), { width: BADGE_SIZE, height: BADGE_SIZE }),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (timer) => clearInterval(timer as ReturnType<typeof setInterval>)
})

const terminalDirectories = new TerminalDirectoryStore()
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
}, terminalDirectories)
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#0b0d10',
    autoHideMenuBar: true,
    title: 'MDE',
    // The renderer draws its own title bar; the OS keeps only the window buttons.
    ...titleBar.windowOptions(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Alert sounds play when a thread finishes, whether or not the person has clicked anything yet.
      autoplayPolicy: 'no-user-gesture-required',
      // MDE does not provide spell checking, so do not initialize Chromium's
      // OS spelling services for ordinary text fields.
      spellcheck: false,
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('focus', () => taskbarAttention.windowFocused())
  mainWindow.on('closed', () => {
    taskbarAttention.dispose()
    miniWindow.reset()
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
    // Handled here rather than in the renderer so it works from every pane and
    // dialog, and so the terminal never receives F12's escape sequence.
    const miniWindowAction = getMiniWindowAction(input)
    if (miniWindowAction) {
      event.preventDefault()
      if (miniWindowAction === 'toggle') miniWindow.toggle()
      return
    }

    const action = getZoomAction(input)
    if (!action) return

    event.preventDefault()
    const current = mainWindow?.webContents.getZoomFactor() ?? DEFAULT_ZOOM_FACTOR
    mainWindow?.webContents.setZoomFactor(adjustZoomFactor(current, action))
  })

  void mainWindow.loadURL(rendererUrl)
}

// Chromium force-loses the oldest WebGL context once a renderer process holds more
// than sixteen (kMaxActiveWebGLContexts), which garbles whichever terminal it picks.
// Terminals hold the GPU renderer only while their pane is on screen, so this is just
// headroom for the overshoot while a layout change swaps panes.
app.commandLine.appendSwitch('max-active-webgl-contexts', '32')

registerRendererScheme()

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
    // The window uses the default session in development and production alike,
    // so installing here, before any renderer loads, covers both.
    installPermissionPolicy(session.defaultSession)
    installRendererProtocol(session.defaultSession, join(__dirname, '../renderer'))
    initWorkspaceStore(app.getPath('userData'))
    await terminalDirectories.configure(app.getPath('userData'))
    inboxStore = new InboxStore(join(app.getPath('userData'), INBOX_FILE))
    await inboxStore.load()
    inboxRecorder = new InboxRecorder(inboxStore, {
      now: () => Date.now(),
      readBranch: async (target, directory) => {
        const info = await readGitTerminalInfo(target, directory)
        return info.repository ? info.branch : null
      },
      onChanged: (thread) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IpcEvents.inboxChanged, thread)
        }
      }
    })
    const serviceClient = new OpenCodeServiceClient({
      discover: discoverOpenCodeService,
      executable: () => inboxChat?.executable() ?? 'opencode'
    })
    const previewAttachment = (bytes: Buffer): string | undefined => {
      const image = nativeImage.createFromBuffer(bytes)
      if (image.isEmpty()) return undefined
      const size = image.getSize()
      const scale = Math.min(1, 160 / Math.max(size.width, size.height))
      const url = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }).toDataURL()
      return url.length <= 180_000 ? url : undefined
    }
    inboxDrafts = new InboxDraftStore(join(app.getPath('userData'), 'inbox-drafts'), previewAttachment, (key) => {
      // A thread's draft goes with the thread. A new thread's draft belongs to no one place: its folder may
      // have been removed since, and it then opens in whichever folder the page shows.
      return !key.startsWith('thread:') || Boolean(inboxStore?.get(key.slice('thread:'.length)))
    })
    const openCodeConfig = createOpenCodeConfigService({
      client: serviceClient,
      onSaved: () => inboxChat?.invalidateOptions()
    })
    inboxChat = new InboxChatService({
      drafts: inboxDrafts,
      worktrees: new InboxWorktrees(),
      thumbnail: previewAttachment,
      client: serviceClient,
      store: inboxStore,
      recorder: inboxRecorder,
      now: () => Date.now(),
      enabled: () => process.platform === 'darwin' || process.platform === 'win32',
      send: (event) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IpcEvents.chatEvent, event)
        }
      }
    })
    // Threads that were still working when MDE last quit start receiving their events again.
    inboxChat.start()
    registerIpcHandlers(
      { getWebContents: () => mainWindow?.webContents ?? null, rendererUrl },
      ptyManager,
      miniWindow,
      titleBar,
      { recorder: inboxRecorder, chat: inboxChat, openCodeConfig },
      taskbarAttention
    )
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', (event) => {
    if (quitPrepared) return
    quitPrepared = true
    ptyManager.disposeAll()
    inboxChat?.stop()
    // Save the last pane directories and Inbox state before exiting.
    event.preventDefault()
    void Promise.all([terminalDirectories.flush(), inboxStore?.flush(), inboxDrafts?.flush()])
      .catch(() => console.warn('[app] Could not finish saving local state.'))
      .finally(() => app.quit())
  })
}
