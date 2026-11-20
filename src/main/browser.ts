import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import {
  Menu,
  WebContentsView,
  clipboard,
  type BrowserWindow,
  type Input,
  type MenuItemConstructorOptions,
  type Session,
} from 'electron'
import {
  BROWSER_ALLOWED_HOST_LIMIT,
  BROWSER_BLOCKED_HOST_LIMIT,
  BROWSER_TAB_LIMIT,
  browserHost,
  browserUrl,
  classifyBrowserRequest,
  isBrowserUrlAllowed,
  isHostAllowed,
  isLoopbackHost,
  normalizeAllowedHost,
  type BrowserAction,
  type BrowserBounds,
  type BrowserState,
  type BrowserTab,
} from '@shared/browser'
import { safeExternalWebUrl } from './external-links'
import { installPermissionPolicy } from './permissions'
import { writeJsonAtomic } from './store/atomic-json'

/** The browser's own session, kept on disk so logins to the apps being developed last; never the window's. */
export const BROWSER_PARTITION = 'persist:mde-browser'
export const BROWSER_FILE = 'browser.json'

/** Chromium's net error codes the browser does not report: a load it cancelled itself, or one it refused. */
const QUIET_LOAD_ERRORS = new Set([-3, -20])
/** The least time between two pages handed to the system browser, so a page cannot open a flood of them. */
const EXTERNAL_INTERVAL_MS = 1000

export interface MdeBrowserOptions {
  session: Session
  /** The window the browser is drawn in; null while there is none. */
  window: () => BrowserWindow | null
  /** Where the allowed hosts are kept. */
  file: string
  /** Opens an address in the system browser. */
  openExternal: (url: string) => void
  /** The browser changed; carries all of it. */
  send: (state: BrowserState) => void
  /**
   * Keys MDE handles whichever page has the keyboard (the floating terminal's and the mini window's); true when it
   * took the key, which the page then does not get.
   */
  windowKey?: (input: Input) => boolean
}

interface Tab {
  id: string
  /** Made when the tab first loads something: a new tab is only its address field. */
  view: WebContentsView | null
  state: BrowserTab
}

function emptyTab(id: string): BrowserTab {
  return { id, url: '', title: 'New tab', loading: false, canGoBack: false, canGoForward: false, blocked: null, blockedHosts: [], error: null }
}

/**
 * The MDE browser's tabs. Each tab is a WebContentsView in its own sandboxed session, laid over the window where
 * the renderer says its sidebar panel is. Every request of every page passes `classifyBrowserRequest` before it is
 * sent: local addresses and the allowed hosts go through, anything else is cancelled and reported to the tab.
 */
export class MdeBrowser {
  private tabs: Tab[] = []
  private activeId: string | null = null
  private allowed: string[] = []
  private bounds: BrowserBounds | null = null
  private shown: WebContentsView | null = null
  private lastExternal = 0
  private sendTimer: ReturnType<typeof setTimeout> | null = null
  private installed = false

  constructor(private readonly options: MdeBrowserOptions) {}

  /** Reads the allowed hosts. A missing or unreadable file is an empty list. */
  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.options.file, 'utf8')) as { allowedHosts?: unknown }
      const list = Array.isArray(raw.allowedHosts) ? raw.allowedHosts : []
      const hosts: string[] = []
      for (const entry of list) {
        const host = typeof entry === 'string' ? normalizeAllowedHost(entry) : null
        if (host && !isLoopbackHost(host) && !hosts.includes(host)) hosts.push(host)
      }
      this.allowed = hosts.slice(0, BROWSER_ALLOWED_HOST_LIMIT)
    } catch {
      this.allowed = []
    }
  }

  /** Puts the policy on the browser's session: the request filter, no permissions, asked downloads, no spell check. */
  install(): void {
    if (this.installed) return
    this.installed = true
    const { session } = this.options
    installPermissionPolicy(session)
    session.setSpellCheckerEnabled(false)
    session.webRequest.onBeforeRequest((details, callback) => {
      // DevTools' own pages, which the page cannot load itself.
      if (details.url.startsWith('devtools://')) {
        callback({})
        return
      }
      const verdict = classifyBrowserRequest(details.url, this.allowed)
      if (verdict.allow) {
        callback({})
        return
      }
      callback({ cancel: true })
      this.refused(details.webContentsId, details.url, verdict.host, details.resourceType === 'mainFrame')
    })
    session.on('will-download', (_event, item, contents) => {
      // Only a tab of the browser downloads; Electron then asks where to save, so nothing is saved unasked.
      if (!this.tabs.some((tab) => tab.view?.webContents === contents)) {
        item.cancel()
        return
      }
      item.setSaveDialogOptions({ title: 'Save download from the MDE browser' })
    })
  }

  state(): BrowserState {
    return {
      tabs: this.tabs.map((tab) => ({ ...tab.state, blockedHosts: [...tab.state.blockedHosts] })),
      activeId: this.activeId,
      allowedHosts: [...this.allowed],
    }
  }

  /** Opens an address in the browser: in the tab already showing it, or in a new one. */
  open(input: string): BrowserState {
    const url = browserUrl(input)
    if (!url) throw new Error('The MDE browser opens only http and https addresses.')
    const existing = this.tabs.find((tab) => tab.state.url === url)
    if (existing) {
      this.activeId = existing.id
      this.changed()
      return this.state()
    }
    const tab = this.addTab()
    return this.navigate(tab.id, url)
  }

  /** A tab with nothing in it yet, to type an address into. */
  newTab(): BrowserState {
    this.addTab()
    this.changed()
    return this.state()
  }

  /**
   * Sends a tab to an address. A host that is not allowed is not contacted at all: the tab shows that it was
   * refused, and the person can allow the host from there.
   */
  navigate(id: string, input: string): BrowserState {
    const tab = this.tab(id)
    const url = browserUrl(input)
    if (!url) throw new Error('The MDE browser opens only http and https addresses.')
    const host = browserHost(url)!
    this.activeId = tab.id
    tab.state = { ...tab.state, url, title: host, error: null, blocked: null, blockedHosts: [] }
    if (!isHostAllowed(host, this.allowed)) {
      tab.state.blocked = { url, host }
      tab.state.loading = false
      this.changed()
      return this.state()
    }
    const view = this.viewOf(tab)
    // A refused or failed load is reported through the tab's events.
    view.webContents.loadURL(url).catch(() => undefined)
    this.changed()
    return this.state()
  }

  act(id: string, action: BrowserAction): void {
    const tab = this.tab(id)
    const contents = tab.view?.webContents
    switch (action) {
      case 'back':
        if (contents?.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
        return
      case 'forward':
        if (contents?.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
        return
      case 'reload':
        if (tab.state.blocked) return
        // A page that did not load, or crashed, is loaded again from its address.
        if (!contents || tab.state.error) {
          if (tab.state.url) this.navigate(id, tab.state.url)
          return
        }
        contents.reload()
        return
      case 'stop':
        contents?.stop()
        return
      case 'devtools':
        if (!contents) return
        if (contents.isDevToolsOpened()) contents.closeDevTools()
        else contents.openDevTools({ mode: 'detach', activate: true })
    }
  }

  select(id: string): BrowserState {
    this.activeId = this.tab(id).id
    this.changed()
    return this.state()
  }

  close(id: string): BrowserState {
    const at = this.tabs.findIndex((tab) => tab.id === id)
    if (at < 0) return this.state()
    const [tab] = this.tabs.splice(at, 1)
    if (tab) this.destroy(tab)
    if (this.activeId === id) this.activeId = (this.tabs[at] ?? this.tabs[at - 1])?.id ?? null
    this.changed()
    return this.state()
  }

  /** Where the sidebar panel is, in the page's CSS pixels, or null while it is not on screen (or something covers it). */
  setBounds(bounds: BrowserBounds | null): void {
    this.bounds = bounds
    this.syncView()
  }

  /** A picture of the active page, to stand in for it while a menu or dialog is over the panel. */
  async capture(): Promise<string | null> {
    const view = this.shown
    if (!view || view.webContents.isDestroyed()) return null
    try {
      const image = await view.webContents.capturePage()
      return image.isEmpty() ? null : image.toDataURL()
    } catch {
      return null
    }
  }

  /**
   * Allows a host from now on and keeps it. A tab that was refused it opens its page; a page that was refused it
   * for parts of itself loads again.
   */
  async allowHost(input: string): Promise<BrowserState> {
    const host = normalizeAllowedHost(input)
    if (!host) throw new Error('Enter a host name or an IP address.')
    if (!isLoopbackHost(host) && !this.allowed.includes(host)) {
      if (this.allowed.length >= BROWSER_ALLOWED_HOST_LIMIT) throw new Error(`The MDE browser keeps up to ${BROWSER_ALLOWED_HOST_LIMIT} allowed hosts.`)
      this.allowed = [...this.allowed, host]
      await this.save()
    }
    const active = this.activeId
    for (const tab of this.tabs) {
      if (tab.state.blocked?.host === host) {
        this.navigate(tab.id, tab.state.blocked.url)
      } else if (tab.state.blockedHosts.includes(host)) {
        tab.state.blockedHosts = tab.state.blockedHosts.filter((entry) => entry !== host)
        tab.view?.webContents.reload()
      }
    }
    // Opening the refused pages does not change which tab is shown.
    this.activeId = active
    this.changed()
    return this.state()
  }

  /** Stops allowing a host. Pages already open keep what they loaded; their next requests to it are refused. */
  async removeHost(host: string): Promise<BrowserState> {
    const name = host.toLowerCase()
    if (this.allowed.includes(name)) {
      this.allowed = this.allowed.filter((entry) => entry !== name)
      await this.save()
    }
    this.changed()
    return this.state()
  }

  /** Forgets the browser's cookies, storage and cache: every login to the apps opened in it. */
  async clearData(): Promise<void> {
    await this.options.session.clearStorageData()
    await this.options.session.clearCache()
    await this.options.session.clearAuthCache()
  }

  dispose(): void {
    if (this.sendTimer) clearTimeout(this.sendTimer)
    for (const tab of this.tabs) this.destroy(tab)
    this.tabs = []
    this.activeId = null
  }

  private tab(id: string): Tab {
    const tab = this.tabs.find((item) => item.id === id)
    if (!tab) throw new Error('That browser tab is closed.')
    return tab
  }

  private addTab(): Tab {
    if (this.tabs.length >= BROWSER_TAB_LIMIT) throw new Error(`Close a tab first: the MDE browser keeps up to ${BROWSER_TAB_LIMIT}.`)
    const id = `brt_${randomUUID()}`
    const tab: Tab = { id, view: null, state: emptyTab(id) }
    this.tabs.push(tab)
    this.activeId = id
    return tab
  }

  private async save(): Promise<void> {
    await writeJsonAtomic(this.options.file, { version: 1, allowedHosts: this.allowed })
  }

  /** Hands an address to the system browser: only http and https, and not more than once a second. */
  private external(value: string): void {
    const url = safeExternalWebUrl(value)
    const now = Date.now()
    if (!url || now - this.lastExternal < EXTERNAL_INTERVAL_MS) return
    this.lastExternal = now
    this.options.openExternal(url)
  }

  private refused(contentsId: number | undefined, url: string, host: string | null, mainFrame: boolean): void {
    const tab = this.tabs.find((item) => item.view && !item.view.webContents.isDestroyed() && item.view.webContents.id === contentsId)
    if (!tab) return
    if (mainFrame) {
      if (host) tab.state = { ...tab.state, url, title: host, blocked: { url, host }, loading: false }
      else tab.state = { ...tab.state, loading: false, error: 'The MDE browser opens only http and https addresses.' }
    } else if (host && !tab.state.blockedHosts.includes(host)) {
      tab.state.blockedHosts = [...tab.state.blockedHosts, host].slice(-BROWSER_BLOCKED_HOST_LIMIT)
    } else {
      return
    }
    this.changed()
  }

  private viewOf(tab: Tab): WebContentsView {
    if (tab.view && !tab.view.webContents.isDestroyed()) return tab.view
    const view = new WebContentsView({
      webPreferences: {
        session: this.options.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webviewTag: false,
        spellcheck: false,
        safeDialogs: true,
        navigateOnDragDrop: false,
      },
    })
    view.setBackgroundColor('#ffffff')
    tab.view = view
    this.watch(tab, view)
    return view
  }

  private watch(tab: Tab, view: WebContentsView): void {
    const contents = view.webContents
    // Without this WebRTC can reach any host over UDP, which the request filter does not see.
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
    const history = (): void => {
      tab.state.canGoBack = contents.navigationHistory.canGoBack()
      tab.state.canGoForward = contents.navigationHistory.canGoForward()
    }
    // A page's new window opens as a tab when its host is allowed, otherwise in the system browser.
    contents.setWindowOpenHandler(({ url }) => {
      if (isBrowserUrlAllowed(url, this.allowed)) {
        try {
          this.open(url)
        } catch {
          // At the tab limit the page's window is not opened.
        }
      } else {
        this.external(url)
      }
      return { action: 'deny' }
    })
    // A link to a host that is not allowed leaves for the system browser instead of the tab.
    contents.on('will-navigate', (event) => {
      if (isBrowserUrlAllowed(event.url, this.allowed)) return
      event.preventDefault()
      this.external(event.url)
    })
    contents.on('did-start-loading', () => {
      tab.state.loading = true
      this.changed()
    })
    contents.on('did-stop-loading', () => {
      tab.state.loading = false
      history()
      this.changed()
    })
    contents.on('did-navigate', (_event, url) => {
      tab.state = { ...tab.state, url, blocked: null, error: null, blockedHosts: [] }
      history()
      this.changed()
    })
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return
      tab.state.url = url
      history()
      this.changed()
    })
    contents.on('page-title-updated', (_event, title) => {
      tab.state.title = title
      this.changed()
    })
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || QUIET_LOAD_ERRORS.has(code)) return
      tab.state = { ...tab.state, url: url || tab.state.url, loading: false, error: `Could not open ${url || 'the page'} (${description || code}).` }
      this.changed()
    })
    contents.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return
      tab.state = { ...tab.state, loading: false, error: 'The page stopped working. Reload to open it again.' }
      this.changed()
    })
    contents.on('before-input-event', (event, input) => {
      if (this.options.windowKey?.(input)) {
        event.preventDefault()
        return
      }
      if (input.type !== 'keyDown') return
      const key = input.key.toLowerCase()
      const modifier = input.control || input.meta
      if (input.key === 'F5' || (modifier && !input.shift && key === 'r')) {
        event.preventDefault()
        this.act(tab.id, 'reload')
      } else if (modifier && input.shift && key === 'i') {
        event.preventDefault()
        this.act(tab.id, 'devtools')
      } else if (input.alt && input.key === 'ArrowLeft') {
        event.preventDefault()
        this.act(tab.id, 'back')
      } else if (input.alt && input.key === 'ArrowRight') {
        event.preventDefault()
        this.act(tab.id, 'forward')
      }
    })
    contents.on('context-menu', (_event, params) => {
      const items: MenuItemConstructorOptions[] = []
      const link = safeExternalWebUrl(params.linkURL)
      if (link) {
        items.push(
          { label: 'Open link in system browser', click: () => this.external(link) },
          { label: 'Copy link address', click: () => clipboard.writeText(link) },
          { type: 'separator' },
        )
      }
      if (params.isEditable) {
        items.push(
          { role: 'cut', enabled: params.editFlags.canCut },
          { role: 'copy', enabled: params.editFlags.canCopy },
          { role: 'paste', enabled: params.editFlags.canPaste },
          { type: 'separator' },
        )
      } else if (params.selectionText) {
        items.push({ role: 'copy' }, { type: 'separator' })
      }
      items.push(
        { label: 'Back', enabled: contents.navigationHistory.canGoBack(), click: () => this.act(tab.id, 'back') },
        { label: 'Forward', enabled: contents.navigationHistory.canGoForward(), click: () => this.act(tab.id, 'forward') },
        { label: 'Reload', click: () => this.act(tab.id, 'reload') },
        { type: 'separator' },
        { label: 'Inspect element', click: () => contents.inspectElement(params.x, params.y) },
      )
      const window = this.options.window()
      Menu.buildFromTemplate(items).popup(window ? { window } : {})
    })
  }

  /** Lays the active tab's page over the panel, or takes it off the window. */
  private syncView(): void {
    const window = this.options.window()
    const usable = window && !window.isDestroyed() ? window : null
    const tab = this.tabs.find((item) => item.id === this.activeId)
    const want = usable && this.bounds && tab?.view && !tab.view.webContents.isDestroyed() &&
      tab.state.url && !tab.state.blocked && !tab.state.error ? tab.view : null
    if (this.shown && this.shown !== want) {
      if (usable) usable.contentView.removeChildView(this.shown)
      this.shown = null
    }
    if (!want || !usable || !this.bounds) return
    if (this.shown !== want) {
      usable.contentView.addChildView(want)
      this.shown = want
    }
    // The page's CSS pixels are scaled by the window's zoom; the view is placed in the window's own units.
    const zoom = usable.webContents.getZoomFactor()
    const x = Math.round(this.bounds.x * zoom)
    const y = Math.round(this.bounds.y * zoom)
    want.setBounds({
      x,
      y,
      width: Math.max(0, Math.round((this.bounds.x + this.bounds.width) * zoom) - x),
      height: Math.max(0, Math.round((this.bounds.y + this.bounds.height) * zoom) - y),
    })
  }

  private destroy(tab: Tab): void {
    const view = tab.view
    tab.view = null
    if (!view) return
    if (this.shown === view) {
      const window = this.options.window()
      if (window && !window.isDestroyed()) window.contentView.removeChildView(view)
      this.shown = null
    }
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  /** Puts the page where it belongs and tells the window, once for a burst of changes. */
  private changed(): void {
    this.syncView()
    if (this.sendTimer) return
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null
      this.options.send(this.state())
    }, 16)
  }
}
