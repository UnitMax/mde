// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/renderer/components/inbox/InboxTerminal', () => ({
  InboxTerminal: () => createElement('div'),
  focusInboxTerminalWhenShown: vi.fn(),
}))
import { InboxSidebar } from '../src/renderer/components/inbox/InboxChanges'
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

const state = (tabs: BrowserTab[], allowedHosts: string[] = []): BrowserState => ({ tabs, activeId: tabs[0]?.id ?? null, allowedHosts })

let api: {
  state: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
  newTab: ReturnType<typeof vi.fn>
  navigate: ReturnType<typeof vi.fn>
  act: ReturnType<typeof vi.fn>
  select: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  setBounds: ReturnType<typeof vi.fn>
  capture: ReturnType<typeof vi.fn>
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
    state: vi.fn(async () => current),
    open: vi.fn(async (url: string) => state([tab({ url })], useInboxBrowser.getState().state.allowedHosts)),
    newTab: vi.fn(async () => state([tab({ url: '', title: 'New tab' })])),
    navigate: vi.fn(async () => current),
    act: vi.fn(async () => undefined),
    select: vi.fn(async () => current),
    close: vi.fn(async () => state([])),
    setBounds: vi.fn(async () => undefined),
    capture: vi.fn(async () => 'data:image/png;base64,AAAA'),
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
    await click(byTestId('inbox-browser-allow'))
    expect(api.allowHost).toHaveBeenCalledWith('staging.test')
  })

  it('names the hosts a page was refused', async () => {
    useInboxChanges.setState({ tab: 'browser' })
    useInboxBrowser.setState({ state: state([tab({ blockedHosts: ['cdn.example.com', 'fonts.example.com'] })]) })
    await sidebar()
    expect(byTestId('inbox-browser-refused')!.textContent).toContain('Refused 2 hosts: cdn.example.com, fonts.example.com')
  })

  it('lays the page over the panel, and swaps in a picture of it while something covers the panel', async () => {
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
    expect(api.capture).toHaveBeenCalled()
    // The page stays until its picture is painted in its place, so nothing blank shows in between.
    await vi.waitFor(() => expect(api.setBounds).toHaveBeenLastCalledWith(null))
    const picture = byTestId('inbox-browser-viewport')!.querySelector('img')
    expect(picture?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(api.setBounds.mock.invocationCallOrder.at(-1)).toBeGreaterThan(api.capture.mock.invocationCallOrder.at(-1)!)

    await act(async () => {
      cover.remove()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(api.setBounds).toHaveBeenLastCalledWith({ x: 900, y: 80, width: 360, height: 600 })
    // The picture stays under the page for a moment while the page draws again.
    expect(byTestId('inbox-browser-viewport')!.querySelector('img')).not.toBeNull()
    await act(async () => new Promise((resolve) => setTimeout(resolve, 350)))
    expect(byTestId('inbox-browser-viewport')!.querySelector('img')).toBeNull()

    // Leaving the tab takes the page off the window.
    await click(byTestId('inbox-sidebar-tab-files'))
    expect(api.setBounds).toHaveBeenLastCalledWith(null)
  })
})
