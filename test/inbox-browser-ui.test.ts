// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/renderer/components/inbox/InboxTerminal', () => ({
  InboxTerminal: () => createElement('div'),
  focusInboxTerminalWhenShown: vi.fn(),
}))
import { InboxSidebar } from '../src/renderer/components/inbox/InboxChanges'
import { BrowserSettings } from '../src/renderer/components/BrowserSettings'
import { FilePreviewMenu } from '../src/renderer/components/FilePreviewMenu'
import { openWebLink } from '../src/renderer/lib/web-links'
import { useInboxBrowser } from '../src/renderer/store/inbox-browser'
import { useInboxChanges } from '../src/renderer/store/inbox-changes'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useInboxView } from '../src/renderer/store/inbox-view'
import { useWorkspace } from '../src/renderer/store/workspace'
import { getTerminalSettings, saveTerminalSettings } from '../src/renderer/terminal/terminal-settings'
import type { BrowserState, BrowserTab } from '../src/shared/browser'
import type { DirectoryContext } from '../src/shared/types'

const TAB_ID = 'brt_123e4567-e89b-12d3-a456-426614174000'

function tab(overrides: Partial<BrowserTab> = {}): BrowserTab {
  return { id: TAB_ID, url: 'http://localhost:3000/', title: 'App', loading: false, canGoBack: false, canGoForward: false, blocked: null, blockedHosts: [], error: null, ...overrides }
}

const state = (tabs: BrowserTab[], allowedHosts: string[] = []): BrowserState => ({ enabled: true, webrtc: false, webrtcUnsaved: false, tabs, activeId: tabs[0]?.id ?? null, allowedHosts })

let api: {
  setEnabled: ReturnType<typeof vi.fn>
  setWebRTC: ReturnType<typeof vi.fn>
  state: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
  newTab: ReturnType<typeof vi.fn>
  navigate: ReturnType<typeof vi.fn>
  act: ReturnType<typeof vi.fn>
  select: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  setBounds: ReturnType<typeof vi.fn>
  allowHost: ReturnType<typeof vi.fn>
  removeHost: ReturnType<typeof vi.fn>
  clearData: ReturnType<typeof vi.fn>
  onChanged: ReturnType<typeof vi.fn>
}
const windowOpen = vi.fn()

let root: Root
let container: HTMLDivElement
const render = (element: ReactElement): Promise<void> => act(async () => root.render(element))
const click = (element: Element | null): Promise<void> => act(async () => (element as HTMLElement).click())
const byTestId = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const session: DirectoryContext = { id: 'fld_app', name: 'app', path: '/home/me/app', kind: 'wsl', distro: 'Ubuntu', createdAt: '' }
const linkClick = (value: 'system' | 'mde'): void => saveTerminalSettings({ ...getTerminalSettings(), linkClick: value })

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', undefined)
  const current = state([])
  api = {
    setEnabled: vi.fn(async (enabled: boolean) => ({ ...current, enabled })),
    setWebRTC: vi.fn(async (webrtc: boolean) => ({ ...current, webrtc })),
    state: vi.fn(async () => current),
    open: vi.fn(async (url: string) => state([tab({ url })], useInboxBrowser.getState().state.allowedHosts)),
    newTab: vi.fn(async () => state([tab({ url: '', title: 'New tab' })])),
    navigate: vi.fn(async () => current),
    act: vi.fn(async () => undefined),
    select: vi.fn(async () => current),
    close: vi.fn(async () => state([])),
    setBounds: vi.fn(async () => undefined),
    allowHost: vi.fn(async (host: string) => state([tab()], [host])),
    removeHost: vi.fn(async () => current),
    clearData: vi.fn(async () => undefined),
    onChanged: vi.fn(() => () => undefined),
  }
  vi.stubGlobal('api', {
    browser: api,
    inbox: { changes: vi.fn(async () => ({ available: false })) },
    files: { list: vi.fn(async ({ path }: { path: string }) => ({ path, truncated: false, entries: [] })) },
  })
  vi.spyOn(window, 'open').mockImplementation(windowOpen as never)
  windowOpen.mockClear()
  localStorage.clear()
  useInboxBrowser.setState({ state: state([]), loaded: true, error: null })
  useInboxChat.setState({ threads: {}, recent: [], draftReloads: {} })
  useInboxChanges.setState({ entries: {}, selectedPath: null, tab: 'files' })
  useInboxView.setState({ sidebarFloating: false })
  useWorkspace.setState({
    inboxThreads: [],
    selectedInboxThreadId: null,
    activeWorkspaceView: 'sessions',
    fileTreeCollapsed: true,
    platform: { platform: 'win32', isWindows: true },
    wslAvailable: true,
    settingsDialog: { open: false, section: 'appearance' },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Where a clicked web link opens', () => {
  it('opens in the system browser by default, even for a local address', () => {
    openWebLink('http://localhost:3000/')
    expect(windowOpen).toHaveBeenCalledWith('http://localhost:3000/', '_blank', 'noopener,noreferrer')
    expect(api.open).not.toHaveBeenCalled()
  })

  it('with the MDE browser chosen, opens local and allowed hosts there and shows its tab', async () => {
    linkClick('mde')
    useInboxBrowser.setState({ state: state([], ['staging.test']) })
    await act(async () => openWebLink('http://localhost:3000/'))
    expect(api.open).toHaveBeenCalledWith('http://localhost:3000/')
    expect(windowOpen).not.toHaveBeenCalled()
    expect(useWorkspace.getState().activeWorkspaceView).toBe('inbox')
    expect(useWorkspace.getState().fileTreeCollapsed).toBe(false)
    expect(useInboxChanges.getState().tab).toBe('browser')
    await act(async () => openWebLink('https://staging.test/x'))
    expect(api.open).toHaveBeenLastCalledWith('https://staging.test/x')
  })

  it('with the MDE browser chosen, still sends every other host to the system browser, so a click never asks', () => {
    linkClick('mde')
    openWebLink('https://github.com/org/repo')
    expect(windowOpen).toHaveBeenCalledWith('https://github.com/org/repo', '_blank', 'noopener,noreferrer')
    expect(api.open).not.toHaveBeenCalled()
  })

  it('uses the system browser where the Inbox, and with it the MDE browser, is not available', () => {
    linkClick('mde')
    useWorkspace.setState({ platform: { platform: 'linux', isWindows: false }, wslAvailable: false })
    openWebLink('http://localhost:3000/')
    expect(windowOpen).toHaveBeenCalled()
    expect(api.open).not.toHaveBeenCalled()
  })

  it('ignores links that are not web addresses', () => {
    openWebLink('javascript:alert(1)')
    openWebLink('file:///etc/passwd')
    expect(windowOpen).not.toHaveBeenCalled()
  })

  it('offers both browsers when a link is right-clicked', async () => {
    await render(createElement(FilePreviewMenu, {
      getSelectedText: () => '',
      onSelectAll: () => undefined,
      empty: false,
      children: createElement('div', null, createElement('a', { href: 'http://localhost:5173/docs', 'data-testid': 'link' }, 'docs')),
    }))
    await act(async () => {
      byTestId('link')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 2 }))
    })
    expect(byTestId('file-preview-menu-open-system')).not.toBeNull()
    await click(byTestId('file-preview-menu-open-mde'))
    expect(api.open).toHaveBeenCalledWith('http://localhost:5173/docs')
    expect(useInboxChanges.getState().tab).toBe('browser')
  })
})

describe('Settings → Browser', () => {
  it('enables the browser explicitly and routes links to the system browser while off', async () => {
    useInboxBrowser.setState({ state: { ...state([]), enabled: false } })
    linkClick('mde')
    openWebLink('http://localhost:3000/')
    expect(windowOpen).toHaveBeenCalled()
    expect(api.open).not.toHaveBeenCalled()
    await render(createElement(BrowserSettings))
    const toggle = byTestId('browser-enabled')!
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    await click(toggle)
    expect(api.setEnabled).toHaveBeenCalledWith(true)
    expect(useInboxBrowser.getState().state.enabled).toBe(true)
    expect(byTestId('browser-enabled')!.getAttribute('aria-checked')).toBe('true')
    expect(byTestId('browser-enabled')!.hasAttribute('disabled')).toBe(false)
  })

  it('keeps WebRTC off unless turned on, and warns about it while on', async () => {
    await render(createElement(BrowserSettings))
    const toggle = byTestId('browser-webrtc')!
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(byTestId('browser-webrtc-warning')).toBeNull()
    await click(toggle)
    expect(api.setWebRTC).toHaveBeenCalledWith(true)
    expect(byTestId('browser-webrtc')!.getAttribute('aria-checked')).toBe('true')
    expect(byTestId('browser-webrtc-warning')!.textContent).toMatch(/don't go through the host list/)
  })

  it('cannot allow WebRTC while the browser is off, and shows why turning it off failed beside it', async () => {
    useInboxBrowser.setState({ state: { ...state([]), enabled: false } })
    await render(createElement(BrowserSettings))
    expect(byTestId('browser-webrtc')!.hasAttribute('disabled')).toBe(true)
    await act(async () => useInboxBrowser.setState({ state: { ...state([]), webrtc: true } }))
    api.setWebRTC.mockRejectedValueOnce(new Error('WebRTC is off, but the service workers of earlier pages could not be removed.'))
    await click(byTestId('browser-webrtc'))
    const alerts = Array.from(document.querySelectorAll('[role="alert"]'))
    expect(alerts.map((alert) => alert.textContent)).toEqual(['WebRTC is off, but the service workers of earlier pages could not be removed.'])
  })

  it('warns when turning WebRTC off could not be saved, and saves it again on request', async () => {
    useInboxBrowser.setState({ state: { ...state([]), webrtcUnsaved: true } })
    api.setWebRTC.mockImplementationOnce(async () => ({ ...state([]), webrtcUnsaved: false }))
    await render(createElement(BrowserSettings))
    expect(byTestId('browser-webrtc')!.getAttribute('aria-checked')).toBe('false')
    expect(byTestId('browser-webrtc-unsaved')!.textContent).toMatch(/start with it on next time/)
    await click(byTestId('browser-webrtc-save-again'))
    expect(api.setWebRTC).toHaveBeenCalledWith(false)
    expect(byTestId('browser-webrtc-unsaved')).toBeNull()
  })

  it('says the browsing data was cleared only when it was', async () => {
    api.clearData.mockRejectedValueOnce(new Error('Some of the MDE browser\'s data could not be cleared. Try again.'))
    await render(createElement(BrowserSettings))
    await click(byTestId('browser-clear-data'))
    expect(byTestId('browser-clear-data')!.textContent).toBe('Clear browsing data')
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('could not be cleared')
    await click(byTestId('browser-clear-data'))
    expect(byTestId('browser-clear-data')!.textContent).toBe('Cleared')
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })
})

describe('Inbox Browser tab', () => {
  const sidebar = async (): Promise<void> => {
    useWorkspace.setState({ activeWorkspaceView: 'inbox', fileTreeCollapsed: false })
    await render(createElement(InboxSidebar, { session }))
  }

  it('is a sidebar tab next to Terminal, also on the new-thread page', async () => {
    await sidebar()
    await click(byTestId('inbox-sidebar-tab-browser'))
    expect(useInboxChanges.getState().tab).toBe('browser')
    expect(byTestId('inbox-browser-panel')).not.toBeNull()
    expect(byTestId('inbox-browser-start')).not.toBeNull()
    const field = byTestId('inbox-browser-start-address') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(field, 'localhost:5173')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(byTestId('inbox-browser-start-open'))
    expect(api.open).toHaveBeenCalledWith('localhost:5173')
    await click(byTestId('inbox-browser-new-tab'))
    expect(api.newTab).toHaveBeenCalled()
  })

  it('asks before opening a host that is not allowed, and allows it on request', async () => {
    useInboxChanges.setState({ tab: 'browser' })
    useInboxBrowser.setState({ state: state([tab({ url: 'https://staging.test/app', blocked: { url: 'https://staging.test/app', host: 'staging.test' } })]) })
    await sidebar()
    expect(byTestId('inbox-browser-blocked')!.textContent).toContain('staging.test')
    expect(byTestId('inbox-browser-viewport')).toBeNull()
    // Going back is the main button, so leaving is as easy as allowing.
    expect(byTestId('inbox-browser-blocked')!.querySelector('button')).toBe(byTestId('inbox-browser-go-back'))
    await click(byTestId('inbox-browser-go-back'))
    expect(api.act).toHaveBeenCalledWith(TAB_ID, 'back')
    await click(byTestId('inbox-browser-allow'))
    expect(api.allowHost).toHaveBeenCalledWith('staging.test')
  })

  it('names the hosts a page was refused', async () => {
    useInboxChanges.setState({ tab: 'browser' })
    useInboxBrowser.setState({ state: state([tab({ blockedHosts: ['cdn.example.com', 'fonts.example.com'] })]) })
    await sidebar()
    expect(byTestId('inbox-browser-refused')!.textContent).toContain('Refused 2 hosts: cdn.example.com, fonts.example.com')
  })

  it('lays the page over the panel, and takes it off, with no picture in its place, while something covers the panel', async () => {
    const rect = { x: 900, y: 80, left: 900, top: 80, right: 1260, bottom: 680, width: 360, height: 600, toJSON: () => ({}) }
    const original = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === 'inbox-browser-viewport' || this.dataset.testid === 'cover') return rect as DOMRect
      return original.call(this)
    })
    let viewport: HTMLElement | null = null
    vi.spyOn(document, 'elementFromPoint').mockImplementation(() => viewport)
    useInboxChanges.setState({ tab: 'browser' })
    useInboxBrowser.setState({ state: state([tab()]) })
    await sidebar()
    viewport = byTestId('inbox-browser-viewport')
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(api.setBounds).toHaveBeenLastCalledWith({ x: 900, y: 80, width: 360, height: 600 })

    // A menu portalled into <body> over the panel.
    const cover = document.createElement('div')
    cover.dataset.testid = 'cover'
    await act(async () => {
      document.body.append(cover)
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(api.setBounds).toHaveBeenLastCalledWith(null)
    expect(byTestId('inbox-browser-viewport')!.querySelector('img')).toBeNull()
    // A menu goes by itself, so the panel says nothing about it.
    expect(byTestId('inbox-browser-covered')).toBeNull()

    await act(async () => {
      cover.remove()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(api.setBounds).toHaveBeenLastCalledWith({ x: 900, y: 80, width: 360, height: 600 })

    // Leaving the tab takes the page off the window.
    await click(byTestId('inbox-sidebar-tab-files'))
    expect(api.setBounds).toHaveBeenLastCalledWith(null)
  })

  it('keeps the page on screen while a modal menu elsewhere turns off pointer events for the whole window', async () => {
    const rect = { x: 900, y: 80, left: 900, top: 80, right: 1260, bottom: 680, width: 360, height: 600, toJSON: () => ({}) }
    const away = { x: 100, y: 500, left: 100, top: 500, right: 400, bottom: 700, width: 300, height: 200, toJSON: () => ({}) }
    const original = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === 'inbox-browser-viewport') return rect as DOMRect
      if (this.dataset.testid === 'menu') return away as DOMRect
      return original.call(this)
    })
    let viewport: HTMLElement | null = null
    // With pointer events off on <body>, the hit test finds the page's background instead of the panel.
    vi.spyOn(document, 'elementFromPoint').mockImplementation(() => (document.body.style.pointerEvents === 'none' ? document.documentElement : viewport))
    useInboxChanges.setState({ tab: 'browser' })
    useInboxBrowser.setState({ state: state([tab()]) })
    await sidebar()
    viewport = byTestId('inbox-browser-viewport')
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(api.setBounds).toHaveBeenLastCalledWith({ x: 900, y: 80, width: 360, height: 600 })
    const menu = document.createElement('div')
    menu.dataset.testid = 'menu'
    await act(async () => {
      document.body.append(menu)
      document.body.style.pointerEvents = 'none'
      await new Promise((resolve) => setTimeout(resolve, 450))
    })
    expect(api.setBounds).toHaveBeenLastCalledWith({ x: 900, y: 80, width: 360, height: 600 })
    expect(api.setBounds).not.toHaveBeenCalledWith(null)
    menu.remove()
    document.body.style.pointerEvents = ''
  })

  it('says the page is hidden while the floating terminal covers it, and how to show it', async () => {
    const rect = { x: 900, y: 80, left: 900, top: 80, right: 1260, bottom: 680, width: 360, height: 600, toJSON: () => ({}) }
    const original = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === 'inbox-browser-viewport' || this.dataset.testid === 'floating-terminal') return rect as DOMRect
      return original.call(this)
    })
    let viewport: HTMLElement | null = null
    vi.spyOn(document, 'elementFromPoint').mockImplementation(() => viewport)
    // The terminal is already over the panel when the page opens, so there is no picture of the page yet.
    const terminal = document.createElement('div')
    terminal.dataset.testid = 'floating-terminal'
    document.body.append(terminal)
    useInboxChanges.setState({ tab: 'browser' })
    useInboxBrowser.setState({ state: state([tab()]) })
    await sidebar()
    viewport = byTestId('inbox-browser-viewport')
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(api.setBounds).not.toHaveBeenCalledWith(expect.objectContaining({ width: 360 }))
    expect(byTestId('inbox-browser-covered')!.textContent).toMatch(/hidden while the floating terminal covers it.*F11/)

    // Moved away, the page shows; moved back, it is hidden again.
    await act(async () => {
      terminal.remove()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(api.setBounds).toHaveBeenLastCalledWith({ x: 900, y: 80, width: 360, height: 600 })
    expect(byTestId('inbox-browser-covered')).toBeNull()
    await act(async () => {
      document.body.append(terminal)
      await new Promise((resolve) => setTimeout(resolve, 400))
    })
    expect(api.setBounds).toHaveBeenLastCalledWith(null)
    expect(byTestId('inbox-browser-viewport')!.querySelector('img')).toBeNull()
    expect(byTestId('inbox-browser-covered')!.textContent).toMatch(/hidden while the floating terminal covers it.*F11/)
    terminal.remove()
  })
})
