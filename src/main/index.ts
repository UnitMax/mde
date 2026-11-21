import { join } from 'node:path'
import { app, BrowserWindow, nativeImage, nativeTheme, powerMonitor, screen, session, shell } from 'electron'
import { IpcEvents } from '@shared/ipc'
import { registerIpcHandlers } from './ipc'
import { rendererEntryUrl } from './ipc-security'
import { getMiniWindowAction, MiniWindowController } from './mini-window'
import { TitleBarController } from './window-chrome'
import { TaskbarAttention } from './taskbar-attention'
import { FloatingTerminalKey } from './floating-terminal-key'
import { ComposerKey } from './composer-key'
import { FileViewerKey } from './file-viewer-key'
import { WslResourceMonitor } from './wsl/resources'
import { BADGE_SIZE, badgeBitmap } from './taskbar-badge'
import { PtyManager } from './pty/manager'
import { TerminalDirectoryStore } from './pty/directories'
import { initWorkspaceStore } from './store/workspace'
import { InboxStore, INBOX_FILE } from './inbox/store'
import { InboxRecorder } from './inbox/recorder'
import { InboxAsideHistory } from './inbox/asides'
import { AUTOMATIONS_FILE, InboxAutomations } from './inbox/automations'
import { InboxDraftStore } from './inbox/drafts'
import { InboxChatService } from './inbox/chat'
import { InboxWorktrees } from './inbox/worktree'
import { OpenCodeServiceClient } from './opencode/service/client'
import { createOpenCodeConfigService } from './opencode/config'
import { discoverOpenCodeService } from './opencode/service/discovery'
import { readGitTerminalInfo } from './git'
import { readGitIgnoredPaths } from './inbox/changes'
import { adjustZoomFactor, DEFAULT_ZOOM_FACTOR, getZoomAction } from './zoom'
import { handleWindowOpen } from './external-links'
import { installPermissionPolicy } from './permissions'
import { installRendererProtocol, registerRendererScheme } from './renderer-protocol'
import { isMcpBridgeLaunch, mdeMcpCommand, startMdeMcp } from './mcp'
import { BridgeStandby, MDE_MCP_STANDBY_FILE } from './mcp/standby'
import { startMcpBridge } from './mcp/bridge-main'
import { AgentTerminals } from './mcp/agent-terminals'
import { TerminalReferences } from './mcp/terminal-references'
import type { McpListener } from './mcp/listener'
import { checkedInboxFolderPlace } from './ipc'
import { toWsl } from './wsl/paths'
import { BROWSER_FILE, BROWSER_PARTITION, MdeBrowser } from './browser'

let mainWindow: BrowserWindow | null = null
let inboxStore: InboxStore | null = null
let inboxRecorder: InboxRecorder | null = null
let inboxDrafts: InboxDraftStore | null = null
let inboxAsides: InboxAsideHistory | null = null
let inboxAutomations: InboxAutomations | null = null
let inboxChat: InboxChatService | null = null
let mdeMcp: McpListener | null = null
let browser: MdeBrowser | null = null
let bridgeStandby: BridgeStandby | null = null
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
const composerKey = new ComposerKey()
const fileViewerKey = new FileViewerKey()
/** Reads WSL's CPU and memory while the renderer shows the title bar meter. */
const wslResources = new WslResourceMonitor((sample) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IpcEvents.wslResources, sample)
})
// Flashes, colours and badges the taskbar button when a thread needs the person; the renderer decides when.
const taskbarAttention = new TaskbarAttention({
  platform: process.platform,
  getWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
  badge: (tone, count) =>
    nativeImage.createFromBitmap(badgeBitmap(tone, count), { width: BADGE_SIZE, height: BADGE_SIZE }),
  setDockBadge: (text) => app.dock?.setBadge(text),
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
}, terminalDirectories, () => app.getLocale())
/**
 * The mini window's key (F12), the floating terminal's (F11) and the Inbox message box's (F9) and sidebar's (F10), which work whichever
 * page has the keyboard: the window's, or a page of the MDE browser. True when the key was taken.
 */
function windowKey(input: Electron.Input): boolean {
  const miniWindowAction = getMiniWindowAction(input)
  if (miniWindowAction) {
    if (miniWindowAction === 'toggle') miniWindow.toggle()
    return true
  }
  const floatingTerminalAction = floatingTerminalKey.action(input)
  if (floatingTerminalAction) {
    if (floatingTerminalAction === 'toggle') mainWindow?.webContents.send(IpcEvents.floatingTerminalToggle)
    return true
  }
  const composerAction = composerKey.action(input)
  if (composerAction) {
    if (composerAction === 'focus') {
      // From a page of the MDE browser, the keyboard has to come back to the window before the box can have it.
      mainWindow?.webContents.focus()
      mainWindow?.webContents.send(IpcEvents.inboxComposerFocus)
    } else if (composerAction === 'sidebar') {
      mainWindow?.webContents.send(IpcEvents.inboxSidebarToggle)
    }
    return true
  }
  return false
}

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
    wslResources.dispose()
    miniWindow.reset()
    browser?.dispose()
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
  mainWindow.webContents.on('did-start-loading', () => composerKey.setActive(false))
  // Nor a file viewer.
  mainWindow.webContents.on('did-start-loading', () => fileViewerKey.setOpen(false))
  // Nor a meter: the page asks for the readings again when it shows one.
  mainWindow.webContents.on('did-start-loading', () => wslResources.setEnabled(false))
  // Nor a browser panel, so no page is left over a window that is loading again.
  mainWindow.webContents.on('did-start-loading', () => browser?.setBounds(null))
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Handled here rather than in the renderer so it works from every pane and
    // dialog, and so the terminal never receives F12's escape sequence.
    if (windowKey(input)) {
      event.preventDefault()
      return
    }

    // The window menu closes the window on Ctrl+W (Cmd+W); with a file viewer open the key closes the viewer instead.
    if (fileViewerKey.closes(input)) {
      event.preventDefault()
      mainWindow?.webContents.send(IpcEvents.fileViewerClose)
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
    // Snoozes that ran out while MDE was closed wake now; the rest on time, and on waking from sleep.
    inboxRecorder.wakeSnoozed()
    powerMonitor.on('resume', () => inboxRecorder?.wakeSnoozed())
    const serviceClient = new OpenCodeServiceClient({
      discover: discoverOpenCodeService,
      executable: () => inboxChat?.executable() ?? 'opencode',
      onDirectory: (target, directory) => bridgeStandby?.use(target, directory)
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
      onSaved: () => {
        inboxChat?.invalidateOptions()
        bridgeStandby?.refresh()
      }
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
      ignored: readGitIgnoredPaths,
      send: (event) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IpcEvents.chatEvent, event)
        }
      },
      onMcpServers: (target, directory, servers) => bridgeStandby?.revive(target, directory, servers),
    })
    // Threads that were still working when MDE last quit start receiving their events again.
    inboxChat.start()
    const self = {
      executable: process.execPath,
      ...(app.isPackaged ? {} : { appPath: app.getAppPath() }),
      // A second MDE kept apart with --user-data-dir has its own socket and token, so its bridge needs the same folder.
      ...(app.commandLine.hasSwitch('user-data-dir') ? { userDataDir: app.getPath('userData') } : {}),
    }
    // While MDE is closed its bridges are stopped, so nothing keeps the executable in use; they come back now.
    if (inboxEnabled()) {
      bridgeStandby = new BridgeStandby({
        file: join(app.getPath('userData'), MDE_MCP_STANDBY_FILE),
        client: serviceClient,
        owned: async (target) => (await openCodeConfig.mdeMcpStatus(target, await mdeMcpCommand(target, self, toWsl))).state === 'installed',
        // The chat box's server list reads again, as on any MCP change OpenCode reports.
        changed: (target) => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IpcEvents.chatEvent, { type: 'mcp', target })
        },
      })
      void bridgeStandby.resume()
    }
    const agentTerminals = new AgentTerminals(app.getPath('userData'))
    const terminalReferences = new TerminalReferences(app.getPath('userData'))
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
      references: terminalReferences,
      now: () => Date.now(),
    })
    // Automations run where the Inbox does. What came due while MDE was closed runs once, shortly after the start.
    if (inboxEnabled()) {
      const store = inboxStore
      const chat = inboxChat
      inboxAutomations = new InboxAutomations(join(app.getPath('userData'), AUTOMATIONS_FILE), {
        now: () => Date.now(),
        folderExists: (folderId) => store.folders().some((folder) => folder.id === folderId),
        threadExists: (threadId) => Boolean(store.get(threadId)),
        busy: (threadId) => {
          const status = store.get(threadId)?.status
          return status === 'working' || status === 'attention'
        },
        run: async (automation) => {
          const before = store.folders().length
          try {
            return await chat.create({
              folderId: automation.folderId,
              text: automation.text,
              agent: automation.agent,
              model: automation.model,
              ...(automation.permissionMode ? { permissionMode: automation.permissionMode } : {}),
              ...(automation.worktree ? { worktree: automation.worktree } : {}),
            }, { automationId: automation.id })
          } finally {
            // A worktree run adds the worktree as a project.
            if (store.folders().length !== before && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IpcEvents.inboxFoldersChanged)
          }
        },
        onChanged: (automations) => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IpcEvents.automationsChanged, automations)
        },
      })
      await inboxAutomations.load()
      inboxAutomations.start()
      powerMonitor.on('resume', () => inboxAutomations?.check())
    }
    // The MDE browser has its own session, so its pages share no cookies, storage or permissions with the window.
    browser = new MdeBrowser({
      session: session.fromPartition(BROWSER_PARTITION),
      window: () => mainWindow,
      file: join(app.getPath('userData'), BROWSER_FILE),
      openExternal: (url) => void shell.openExternal(url),
      send: (state) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IpcEvents.browserChanged, state)
      },
      windowKey,
    })
    await browser.load()
    browser.install()
    registerIpcHandlers(
      { getWebContents: () => mainWindow?.webContents ?? null, rendererUrl },
      ptyManager,
      miniWindow,
      titleBar,
      { recorder: inboxRecorder, chat: inboxChat, openCodeConfig, mdeMcpCommand: (target) => mdeMcpCommand(target, self, toWsl), agentTerminals, terminalReferences, ...(inboxAutomations ? { automations: inboxAutomations } : {}) },
      taskbarAttention,
      floatingTerminalKey,
      wslResources,
      fileViewerKey,
      browser,
      composerKey
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
    wslResources.dispose()
    inboxChat?.stop()
    inboxRecorder?.dispose()
    inboxAutomations?.dispose()
    browser?.dispose()
    void mdeMcp?.close()
    // Save the last pane directories and Inbox state before exiting.
    event.preventDefault()
    void Promise.all([terminalDirectories.flush(), inboxStore?.flush(), inboxDrafts?.flush(), inboxAsides?.flush(), inboxAutomations?.flush(), browser?.flush(), bridgeStandby?.pause()])
      .catch(() => console.warn('[app] Could not finish saving local state.'))
      .finally(() => app.quit())
  })
}
