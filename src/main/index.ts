import { join } from 'node:path'
import { app, BrowserWindow, nativeImage, nativeTheme, screen, session, shell } from 'electron'
import { IpcEvents } from '@shared/ipc'
import { registerIpcHandlers } from './ipc'
import { rendererEntryUrl } from './ipc-security'
import { getMiniWindowAction, MiniWindowController } from './mini-window'
import { TitleBarController } from './window-chrome'
import { TaskbarAttention } from './taskbar-attention'
import { FloatingTerminalKey } from './floating-terminal-key'
import { BADGE_SIZE, badgeBitmap } from './taskbar-badge'
import { PtyManager } from './pty/manager'
import { TerminalDirectoryStore } from './pty/directories'
import { initWorkspaceStore } from './store/workspace'
import { InboxStore, INBOX_FILE } from './inbox/store'
import { InboxRecorder } from './inbox/recorder'
import { InboxAsideHistory } from './inbox/asides'
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
import { isMcpBridgeLaunch, mdeMcpCommand, startMdeMcp } from './mcp'
import { startMcpBridge } from './mcp/bridge-main'
import { AgentTerminals } from './mcp/agent-terminals'
import type { McpListener } from './mcp/listener'
import { checkedInboxFolderPlace } from './ipc'
import { toWsl } from './wsl/paths'

let mainWindow: BrowserWindow | null = null
let inboxStore: InboxStore | null = null
let inboxRecorder: InboxRecorder | null = null
let inboxDrafts: InboxDraftStore | null = null
let inboxAsides: InboxAsideHistory | null = null
let inboxChat: InboxChatService | null = null
let mdeMcp: McpListener | null = null
let quitPrepared = false
/** The Inbox (and with it the MDE MCP) runs OpenCode natively on macOS and inside WSL on Windows. */
const inboxEnabled = (): boolean => process.platform === 'darwin' || process.platform === 'win32'
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

/** Whether F11 belongs to the Inbox's floating terminal; the renderer says so while it has one. */
const floatingTerminalKey = new FloatingTerminalKey()
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
  // Leaving the window is one of the quiet moments at which unsent Inbox drafts are written to disk.
  mainWindow.on('blur', () => { void inboxDrafts?.save() })
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
  // A reloaded page has no floating terminal until it says so again.
  mainWindow.webContents.on('did-start-loading', () => floatingTerminalKey.setActive(false))
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Handled here rather than in the renderer so it works from every pane and
    // dialog, and so the terminal never receives F12's escape sequence.
    const miniWindowAction = getMiniWindowAction(input)
    if (miniWindowAction) {
      event.preventDefault()
      if (miniWindowAction === 'toggle') miniWindow.toggle()
      return
    }

    const floatingTerminalAction = floatingTerminalKey.action(input)
    if (floatingTerminalAction) {
      event.preventDefault()
      if (floatingTerminalAction === 'toggle') mainWindow?.webContents.send(IpcEvents.floatingTerminalToggle)
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

// OpenCode starts MDE with `--mcp-bridge` as its `mde` MCP server: that process only relays tool calls to the
// running MDE, so it takes no lock, opens no window and registers nothing.
const bridgeLaunch = isMcpBridgeLaunch(process.argv)
if (!bridgeLaunch) registerRendererScheme()

if (bridgeLaunch) {
  startMcpBridge(process.argv)
// Two instances would race each other writing workspace.json.
} else if (!app.requestSingleInstanceLock()) {
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
    inboxAsides = new InboxAsideHistory(join(app.getPath('userData'), 'inbox-asides.json'), (threadId) => Boolean(inboxStore?.get(threadId)))
    inboxChat = new InboxChatService({
      drafts: inboxDrafts,
      asides: inboxAsides,
      worktrees: new InboxWorktrees(),
      thumbnail: previewAttachment,
      client: serviceClient,
      store: inboxStore,
      recorder: inboxRecorder,
      now: () => Date.now(),
      enabled: inboxEnabled,
      send: (event) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IpcEvents.chatEvent, event)
        }
      }
    })
    // Threads that were still working when MDE last quit start receiving their events again.
    inboxChat.start()
    const self = {
      executable: process.execPath,
      ...(app.isPackaged ? {} : { appPath: app.getAppPath() }),
      // A second MDE kept apart with --user-data-dir has its own socket and token, so its bridge needs the same folder.
      ...(app.commandLine.hasSwitch('user-data-dir') ? { userDataDir: app.getPath('userData') } : {}),
    }
    const agentTerminals = new AgentTerminals(app.getPath('userData'))
    // Agents can only start threads where the Inbox runs; elsewhere nothing listens and no token is made.
    mdeMcp = !inboxEnabled() ? null : await startMdeMcp({
      userData: app.getPath('userData'),
      platform: process.platform,
      chat: inboxChat,
      store: inboxStore,
      available: inboxEnabled,
      checkFolder: (target, directory) =>
        checkedInboxFolderPlace(target.kind, target.kind === 'wsl' ? target.distro : undefined, directory),
      foldersChanged: () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IpcEvents.inboxFoldersChanged)
      },
      terminals: agentTerminals,
      now: () => Date.now(),
    })
    registerIpcHandlers(
      { getWebContents: () => mainWindow?.webContents ?? null, rendererUrl },
      ptyManager,
      miniWindow,
      titleBar,
      { recorder: inboxRecorder, chat: inboxChat, openCodeConfig, mdeMcpCommand: (target) => mdeMcpCommand(target, self, toWsl), agentTerminals },
      taskbarAttention,
      floatingTerminalKey
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
    void mdeMcp?.close()
    // Save the last pane directories and Inbox state before exiting.
    event.preventDefault()
    void Promise.all([terminalDirectories.flush(), inboxStore?.flush(), inboxDrafts?.flush(), inboxAsides?.flush()])
      .catch(() => console.warn('[app] Could not finish saving local state.'))
      .finally(() => app.quit())
  })
}
