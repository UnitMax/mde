import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  class FakeContents {
    static next = 1
    id = FakeContents.next++
    destroyed = false
    listeners = new Map<string, Listener[]>()
    openHandler: ((details: { url: string }) => { action: string }) | null = null
    loadURL = vi.fn(async (_url: string) => undefined)
    getURL = vi.fn(() => '')
    getTitle = vi.fn(() => '')
    reload = vi.fn()
    stop = vi.fn()
    close = vi.fn(() => { this.destroyed = true })
    openDevTools = vi.fn()
    closeDevTools = vi.fn()
    isDevToolsOpened = vi.fn(() => false)
    setWebRTCIPHandlingPolicy = vi.fn()
    navigationHistory = { canGoBack: () => false, canGoForward: () => false, goBack: vi.fn(), goForward: vi.fn() }
    isDestroyed(): boolean { return this.destroyed }
    on(name: string, listener: Listener): void { this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]) }
    emit(name: string, ...args: unknown[]): void { for (const listener of this.listeners.get(name) ?? []) listener(...args) }
    setWindowOpenHandler(handler: (details: { url: string }) => { action: string }): void { this.openHandler = handler }
  }
  const views: WebContentsView[] = []
  class WebContentsView {
    webContents = new FakeContents()
    setBounds = vi.fn()
    setBackgroundColor = vi.fn()
    constructor(readonly options: { webPreferences: Record<string, unknown> }) { views.push(this) }
  }
  return { WebContentsView, views, Menu: { buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })) }, clipboard: { writeText: vi.fn() } }
})
vi.mock('electron', () => electron)

import { MdeBrowser } from '../src/main/browser'
import type { BrowserState } from '../src/shared/browser'

type RequestHandler = (details: { url: string; webContentsId?: number; resourceType: string }, callback: (response: { cancel?: boolean }) => void) => void
type HeadersHandler = (
  details: { responseHeaders?: Record<string, string[]> },
  callback: (response: { responseHeaders?: Record<string, string[]> }) => void,
) => void
type SendHeadersHandler = (details: { requestHeaders: Record<string, string> }, callback: (response: { cancel?: boolean }) => void) => void

function fakeSession() {
  const session = {
    requestHandler: null as RequestHandler | null,
    downloadHandler: null as ((event: unknown, item: unknown, contents: unknown) => void) | null,
    headersHandler: null as HeadersHandler | null,
    sendHeadersHandler: null as SendHeadersHandler | null,
    webRequest: {
      onBeforeRequest: vi.fn((handler: RequestHandler) => { session.requestHandler = handler }),
      onHeadersReceived: vi.fn((handler: HeadersHandler) => { session.headersHandler = handler }),
      onBeforeSendHeaders: vi.fn((handler: SendHeadersHandler) => { session.sendHeadersHandler = handler }),
    },
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(),
    setSpellCheckerEnabled: vi.fn(),
    on: vi.fn((name: string, handler: (event: unknown, item: unknown, contents: unknown) => void) => {
      if (name === 'will-download') session.downloadHandler = handler
    }),
    clearStorageData: vi.fn(async (_options?: { storages?: string[] }) => undefined),
    clearCache: vi.fn(async () => undefined),
    clearAuthCache: vi.fn(async () => undefined),
  }
  return session
}

function fakeWindow() {
  return {
    isDestroyed: () => false,
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    webContents: { getZoomFactor: () => 1.25 },
  }
}

let dir: string
let session: ReturnType<typeof fakeSession>
let window: ReturnType<typeof fakeWindow>
let openExternal: ReturnType<typeof vi.fn<(url: string) => void>>
let sent: BrowserState[]

function make(): MdeBrowser {
  const browser = new MdeBrowser({
    session: session as never,
    window: () => window as never,
    file: join(dir, 'browser.json'),
    openExternal,
    send: (state) => sent.push(state),
  })
  browser.install()
  return browser
}

async function enabledBrowser(): Promise<MdeBrowser> {
  const browser = make()
  await browser.setEnabled(true)
  return browser
}

/** Runs one request of a page through the session's filter; true when it was let through. */
function request(url: string, contentsId: number | undefined, resourceType = 'script'): boolean {
  let cancelled: boolean | undefined
  session.requestHandler!({ url, webContentsId: contentsId, resourceType }, (response) => { cancelled = response.cancel === true })
  return cancelled === false
}

/** The headers a page's response arrives with after the session's own changes. */
function responseHeaders(headers: Record<string, string[]>): Record<string, string[]> {
  let result: Record<string, string[]> | undefined
  session.headersHandler!({ responseHeaders: headers }, (response) => { result = response.responseHeaders ?? headers })
  return result!
}

/** Whether the session sends a request with these headers, rather than cancelling it. */
function sends(headers: Record<string, string>): boolean {
  let cancelled: boolean | undefined
  session.sendHeadersHandler!({ requestHeaders: headers }, (response) => { cancelled = response.cancel === true })
  return cancelled === false
}

/** Lets pending promises (a removal of service workers) finish. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** The calls that removed the service workers only. */
function serviceWorkerClears(): number {
  return session.clearStorageData.mock.calls.filter(([options]) => options?.storages?.join() === 'serviceworkers').length
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mde-browser-'))
  session = fakeSession()
  window = fakeWindow()
  openExternal = vi.fn<(url: string) => void>()
  sent = []
  electron.views.length = 0
})

afterEach(async () => {
  vi.useRealTimers()
  await rm(dir, { recursive: true, force: true })
})

describe('MDE browser (main process)', () => {
  it('requires a persisted opt-in and closes every page when disabled', async () => {
    const browser = make()
    await browser.load()
    expect(browser.state().enabled).toBe(false)
    expect(() => browser.open('localhost:3000')).toThrow(/Enable/)
    expect(request('http://localhost:3000', undefined)).toBe(false)
    await browser.setEnabled(true)
    const restored = make()
    await restored.load()
    restored.open('localhost:3000')
    await restored.allowHost('staging.test')
    await restored.setEnabled(false)
    expect(electron.views[0]!.webContents.close).toHaveBeenCalled()
    expect(restored.state()).toMatchObject({ enabled: false, tabs: [] })
    expect(() => restored.newTab()).toThrow(/Enable/)
    await browser.load()
    expect(browser.state().enabled).toBe(false)
    // The choice is kept in browser.json, with the allowed hosts, which turning it off leaves alone.
    expect(JSON.parse(await readFile(join(dir, 'browser.json'), 'utf8'))).toEqual({ version: 1, enabled: false, webrtc: false, allowedHosts: ['staging.test'] })
  })

  it('puts its own policy on its session: no permissions, no spell check, every request filtered', () => {
    make()
    expect(session.setPermissionRequestHandler).toHaveBeenCalled()
    expect(session.setPermissionCheckHandler).toHaveBeenCalled()
    expect(session.setDevicePermissionHandler).toHaveBeenCalled()
    expect(session.setSpellCheckerEnabled).toHaveBeenCalledWith(false)
    expect(session.requestHandler).toBeTypeOf('function')
  })

  it('opens a local address in a sandboxed page of its own session', async () => {
    const browser = await enabledBrowser()
    const state = browser.open('localhost:5173')
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]).toMatchObject({ url: 'http://localhost:5173/', blocked: null })
    const view = electron.views[0]!
    expect(view.options.webPreferences).toMatchObject({ session, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false })
    expect(view.options.webPreferences).not.toHaveProperty('preload')
    expect(view.webContents.loadURL).toHaveBeenCalledWith('http://localhost:5173/')
    expect(view.webContents.setWebRTCIPHandlingPolicy).toHaveBeenCalledWith('disable_non_proxied_udp')
  })

  it('does not contact a host that is not allowed, and asks instead', async () => {
    const browser = await enabledBrowser()
    const state = browser.open('https://staging.example.test/app')
    expect(state.tabs[0]!.blocked).toEqual({ url: 'https://staging.example.test/app', host: 'staging.example.test' })
    // No page was even made, so nothing was sent.
    expect(electron.views).toHaveLength(0)
  })

  it('refuses requests to other hosts before they are sent and names them on the tab', async () => {
    const browser = await enabledBrowser()
    browser.open('http://localhost:3000/')
    const contents = electron.views[0]!.webContents
    expect(request('http://localhost:3000/main.js', contents.id)).toBe(true)
    expect(request('ws://localhost:3000/hmr', contents.id)).toBe(true)
    expect(request('https://cdn.example.com/lib.js', contents.id)).toBe(false)
    expect(request('https://cdn.example.com/other.js', contents.id)).toBe(false)
    expect(request('file:///etc/passwd', contents.id)).toBe(false)
    expect(browser.state().tabs[0]!.blockedHosts).toEqual(['cdn.example.com'])
    // A sign-in redirect of the page itself turns into the "allow this host?" page.
    expect(request('https://login.example.com/sso', contents.id, 'mainFrame')).toBe(false)
    expect(browser.state().tabs[0]!.blocked).toEqual({ url: 'https://login.example.com/sso', host: 'login.example.com' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(sent.at(-1)?.tabs[0]?.blocked?.host).toBe('login.example.com')
  })

  it('allows a host for good, opens the refused page and reloads pages that were refused it, without switching tabs', async () => {
    const browser = await enabledBrowser()
    browser.open('http://localhost:3000/')
    const local = electron.views[0]!.webContents
    request('https://staging.test/api', local.id)
    const blocked = browser.open('https://staging.test/app').tabs[1]!
    browser.select(browser.state().tabs[0]!.id)
    const state = await browser.allowHost('Staging.Test:8443')
    expect(state.allowedHosts).toEqual(['staging.test'])
    expect(state.activeId).toBe(state.tabs[0]!.id)
    expect(state.tabs.find((tab) => tab.id === blocked.id)!.blocked).toBeNull()
    expect(electron.views[1]!.webContents.loadURL).toHaveBeenCalledWith('https://staging.test/app')
    expect(local.reload).toHaveBeenCalled()
    expect(JSON.parse(await readFile(join(dir, 'browser.json'), 'utf8'))).toEqual({ version: 1, enabled: true, webrtc: false, allowedHosts: ['staging.test'] })
    expect(request('https://staging.test/api', local.id)).toBe(true)
    await browser.removeHost('staging.test')
    expect(request('https://staging.test/api', local.id)).toBe(false)
  })

  it('reads whether it is on and the allowed hosts back, dropping local, invalid and repeated entries', async () => {
    await writeFile(join(dir, 'browser.json'), JSON.stringify({ enabled: true, allowedHosts: ['a.test', 'localhost', '*.bad', 'A.test', 42, 'b.test:9000'] }))
    const browser = make()
    await browser.load()
    expect(browser.state()).toMatchObject({ enabled: true, allowedHosts: ['a.test', 'b.test'] })
    // Only a literal true turns it on.
    await writeFile(join(dir, 'browser.json'), JSON.stringify({ enabled: 'true', webrtc: 'true', allowedHosts: [] }))
    await browser.load()
    expect(browser.state()).toMatchObject({ enabled: false, webrtc: false })
    await writeFile(join(dir, 'browser.json'), JSON.stringify({ enabled: true, webrtc: true, allowedHosts: [] }))
    await browser.load()
    expect(browser.state()).toMatchObject({ enabled: true, webrtc: true })
  })

  it('blocks WebRTC by default: every response carries an allowlist, keeping the server\'s own rules', async () => {
    const browser = make()
    await browser.load()
    expect(browser.state().webrtc).toBe(false)
    expect(responseHeaders({ 'Content-Type': ['text/html'] })).toEqual({
      'Content-Type': ['text/html'],
      'Connection-Allowlist': ['("*://*:*/*"); redirects=allow'],
    })
    // The server's addresses and redirect rule stay; the last webrtc parameter wins, so its webrtc=allow does not.
    expect(responseHeaders({ 'connection-allowlist': ['(response-origin "https://api.test"); webrtc=allow '] })).toEqual({
      'Connection-Allowlist': ['(response-origin "https://api.test"); webrtc=allow;webrtc=block'],
    })
    // Chromium reads only the first member of the list; a comma inside a quoted pattern does not end it.
    expect(responseHeaders({ 'Connection-Allowlist': ['("https://a.test/x,y"); redirects=allow, ("*://*:*/*"); webrtc=allow'] })).toEqual({
      'Connection-Allowlist': ['("https://a.test/x,y"); redirects=allow;webrtc=block'],
    })
    expect(responseHeaders({ 'Connection-Allowlist': ['(response-origin)', '("*://*:*/*"); webrtc=allow'] })).toEqual({
      'Connection-Allowlist': ['(response-origin);webrtc=block'],
    })
  })

  it('registers no service worker while WebRTC is off and removes those registered before', async () => {
    const browser = make()
    await browser.load()
    // A service worker could answer a page load itself, without the allowlist.
    expect(serviceWorkerClears()).toBe(1)
    expect(sends({ 'Service-Worker': 'script' })).toBe(false)
    expect(sends({ Accept: 'text/html' })).toBe(true)
  })

  it('opens no page while the service workers of earlier pages could not be removed, and tries again', async () => {
    session.clearStorageData.mockRejectedValueOnce(new Error('busy'))
    const browser = await enabledBrowser()
    await settle()
    expect(() => browser.open('http://localhost:3000/')).toThrow(/could not remove the service workers/)
    expect(request('http://localhost:3000/', undefined)).toBe(false)
    // The failed attempt started another, which worked.
    await settle()
    expect(browser.state().tabs).toHaveLength(1)
    browser.navigate(browser.state().tabs[0]!.id, 'http://localhost:3000/')
    expect(electron.views[0]!.webContents.loadURL).toHaveBeenCalledWith('http://localhost:3000/')
    expect(request('http://localhost:3000/', undefined)).toBe(true)
  })

  it('lets pages load again once clearing the browsing data removed the service workers', async () => {
    session.clearStorageData.mockRejectedValueOnce(new Error('busy')).mockRejectedValueOnce(new Error('busy'))
    const browser = await enabledBrowser()
    await settle()
    expect(() => browser.open('http://localhost:3000/')).toThrow(/could not remove/)
    await settle()
    await browser.clearData()
    expect(request('http://localhost:3000/', undefined)).toBe(true)
  })

  it('opens every page again under the new rule when WebRTC is turned on or off, and keeps the choice', async () => {
    const browser = await enabledBrowser()
    const first = browser.open('http://localhost:3000/').tabs[0]!
    browser.open('http://localhost:5173/')
    browser.select(first.id)
    const before = electron.views.map((view) => view.webContents)
    expect((await browser.setWebRTC(true)).webrtc).toBe(true)
    // A page keeps the rule it was loaded with, so the old pages are closed, not reloaded.
    for (const contents of before) expect(contents.close).toHaveBeenCalled()
    expect(electron.views).toHaveLength(4)
    expect(electron.views[2]!.webContents.loadURL).toHaveBeenCalledWith('http://localhost:3000/')
    expect(electron.views[3]!.webContents.loadURL).toHaveBeenCalledWith('http://localhost:5173/')
    expect(browser.state().activeId).toBe(first.id)
    expect(responseHeaders({ 'Content-Type': ['text/html'] })).toEqual({ 'Content-Type': ['text/html'] })
    expect(sends({ 'Service-Worker': 'script' })).toBe(true)
    expect(JSON.parse(await readFile(join(dir, 'browser.json'), 'utf8'))).toMatchObject({ webrtc: true })
    const clears = serviceWorkerClears()
    await browser.setWebRTC(false)
    expect(serviceWorkerClears()).toBe(clears + 1)
    expect(electron.views[2]!.webContents.close).toHaveBeenCalled()
    expect(electron.views).toHaveLength(6)
    expect(responseHeaders({})).toHaveProperty('Connection-Allowlist')
    expect(sends({ 'service-worker': 'script' })).toBe(false)
    expect(JSON.parse(await readFile(join(dir, 'browser.json'), 'utf8'))).toMatchObject({ webrtc: false })
  })

  it('closes a page kept under the "allow this host?" page when WebRTC is turned off, and Go back opens it anew', async () => {
    const browser = await enabledBrowser()
    await browser.setWebRTC(true)
    const tab = browser.open('http://localhost:3000/').tabs[0]!
    const old = electron.views.at(-1)!.webContents
    old.getURL.mockReturnValue('http://localhost:3000/')
    // The page navigates to a host that is not allowed: the page stays alive under the "allow this host?" page.
    const event = { url: 'https://other.test/', preventDefault: vi.fn() }
    old.emit('will-navigate', event)
    expect(browser.state().tabs[0]!.blocked).toMatchObject({ host: 'other.test' })
    await browser.setWebRTC(false)
    expect(old.close).toHaveBeenCalled()
    expect(browser.state().tabs[0]!.blocked).toMatchObject({ host: 'other.test' })
    const views = electron.views.length
    browser.act(tab.id, 'back')
    expect(electron.views).toHaveLength(views + 1)
    expect(electron.views.at(-1)!.webContents.loadURL).toHaveBeenCalledWith('http://localhost:3000/')
    expect(browser.state().tabs[0]).toMatchObject({ blocked: null, url: 'http://localhost:3000/' })
  })

  it('opens the pages again under the old rule when the WebRTC choice could not be saved', async () => {
    const browser = await enabledBrowser()
    browser.open('http://localhost:3000/')
    const old = electron.views.at(-1)!.webContents
    await rm(dir, { recursive: true, force: true })
    await writeFile(dir, '')
    await expect(browser.setWebRTC(true)).rejects.toThrow()
    await rm(dir, { force: true })
    expect(browser.state().webrtc).toBe(false)
    expect(old.close).toHaveBeenCalled()
    expect(electron.views.at(-1)!.webContents.loadURL).toHaveBeenCalledWith('http://localhost:3000/')
    expect(responseHeaders({})).toHaveProperty('Connection-Allowlist')
  })

  it('opens no page when the service workers could not be removed on turning WebRTC off, which stays off', async () => {
    const browser = await enabledBrowser()
    await browser.setWebRTC(true)
    browser.open('http://localhost:3000/')
    const old = electron.views.at(-1)!.webContents
    // Fails when turned off, and again when the reopened tab tries.
    session.clearStorageData.mockRejectedValueOnce(new Error('busy')).mockRejectedValueOnce(new Error('busy'))
    await expect(browser.setWebRTC(false)).rejects.toThrow(/could not remove the service workers/)
    await settle()
    expect(browser.state().webrtc).toBe(false)
    expect(old.close).toHaveBeenCalled()
    expect(browser.state().tabs[0]!.error).toMatch(/could not remove/)
    expect(request('http://localhost:3000/', undefined)).toBe(false)
  })

  it('names WebRTC as the likely cause when Chromium ends a page while it is off', async () => {
    const browser = await enabledBrowser()
    browser.open('http://localhost:3000/')
    const contents = electron.views[0]!.webContents
    contents.emit('render-process-gone', {}, { reason: 'killed', exitCode: 3 })
    expect(browser.state().tabs[0]!.error).toMatch(/WebRTC, which is off/)
    contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    expect(browser.state().tabs[0]!.error).not.toMatch(/WebRTC/)
  })

  it('opens a page\'s new windows as tabs, and never hands one to the system browser itself', async () => {
    const browser = await enabledBrowser()
    browser.open('http://localhost:3000/')
    const contents = electron.views[0]!.webContents
    expect(contents.openHandler!({ url: 'http://localhost:4000/' })).toEqual({ action: 'deny' })
    expect(browser.state().tabs.map((tab) => tab.url)).toEqual(['http://localhost:3000/', 'http://localhost:4000/'])
    // A host that is not allowed gets a tab that asks; nothing is contacted, no page is made for it.
    expect(contents.openHandler!({ url: 'https://evil.example/?leak=secret' })).toEqual({ action: 'deny' })
    expect(contents.openHandler!({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' })
    const tabs = browser.state().tabs
    expect(tabs).toHaveLength(3)
    expect(tabs[2]!.blocked).toEqual({ url: 'https://evil.example/?leak=secret', host: 'evil.example' })
    expect(electron.views).toHaveLength(2)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('shows the "allow this host?" page for a navigation to a host that is not allowed, and Back returns to the page', async () => {
    const browser = await enabledBrowser()
    browser.open('http://localhost:3000/')
    const contents = electron.views[0]!.webContents
    contents.getURL.mockReturnValue('http://localhost:3000/')
    contents.getTitle.mockReturnValue('App')
    const away = { url: 'https://evil.example/?leak=secret', preventDefault: vi.fn() }
    contents.emit('will-navigate', away)
    expect(away.preventDefault).toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
    const blocked = browser.state().tabs[0]!
    expect(blocked).toMatchObject({ blocked: { url: 'https://evil.example/?leak=secret', host: 'evil.example' }, canGoBack: true })
    // The page's own events after the refusal do not take Back away, though its history has nothing before it.
    contents.emit('did-stop-loading')
    expect(browser.state().tabs[0]!.canGoBack).toBe(true)
    browser.act(blocked.id, 'back')
    expect(browser.state().tabs[0]).toMatchObject({ url: 'http://localhost:3000/', title: 'App', blocked: null })
    expect(contents.navigationHistory.goBack).not.toHaveBeenCalled()
    const local = { url: 'http://localhost:3000/next', preventDefault: vi.fn() }
    contents.emit('will-navigate', local)
    expect(local.preventDefault).not.toHaveBeenCalled()
  })

  it('leaves the "allow this host?" page for the start page when no page is under it', async () => {
    const browser = await enabledBrowser()
    const typed = browser.open('https://staging.test/app').tabs[0]!
    expect(typed).toMatchObject({ blocked: { host: 'staging.test' }, canGoBack: true })
    browser.act(typed.id, 'back')
    expect(browser.state().tabs[0]).toMatchObject({ id: typed.id, url: '', title: 'New tab', blocked: null, canGoBack: false })
    // A page's new window to a host that is not allowed: its tab has nothing under it either.
    browser.open('http://localhost:3000/')
    electron.views[0]!.webContents.openHandler!({ url: 'https://evil.example/' })
    const opened = browser.state().tabs.at(-1)!
    expect(opened.blocked?.host).toBe('evil.example')
    browser.act(opened.id, 'back')
    expect(browser.state().tabs.at(-1)).toMatchObject({ url: '', blocked: null })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('opens a link in the system browser only from the link menu, at most once a second', async () => {
    (await enabledBrowser()).open('http://localhost:3000/')
    const contents = electron.views[0]!.webContents
    const params = { linkURL: 'https://docs.example.com/', isEditable: false, selectionText: '', editFlags: {}, x: 0, y: 0 }
    contents.emit('context-menu', {}, params)
    const items = (electron.Menu.buildFromTemplate.mock.calls.at(-1) as unknown[])[0] as Array<{ label?: string; click?: () => void }>
    const item = items.find((entry) => entry.label === 'Open link in system browser')!
    item.click!()
    item.click!()
    expect(openExternal.mock.calls).toEqual([['https://docs.example.com/']])
  })

  it('offers no client certificate to a page', async () => {
    (await enabledBrowser()).open('http://localhost:3000/')
    const contents = electron.views[0]!.webContents
    const event = { preventDefault: vi.fn() }
    const callback = vi.fn()
    contents.emit('select-client-certificate', event, 'https://localhost:3000/', [{ subjectName: 'Me' }], callback)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(callback).toHaveBeenCalledWith()
  })

  it('clears every kind of browsing data, and says so when a part could not be cleared', async () => {
    const browser = await enabledBrowser()
    await browser.clearData()
    session.clearCache.mockRejectedValueOnce(new Error('busy'))
    await expect(browser.clearData()).rejects.toThrow(/could not be cleared/)
    // Once more than the service workers' removal when the browser started.
    expect(session.clearStorageData).toHaveBeenCalledTimes(3)
    expect(session.clearAuthCache).toHaveBeenCalledTimes(2)
  })

  it('lays the active page over the panel in window units, and takes it off for null, a refused page or a closed tab', async () => {
    const browser = await enabledBrowser()
    const first = browser.open('http://localhost:3000/').tabs[0]!
    // 540.2 × 1.25 = 675.25: the view reaches 676, so the panel's last pixel row is not left showing under it.
    browser.setBounds({ x: 100, y: 40, width: 300, height: 500.2 })
    const view = electron.views[0]!
    expect(window.contentView.addChildView).toHaveBeenCalledWith(view)
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 125, y: 50, width: 375, height: 626 })
    browser.setBounds(null)
    expect(window.contentView.removeChildView).toHaveBeenCalledWith(view)
    browser.setBounds({ x: 0, y: 0, width: 10, height: 10 })
    browser.open('https://not-allowed.test/')
    expect(window.contentView.removeChildView).toHaveBeenCalledTimes(2)
    browser.select(first.id)
    browser.close(first.id)
    expect(view.webContents.close).toHaveBeenCalled()
  })

  it('lets only its own tabs download, through the save dialog', async () => {
    (await enabledBrowser()).open('http://localhost:3000/')
    const ours = { cancel: vi.fn(), setSaveDialogOptions: vi.fn() }
    session.downloadHandler!({}, ours, electron.views[0]!.webContents)
    expect(ours.cancel).not.toHaveBeenCalled()
    expect(ours.setSaveDialogOptions).toHaveBeenCalled()
    const stray = { cancel: vi.fn(), setSaveDialogOptions: vi.fn() }
    session.downloadHandler!({}, stray, {})
    expect(stray.cancel).toHaveBeenCalled()
  })

  it('keeps at most twelve tabs and refuses addresses that are not web addresses', async () => {
    const browser = await enabledBrowser()
    for (let index = 0; index < 12; index += 1) browser.newTab()
    expect(() => browser.newTab()).toThrow(/Close a tab first/)
    expect(() => browser.open('file:///etc/passwd')).toThrow(/http and https/)
  })

  it('reports a page that did not load, and loads it again on reload', async () => {
    const browser = await enabledBrowser()
    const tab = browser.open('http://localhost:3000/').tabs[0]!
    const contents = electron.views[0]!.webContents
    contents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://localhost:3000/', true)
    expect(browser.state().tabs[0]!.error).toMatch(/ERR_CONNECTION_REFUSED/)
    // The browser's own cancellations say nothing.
    contents.emit('did-fail-load', {}, -20, 'ERR_BLOCKED_BY_CLIENT', 'http://localhost:3000/', true)
    browser.act(tab.id, 'reload')
    expect(browser.state().tabs[0]!.error).toBeNull()
    expect(contents.loadURL).toHaveBeenCalledTimes(2)
  })
})
