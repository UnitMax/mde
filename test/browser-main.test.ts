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

function fakeSession() {
  const session = {
    requestHandler: null as RequestHandler | null,
    downloadHandler: null as ((event: unknown, item: unknown, contents: unknown) => void) | null,
    webRequest: { onBeforeRequest: vi.fn((handler: RequestHandler) => { session.requestHandler = handler }) },
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(),
    setSpellCheckerEnabled: vi.fn(),
    on: vi.fn((name: string, handler: (event: unknown, item: unknown, contents: unknown) => void) => {
      if (name === 'will-download') session.downloadHandler = handler
    }),
    clearStorageData: vi.fn(async () => undefined),
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
    expect(JSON.parse(await readFile(join(dir, 'browser.json'), 'utf8'))).toEqual({ version: 1, enabled: false, allowedHosts: ['staging.test'] })
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
    expect(JSON.parse(await readFile(join(dir, 'browser.json'), 'utf8'))).toEqual({ version: 1, enabled: true, allowedHosts: ['staging.test'] })
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
    await writeFile(join(dir, 'browser.json'), JSON.stringify({ enabled: 'true', allowedHosts: [] }))
    await browser.load()
    expect(browser.state().enabled).toBe(false)
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
    browser.act(blocked.id, 'back')
    expect(browser.state().tabs[0]).toMatchObject({ url: 'http://localhost:3000/', title: 'App', blocked: null })
    expect(contents.navigationHistory.goBack).not.toHaveBeenCalled()
    const local = { url: 'http://localhost:3000/next', preventDefault: vi.fn() }
    contents.emit('will-navigate', local)
    expect(local.preventDefault).not.toHaveBeenCalled()
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
    expect(session.clearStorageData).toHaveBeenCalledTimes(2)
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
