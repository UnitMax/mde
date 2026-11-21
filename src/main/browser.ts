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
/** Float noise below this is not a pixel: 125.0000001 stays 125 rather than growing to 126. */
const EDGE_SLACK = 0.001

export const BROWSER_FILE = 'browser.json'

/** Chromium's net error codes the browser does not report: a load it cancelled itself, or one it refused. */
const QUIET_LOAD_ERRORS = new Set([-3, -20])

const UNSAVED_OFF = 'WebRTC is off, but the choice could not be saved, so MDE will start with it on next time. Try again.'

const WORKERS_FAILED =
  'The MDE browser could not remove the service workers of earlier pages, so no page opens while WebRTC is off. ' +
  'Try again, or clear the browsing data in Settings → Browser.'

/**
 * Chromium's connection allowlist (Chromium 152 and later) with every address allowed and redirects followed, so all
 * it changes is its default of blocking every WebRTC connection. Used when the server sent no allowlist of its own.
 */
export const BLOCK_WEBRTC_HEADER = '("*://*:*/*"); redirects=allow'

/** Whether a request fetches a service worker's script, which Chromium marks with `Service-Worker: script`. */
export function isServiceWorkerScript(headers: Record<string, string> | undefined): boolean {
  return Object.entries(headers ?? {}).some(([name, value]) => name.toLowerCase() === 'service-worker' && value === 'script')
}

/**
 * Where the first member of a structured-field list ends: at the first comma outside a quoted string, or the end.
 * Chromium applies only that member of a `Connection-Allowlist`.
 */
function firstMemberEnd(value: string): number {
  let quoted = false
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (quoted && char === '\\') index++
    else if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) return index
  }
  return value.length
}

/**
 * A response's headers with WebRTC blocked. A server's own allowlist is kept whole, with `webrtc=block` put last on
 * its first member, the one Chromium applies: a later parameter replaces an earlier one, so it overrides any
 * `webrtc=allow`, while the server's addresses and redirect rule still apply. The rest of the list is passed on as
 * it came, so a list Chromium would refuse as malformed (and then block every connection) stays malformed. A server
 * that sent none gets one that blocks WebRTC and nothing else.
 */
export function withoutWebRTC(headers: Record<string, string[]> | undefined): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  const server: string[] = []
  for (const [name, values] of Object.entries(headers ?? {})) {
    if (name.toLowerCase() !== 'connection-allowlist') result[name] = values
    else server.push(...values)
  }
  const value = server.join(', ').trim()
  const end = firstMemberEnd(value)
  result['Connection-Allowlist'] = [
    value ? `${value.slice(0, end).trimEnd()};webrtc=block${value.slice(end)}` : BLOCK_WEBRTC_HEADER,
  ]
  return result
}

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
  /**
   * The page under the "allow this host?" page after its view was rebuilt under a new WebRTC rule; Go back loads it
   * again.
   */
  returnUrl?: string
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
  private enabled = false
  private changingEnabled = false
  private webrtc = false
  /** What browser.json says about WebRTC, which differs from `webrtc` after a choice that could not be saved. */
  private savedWebRTC = false
  private changingWebRTC = false
  /** The write of browser.json under way; writes run one after another, so the last one written is the newest. */
  private writing: Promise<void> = Promise.resolve()
  /**
   * Whether the service workers of earlier pages are gone. While WebRTC is off no page loads until they are: one
   * could serve a page without the allowlist.
   */
  private workers: 'removing' | 'removed' | 'failed' = 'removing'
  private workerAttempt = 0
  private installed = false

  constructor(private readonly options: MdeBrowserOptions) {}

  /** Reads whether the browser is on and the allowed hosts. A missing or unreadable file is off, with no hosts. */
  async load(): Promise<void> {
    this.enabled = false
    this.webrtc = false
    try {
      const raw = JSON.parse(await fs.readFile(this.options.file, 'utf8')) as {
        enabled?: unknown
        webrtc?: unknown
        allowedHosts?: unknown
      }
      this.enabled = raw.enabled === true
      this.webrtc = raw.webrtc === true
      this.savedWebRTC = this.webrtc
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
      // While the browser is off its session sends nothing, whatever asks; nor while WebRTC is off and service
      // workers of earlier pages may still be there.
      if (!this.enabled || !this.workersGone()) {
        callback({ cancel: true })
        return
      }
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
    // WebRTC is off unless the person turned it on: every response carries a connection allowlist that allows every
    // address (the request filter above decides which ones) but no WebRTC. Pages and workers read it from their own
    // response; frames and popups without one (about:blank, srcdoc, blob:) inherit it from the page that made them.
    session.webRequest.onHeadersReceived((details, callback) => {
      if (this.webrtc) {
        callback({})
        return
      }
      callback({ responseHeaders: withoutWebRTC(details.responseHeaders) })
    })
    // A service worker can answer a page load with a response it made itself, which never passes the line above, so
    // with WebRTC off no service worker is registered, and those registered before are removed.
    session.webRequest.onBeforeSendHeaders((details, callback) => {
      callback(!this.webrtc && isServiceWorkerScript(details.requestHeaders) ? { cancel: true } : {})
    })
    void this.removeServiceWorkers()
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
      enabled: this.enabled,
      webrtc: this.webrtc,
      webrtcUnsaved: !this.changingWebRTC && this.webrtc !== this.savedWebRTC,
      tabs: this.tabs.map((tab) => ({ ...tab.state, blockedHosts: [...tab.state.blockedHosts] })),
      activeId: this.activeId,
      allowedHosts: [...this.allowed],
    }
  }

  /**
   * Turns the browser on or off and keeps the choice. Off closes every tab and refuses every request of its session;
   * the allowed hosts and the browsing data stay.
   */
  async setEnabled(enabled: boolean): Promise<BrowserState> {
    if (this.changingEnabled) throw new Error('The browser setting is being saved.')
    if (enabled === this.enabled) return this.state()
    this.changingEnabled = true
    try {
      // Set first, so a host saved meanwhile writes the new value too; put back if it could not be kept.
      this.enabled = enabled
      try {
        await this.save()
      } catch (error) {
        this.enabled = !enabled
        throw error
      }
      if (!enabled) {
        this.dispose()
        this.bounds = null
      }
      this.changed()
      return this.state()
    } finally {
      this.changingEnabled = false
    }
  }

  /**
   * Allows or blocks WebRTC in the browser's pages and keeps the choice. A page keeps the rule it was loaded with, so
   * every page is closed and its tab opened again under the new rule, including a page kept under an "allow this
   * host?" page. Turning it off first removes the service workers; if that fails no page loads until it succeeds.
   */
  async setWebRTC(allowed: boolean): Promise<BrowserState> {
    if (this.changingWebRTC) throw new Error('The browser setting is being saved.')
    if (allowed === this.webrtc && allowed === this.savedWebRTC) return this.state()
    this.changingWebRTC = true
    try {
      if (!allowed && !this.webrtc) {
        // Off already, but browser.json still says on, since saving failed: only the saving is tried again.
        try {
          await this.save()
        } catch {
          throw new Error(UNSAVED_OFF)
        } finally {
          this.changed()
        }
        return this.state()
      }
      if (allowed) {
        // Kept first and only then in force, within the same write, so no later write can come between: a failed
        // save changes nothing, and no page ever loads with WebRTC allowed unless the choice was kept.
        await this.save({ webrtc: true, written: () => { this.webrtc = true } })
        this.reopenPages(this.closePages())
        this.changed()
        return this.state()
      }
      // Taking WebRTC away is in force at once, before anything is awaited, whether or not the choice can be kept.
      this.webrtc = false
      // Workers registered while WebRTC was allowed are there now, so nothing loads until they are removed.
      this.workers = 'removing'
      const pages = this.closePages()
      let saved = true
      try {
        await this.save()
      } catch {
        saved = false
      }
      await this.removeServiceWorkers()
      this.reopenPages(pages)
      this.changed()
      if (!saved) throw new Error(UNSAVED_OFF)
      if (!this.workersGone()) throw new Error(WORKERS_FAILED)
      return this.state()
    } finally {
      this.changingWebRTC = false
    }
  }

  /** Whether pages may load as far as service workers go: WebRTC is allowed, or the earlier ones are gone. */
  private workersGone(): boolean {
    return this.webrtc || this.workers === 'removed'
  }

  /** Closes every tab's page, and says which address each tab showed (or kept under its "allow this host?" page). */
  private closePages(): Map<string, string> {
    const pages = new Map<string, string>()
    for (const tab of this.tabs) {
      const contents = tab.view?.webContents
      const under = contents && !contents.isDestroyed() ? contents.getURL() : ''
      if (tab.state.blocked) {
        if (under) tab.returnUrl = under
      } else if (tab.state.url) {
        pages.set(tab.id, tab.state.url)
      }
      this.destroy(tab)
    }
    return pages
  }

  /** Opens the closed pages again in their tabs, which stay in their order with the same tab active. */
  private reopenPages(pages: Map<string, string>): void {
    const active = this.activeId
    for (const [id, url] of pages) {
      try {
        this.navigate(id, url)
      } catch (error) {
        const tab = this.tabs.find((item) => item.id === id)
        if (tab) tab.state = { ...tab.state, loading: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
    this.activeId = active
  }

  /** Removes every service worker of the browser's session, unless WebRTC is allowed, and notes how that went. */
  private async removeServiceWorkers(): Promise<void> {
    if (this.webrtc) return
    const attempt = ++this.workerAttempt
    this.workers = 'removing'
    let removed = false
    try {
      await this.options.session.clearStorageData({ storages: ['serviceworkers'] })
      removed = true
    } catch {
      // Reported by the next page that tries to open.
    }
    // A later attempt, or a clearing of all data, has the last word.
    if (attempt === this.workerAttempt) this.workers = removed ? 'removed' : 'failed'
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
    if (!this.workersGone()) {
      if (this.workers !== 'failed') throw new Error('The MDE browser is still getting ready. Try again.')
      // Tried again on each attempt, so a passing failure clears itself.
      void this.removeServiceWorkers()
      throw new Error(WORKERS_FAILED)
    }
    this.activeId = tab.id
    tab.returnUrl = undefined
    tab.state = { ...tab.state, url, title: host, error: null, blocked: null, blockedHosts: [] }
    if (!isHostAllowed(host, this.allowed)) {
      tab.state.blocked = { url, host }
      tab.state.loading = false
      tab.state.canGoBack = true
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
        if (tab.state.blocked) {
          this.leaveBlocked(tab)
          return
        }
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

  /**
   * Forgets the browser's cookies, storage and cache: every login to the apps opened in it. Every step is tried; if
   * any failed, this throws, so nothing reports the data cleared when part of it is left.
   */
  async clearData(): Promise<void> {
    const { session } = this.options
    const results = await Promise.allSettled([session.clearStorageData(), session.clearCache(), session.clearAuthCache()])
    // Clearing all storage removes the service workers too.
    if (results[0]?.status === 'fulfilled') {
      this.workerAttempt++
      this.workers = 'removed'
    }
    if (results.some((result) => result.status === 'rejected')) {
      throw new Error('Some of the MDE browser\'s data could not be cleared. Try again.')
    }
  }

  dispose(): void {
    if (this.sendTimer) clearTimeout(this.sendTimer)
    this.sendTimer = null
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
    if (!this.enabled) throw new Error('Enable the MDE browser in Settings first.')
    if (this.tabs.length >= BROWSER_TAB_LIMIT) throw new Error(`Close a tab first: the MDE browser keeps up to ${BROWSER_TAB_LIMIT}.`)
    const id = `brt_${randomUUID()}`
    const tab: Tab = { id, view: null, state: emptyTab(id) }
    this.tabs.push(tab)
    this.activeId = id
    return tab
  }

  /**
   * Writes browser.json after any write already under way, from the values in force when its turn comes, so a slow
   * earlier write cannot put back a value changed since. `webrtc` writes a choice before it is in force, and
   * `written` puts it in force once written, before the next write starts.
   */
  private save(next: { webrtc?: boolean; written?: () => void } = {}): Promise<void> {
    const write = this.writing.catch(() => undefined).then(async () => {
      const webrtc = next.webrtc ?? this.webrtc
      await writeJsonAtomic(this.options.file, {
        version: 1,
        enabled: this.enabled,
        webrtc,
        allowedHosts: this.allowed,
      })
      this.savedWebRTC = webrtc
      next.written?.()
    })
    this.writing = write
    return write
  }

  /**
   * Hands an address to the system browser, only from the person's own choice (the link menu): only http and https,
   * and not more than once a second.
   */
  private external(value: string): void {
    const url = safeExternalWebUrl(value)
    const now = Date.now()
    if (!url || now - this.lastExternal < EXTERNAL_INTERVAL_MS) return
    this.lastExternal = now
    this.options.openExternal(url)
  }

  /** Opens a new tab that shows the "allow this host?" page for an address, contacting nothing. */
  private openBlocked(url: string): void {
    if (!browserUrl(url)) return
    const tab = this.addTab()
    this.navigate(tab.id, url)
  }

  /**
   * Leaves the "allow this host?" page without contacting the host: back to the page still loaded under it, or, when
   * there is none (a typed address, a page's new window), to the tab's start page.
   */
  private leaveBlocked(tab: Tab): void {
    const contents = tab.view?.webContents
    const url = contents && !contents.isDestroyed() ? contents.getURL() : ''
    if (contents && url) {
      tab.state = { ...tab.state, url, title: contents.getTitle() || tab.state.title, blocked: null, error: null }
      tab.state.canGoBack = contents.navigationHistory.canGoBack()
      tab.state.canGoForward = contents.navigationHistory.canGoForward()
    } else if (tab.returnUrl) {
      // The page under it was closed when the WebRTC rule changed: it loads again, under the rule now in force.
      const returnUrl = tab.returnUrl
      this.navigate(tab.id, returnUrl)
      return
    } else {
      this.destroy(tab)
      tab.state = emptyTab(tab.id)
    }
    this.changed()
  }

  private refused(contentsId: number | undefined, url: string, host: string | null, mainFrame: boolean): void {
    const tab = this.tabs.find((item) => item.view && !item.view.webContents.isDestroyed() && item.view.webContents.id === contentsId)
    if (!tab) return
    if (mainFrame) {
      if (host) {
        tab.state = { ...tab.state, url, title: host, blocked: { url, host }, loading: false, canGoBack: true }
      }
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
    // With WebRTC allowed in Settings, this still keeps it from reaching any host over plain UDP, which the request
    // filter does not see.
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
    const history = (): void => {
      // The "allow this host?" page can always be left with Back, whatever the page's own history says.
      tab.state.canGoBack = Boolean(tab.state.blocked) || contents.navigationHistory.canGoBack()
      tab.state.canGoForward = contents.navigationHistory.canGoForward()
    }
    // A page's new window opens as a tab. A host that is not allowed gets the "allow this host?" page in that tab:
    // the page itself never hands an address to the system browser, so it cannot send data to a host by navigating.
    contents.setWindowOpenHandler(({ url }) => {
      try {
        if (isBrowserUrlAllowed(url, this.allowed)) this.open(url)
        else this.openBlocked(url)
      } catch {
        // At the tab limit the page's window is not opened.
      }
      return { action: 'deny' }
    })
    // A link to a host that is not allowed shows the "allow this host?" page; Back returns to the page.
    contents.on('will-navigate', (event) => {
      if (isBrowserUrlAllowed(event.url, this.allowed)) return
      event.preventDefault()
      this.refused(contents.id, event.url, browserHost(event.url), true)
    })
    // No client certificate is ever offered to a page, so no site can sign the person in with one unasked.
    contents.on('select-client-certificate', (event, _url, _list, callback) => {
      event.preventDefault()
      ;(callback as () => void)()
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
      // Chromium ends a page's process when a frame without its own address (about:blank, srcdoc, blob:) tries WebRTC
      // under the allowlist, so a killed page with WebRTC off most likely did that.
      const error = details.reason === 'killed' && !this.webrtc
        ? 'The page stopped working, perhaps because it used WebRTC, which is off in Settings → Browser. Reload to open it again.'
        : 'The page stopped working. Reload to open it again.'
      tab.state = { ...tab.state, loading: false, error }
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
    // The page's CSS pixels are scaled by the window's zoom; the view is placed in the window's own whole units.
    // Rounding outwards keeps the view over every pixel of the panel, so no sliver of the panel shows at an edge.
    const zoom = usable.webContents.getZoomFactor()
    const x = Math.floor(this.bounds.x * zoom + EDGE_SLACK)
    const y = Math.floor(this.bounds.y * zoom + EDGE_SLACK)
    want.setBounds({
      x,
      y,
      width: Math.max(0, Math.ceil((this.bounds.x + this.bounds.width) * zoom - EDGE_SLACK) - x),
      height: Math.max(0, Math.ceil((this.bounds.y + this.bounds.height) * zoom - EDGE_SLACK) - y),
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
