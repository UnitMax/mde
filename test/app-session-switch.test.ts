// @vitest-environment happy-dom

import { terminalIdForPane } from '../src/renderer/terminal/tabs'
import { fileRootKey } from '../src/renderer/lib/file-root'
import { testLayout } from './helpers/terminal-layout'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxThread, Session } from '../src/shared/types'
import { App } from '../src/renderer/App'
import { useWorkspace } from '../src/renderer/store/workspace'

vi.mock('../src/renderer/terminal/sessions', () => {
  const term = { focus: vi.fn(), reset: vi.fn(), buffer: { active: { type: 'normal' } } }
  return {
    attachSession: () => ({ term, container: document.createElement('div') }),
    detachSession: vi.fn(),
    fitSession: () => null,
    getSession: () => ({ term, container: document.createElement('div') }),
    disposeSession: vi.fn(),
    applyTerminalSettings: vi.fn(),
    applyTerminalTheme: vi.fn(),
    initTerminalBridge: vi.fn()
  }
})
vi.mock('../src/renderer/components/TerminalGitInfo', () => ({ TerminalGitInfo: () => null }))

/** A `window.api` whose every call resolves to nothing, with the calls the screen reads answered. */
function stubApi(): unknown {
  const answers: Record<string, unknown> = {
    'pty.ensure': 'running',
    'windowMode.set': 'normal',
    'files.list': { entries: [], truncated: false },
    'files.read': { path: 'README.md', content: '# Notes\n', size: 8, binary: false, tooLarge: false }
  }
  const call = (name: string) => (...args: unknown[]) => {
    if (name === 'files.list') listFiles(...args)
    if (name === 'tabs.create') return createTab(...args)
    const result = (() => undefined) as unknown as { then: (resolve: (value: unknown) => unknown) => Promise<unknown> }
    result.then = (resolve) => Promise.resolve(answers[name]).then(resolve)
    return result
  }
  return new Proxy({}, {
    get: (_, namespace: string) => new Proxy({}, { get: (_target, method: string) => call(`${namespace}.${method}`) })
  })
}

const roots: Root[] = []
const listFiles = vi.fn()
const createTab = vi.fn()

function session(id: string, name: string, paneCount: number): Session {
  return {
    id, name, kind: 'native',
    createdAt: '2026-01-01T00:00:00.000Z',
    tabs: [{
      id: `${id}-tab`, name: 'Tab 1',
      layout: testLayout(Array.from({ length: paneCount }, (_, index) => ({ id: `pane-${index + 1}` })))
    }],
    activeTabId: `${id}-tab`
  }
}

const alpha = session('alpha', 'Alpha', 4)
const beta = session('beta', 'Beta', 2)

async function render(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(createElement(App)))
  return container
}

const select = (id: string): Promise<void> => act(async () => useWorkspace.getState().selectSession(id))
const paneCount = (): number => document.querySelectorAll('[data-terminal-pane-slot]').length
const viewerPath = (): string | null =>
  document.querySelector('[data-testid="file-viewer"] [title]')?.getAttribute('title') ?? null

describe('switching sessions with a file open', () => {
  beforeEach(() => {
    listFiles.mockClear()
    createTab.mockReset()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    Object.defineProperty(window, 'api', { configurable: true, value: stubApi() })
    useWorkspace.setState({
      init: async () => undefined,
      ready: true,
      platform: { platform: 'linux', isWindows: false },
      sessions: [alpha, beta],
      selectedSessionId: 'alpha',
      activeWorkspaceView: 'sessions',
      windowMode: 'normal',
      inboxThreads: [],
      selectedInboxThreadId: null,
      openFiles: { [fileRootKey({ terminalId: terminalIdForPane('alpha', 'alpha-tab', 'pane-1'), directory: '/workspace/alpha' })]: 'README.md' },
      statuses: {}, exits: {}, terminalDirectories: { [terminalIdForPane(alpha.id, 'alpha-tab', 'pane-1')]: '/workspace/alpha' },
      fileTreeCollapsed: false,
    })
  })

  afterEach(async () => {
    await act(async () => roots.splice(0).forEach((root) => root.unmount()))
    document.body.replaceChildren()
    Reflect.deleteProperty(window, 'api')
    vi.unstubAllGlobals()
  })

  it('shows only the selected session\'s terminals after the switch', async () => {
    await render()
    await act(async () => {})
    expect(paneCount()).toBe(4)
    expect(viewerPath()).toBe('README.md')

    await select('beta')
    expect(paneCount()).toBe(2)
    expect(viewerPath()).toBeNull()

    await select('alpha')
    expect(paneCount()).toBe(4)
    expect(viewerPath()).toBe('README.md')
  })

  it('keeps the Files sidebar visible while an opened session reports its directory', async () => {
    const container = await render()
    await select('beta')

    const pending = container.querySelector('[data-testid="file-tree-panel"]')
    expect(pending).not.toBeNull()
    expect(pending?.className).toContain('w-[260px]')
    expect(pending?.textContent).toContain('Loading')
    expect(pending?.querySelector('[role="tree"]')?.getAttribute('aria-busy')).toBe('true')
    expect(container.textContent).not.toContain('/workspace/alpha')
    expect(listFiles).not.toHaveBeenCalled()

    const terminalId = terminalIdForPane(beta.id, 'beta-tab', 'pane-1')
    await act(async () => useWorkspace.getState().setStatus(terminalId, 'running'))
    expect(listFiles).not.toHaveBeenCalled()
    await act(async () => useWorkspace.getState().setTerminalDirectory({ terminalId, directory: '/workspace/beta' }))

    const loaded = container.querySelector('[data-testid="file-tree-panel"]')
    expect(loaded?.className).toBe(pending?.className)
    expect(loaded?.textContent).toContain('/workspace/beta')
    expect(listFiles).toHaveBeenCalledExactlyOnceWith({ terminalId, directory: '/workspace/beta', path: '' })
  })

  it('keeps the Files sidebar visible when adding a terminal tab', async () => {
    const tab = { id: 'fresh-tab', name: 'Tab 2', layout: testLayout([{ id: 'pane-1' }]) }
    createTab.mockResolvedValue({ ...alpha, tabs: [...alpha.tabs!, tab], activeTabId: tab.id })
    const container = await render()
    const panelClass = container.querySelector('[data-testid="file-tree-panel"]')?.className

    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="session-tab-add"]')?.click())
    expect(createTab).toHaveBeenCalledWith({ sessionId: alpha.id })
    expect(paneCount()).toBe(1)
    const pending = container.querySelector('[data-testid="file-tree-panel"]')
    expect(pending).not.toBeNull()
    expect(pending?.className).toBe(panelClass)
    expect(pending?.textContent).toContain('Loading')
    expect(listFiles).not.toHaveBeenCalled()

    const terminalId = terminalIdForPane(alpha.id, tab.id, 'pane-1')
    await act(async () => {
      useWorkspace.getState().setStatus(terminalId, 'running')
      useWorkspace.getState().setTerminalDirectory({ terminalId, directory: '/home/me' })
    })
    expect(container.querySelector('[data-testid="file-tree-panel"]')?.className).toBe(panelClass)
    expect(listFiles).toHaveBeenCalledExactlyOnceWith({ terminalId, directory: '/home/me', path: '' })
  })

  it('keeps the Files sidebar visible when focusing a newly split terminal', async () => {
    const container = await render()
    const existingPanes = Array.from(container.querySelectorAll('[data-terminal-pane-slot]'))
    const panelClass = container.querySelector('[data-testid="file-tree-panel"]')?.className
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true, bubbles: true }))
    })
    const split = container.querySelector<HTMLButtonElement>('[data-testid="terminal-split-right"]')
    expect(split).not.toBeNull()
    await act(async () => split?.click())
    expect(paneCount()).toBe(existingPanes.length + 1)

    const added = Array.from(container.querySelectorAll('[data-terminal-pane-slot]')).find((pane) => !existingPanes.includes(pane))
    expect(added).toBeDefined()
    await act(async () => added?.querySelector('[data-testid="terminal-pane-title-bar"]')?.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    const panel = container.querySelector('[data-testid="file-tree-panel"]')
    expect(panel).not.toBeNull()
    expect(panel?.className).toBe(panelClass)
    expect(panel?.textContent).toContain('Loading')
    expect(listFiles).not.toHaveBeenCalled()
  })

  it('keeps the collapsed Files rail when opening a session without a directory', async () => {
    useWorkspace.setState({ fileTreeCollapsed: true })
    const container = await render()
    const rail = container.querySelector('[aria-label="Expand files"]')?.parentElement
    expect(rail).not.toBeNull()
    await select('beta')
    expect(container.querySelector('[aria-label="Expand files"]')?.parentElement).toBe(rail)

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Expand files"]')?.click())
    expect(container.querySelector('[data-testid="file-tree-panel"]')?.textContent).toContain('Loading')
    expect(listFiles).not.toHaveBeenCalled()
  })

  it('opens an Inbox thread from F12 without selecting a Sessions terminal', async () => {
    const thread: InboxThread = {
      id: 'ses_inbox', title: 'Inbox conversation', directory: '/workspace/inbox', target: { kind: 'native' },
      folderId: 'fld_inbox', branch: 'main', status: 'working', createdAt: 1, lastActivityAt: 1, readAt: 1, archived: false,
    }
    useWorkspace.setState({
      windowMode: 'mini',
      inboxThreads: [thread],
    })
    const container = await render()
    const rows = container.querySelectorAll<HTMLButtonElement>('[data-testid="mini-inbox-row"]')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.textContent).toContain('Inbox conversation')
    expect(paneCount()).toBe(0)

    await act(async () => rows[0]?.click())
    expect(useWorkspace.getState().windowMode).toBe('normal')
    expect(useWorkspace.getState().activeWorkspaceView).toBe('inbox')
    expect(useWorkspace.getState().selectedInboxThreadId).toBe(thread.id)
    expect(useWorkspace.getState().selectedSessionId).toBe('alpha')
  })
  it('follows pane selection and directory reports, with previews scoped to each root', async () => {
    const first = terminalIdForPane('alpha', 'alpha-tab', 'pane-1')
    const second = terminalIdForPane('alpha', 'alpha-tab', 'pane-2')
    useWorkspace.setState({ statuses: { [first]: 'running', [second]: 'running' }, openFiles: {}, terminalDirectories: { [first]: '/workspace/first', [second]: '/workspace/second' } })
    const container = await render()
    expect(listFiles).toHaveBeenLastCalledWith({ terminalId: first, directory: '/workspace/first', path: '' })
    const titleBars = container.querySelectorAll('[data-testid="terminal-pane-title-bar"]')
    await act(async () => titleBars[1]?.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(listFiles).toHaveBeenLastCalledWith({ terminalId: second, directory: '/workspace/second', path: '' })
    await act(async () => useWorkspace.getState().openFile(fileRootKey({ terminalId: second, directory: '/workspace/second' }), 'README.md'))
    expect(viewerPath()).toBe('README.md')
    await act(async () => useWorkspace.getState().setTerminalDirectory({ terminalId: second, directory: '/workspace/new' }))
    expect(listFiles).toHaveBeenLastCalledWith({ terminalId: second, directory: '/workspace/new', path: '' })
    expect(viewerPath()).toBeNull()
    await act(async () => titleBars[0]?.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(listFiles).toHaveBeenLastCalledWith({ terminalId: first, directory: '/workspace/first', path: '' })
  })

})
