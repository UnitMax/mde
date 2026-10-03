// @vitest-environment happy-dom

import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenCodeSessionSummary, Session } from '../src/shared/types'
import { OpenCodeSessionsDialog } from '../src/renderer/components/OpenCodeSessionsDialog'
import { TerminalView } from '../src/renderer/components/TerminalView'
import { useWorkspace } from '../src/renderer/store/workspace'

const terminalFocus = vi.hoisted(() => vi.fn())
vi.mock('../src/renderer/terminal/sessions', () => ({
  attachSession: () => ({ term: { focus: terminalFocus } }),
  detachSession: vi.fn(), fitSession: () => null,
  getSession: () => ({ term: { focus: terminalFocus } }), applyTerminalSettings: vi.fn()
}))
vi.mock('../src/renderer/components/TerminalGitInfo', () => ({ TerminalGitInfo: () => null }))

const roots: Root[] = []
const list = vi.fn()
const onSelect = vi.fn()
const onOpenChange = vi.fn()
const restoreFocus = vi.fn()
const session: Session = {
  id: 'workspace-1', projectId: 'project-1', name: 'App', kind: 'wsl',
  distro: 'Ubuntu-24.04', path: '/workspace/current', createdAt: '2026-01-01T00:00:00Z'
}
const sessions: OpenCodeSessionSummary[] = [
  { id: 'ses_new', title: 'New frontend work', directory: '/workspace/frontend', createdAt: 100, updatedAt: 300,
    model: { id: 'model-1', providerId: 'provider-1' }, agent: 'build', parentId: 'ses_parent', archivedAt: 400,
    changes: { files: 2, additions: 10, deletions: 3 }, tokens: { input: 100, output: 20 }, cost: 0.12 },
  { id: 'ses_old', title: 'Backend work', directory: '/workspace/backend', createdAt: 50, updatedAt: 200 }
]

function newRoot(): Root {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  return root
}

async function renderDialog(overrides: Partial<ComponentProps<typeof OpenCodeSessionsDialog>> = {}) {
  const root = newRoot()
  let props: ComponentProps<typeof OpenCodeSessionsDialog> = {
    open: true, onOpenChange, session, sourceTerminalId: 'source-pane', paneCount: 1,
    onSelect, onRestoreFocus: restoreFocus, ...overrides
  }
  const update = async (patch: Partial<typeof props> = {}) => {
    props = { ...props, ...patch }
    await act(async () => root.render(createElement(OpenCodeSessionsDialog, props)))
  }
  await update()
  return { update }
}

function input(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('[aria-label="Search OpenCode sessions"]')!
}

async function key(target: Element, value: string, modifiers: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...modifiers })
  await act(async () => target.dispatchEvent(event))
  return event
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  Object.defineProperty(window, 'api', { configurable: true, value: { opencodeSessions: { list } } })
  list.mockReset().mockResolvedValue(sessions)
  onSelect.mockReset()
  onOpenChange.mockReset()
  restoreFocus.mockReset()
  terminalFocus.mockReset()
  useWorkspace.setState({
    platform: { platform: 'win32', isWindows: true }, wslAvailable: true,
    opencodeTuiInstances: {}, codexTuiInstances: {}, terminalDirectories: {},
    statuses: { 'source-pane': 'running' }, exits: {}, terminalTaskLinks: {}
  })
})

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()))
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'api')
  vi.unstubAllGlobals()
})

describe('OpenCode session picker dialog', () => {
  it('loads every directory, focuses search, and displays available metadata and session labels', async () => {
    await renderDialog()
    expect(list).toHaveBeenCalledWith({ sessionId: session.id, sourceTerminalId: 'source-pane', executable: 'opencode' })
    expect(document.activeElement).toBe(input())
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2)
    const text = document.querySelector('[role="dialog"]')?.textContent
    for (const value of ['/workspace/frontend', '/workspace/backend', 'provider-1/model-1', 'build', '2 files', '+10', '−3', 'Subagent', 'Archived', 'Input: 100', 'Reported cost: $0.12']) {
      expect(text).toContain(value)
    }
    expect(document.querySelector('[data-testid="opencode-session-details"]')?.textContent).toContain('ses_new')
  })

  it('moves across directory groups with arrow keys and opens the selected session with Enter', async () => {
    await renderDialog()
    await key(input(), 'ArrowDown')
    expect(input().getAttribute('aria-activedescendant')).toBe('opencode-result-ses_old')
    await key(input(), 'Enter')
    expect(onSelect).toHaveBeenCalledWith({ sourceTerminalId: 'source-pane', executable: 'opencode', opencodeSessionId: 'ses_old' })
  })

  it('shows the current directory first and keeps full metadata available as selection changes', async () => {
    await renderDialog({ currentDirectory: '/workspace/backend/' })
    expect(Array.from(document.querySelectorAll('[role="group"]')).map((group) => group.getAttribute('aria-label')))
      .toEqual(['/workspace/backend', '/workspace/frontend'])
    expect(document.querySelector('[role="option"]')?.textContent).toContain('Backend work')
    expect(input().getAttribute('aria-activedescendant')).toBe('opencode-result-ses_old')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Current directory')
    await key(input(), 'ArrowDown')
    const details = document.querySelector('[data-testid="opencode-session-details"]')?.textContent
    for (const value of ['Created', 'Updated', 'provider-1/model-1', '2 files', 'Input: 100', 'Reported cost: $0.12']) {
      expect(details).toContain(value)
    }
    expect(document.querySelector('[data-session-id="ses_new"]')?.textContent).not.toContain('Created')
  })

  it('uses the workspace directory when the live terminal directory is unavailable', async () => {
    await renderDialog({ session: { ...session, path: '/workspace/backend' } })
    expect(input().getAttribute('aria-activedescendant')).toBe('opencode-result-ses_old')
  })

  it('opens a clicked row and blocks both mouse and keyboard selection when the tab is full', async () => {
    const { update } = await renderDialog({ paneCount: 6 })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('This tab is full. No more terminals can be opened.')
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('Enter to open')
    await act(async () => document.querySelector<HTMLButtonElement>('[role="option"]')!.click())
    await key(input(), 'Enter')
    expect(onSelect).not.toHaveBeenCalled()
    await update({ paneCount: 5 })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Enter to open')
    await act(async () => document.querySelector<HTMLButtonElement>('[data-session-id="ses_old"]')!.click())
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ opencodeSessionId: 'ses_old' }))
  })

  it('closes with Escape and restores terminal focus on cancellation', async () => {
    const { update } = await renderDialog()
    await key(input(), 'Escape')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    await update({ open: false })
    await vi.waitFor(() => expect(restoreFocus).toHaveBeenCalled())
  })

  it('keeps focus restoration from stealing focus from a newly opened terminal', async () => {
    const { update } = await renderDialog()
    await key(input(), 'Enter')
    await update({ open: false })
    expect(restoreFocus).not.toHaveBeenCalled()
  })

  it('reports query errors and allows refreshing', async () => {
    list.mockRejectedValueOnce(new Error('History unavailable'))
    await renderDialog()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('History unavailable')
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Refresh OpenCode sessions"]')!.click())
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2)
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('shows the empty state and ignores responses from a previous source terminal', async () => {
    let resolve!: (value: OpenCodeSessionSummary[]) => void
    list.mockReturnValueOnce(new Promise<OpenCodeSessionSummary[]>((done) => { resolve = done }))
      .mockResolvedValueOnce([])
    const { update } = await renderDialog()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Loading session history')
    await update({ sourceTerminalId: 'other-pane' })
    await act(async () => resolve(sessions))
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('No OpenCode sessions yet.')
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0)
  })
})

async function renderTerminal(target: Session = session) {
  const onAddPane = vi.fn()
  const root = newRoot()
  await act(async () => root.render(createElement(TerminalView, {
    session: target,
    activeTab: { id: 'tab-1', name: 'Tab 1', layout: {
      layout: 'columns', panes: [{ id: 'pane-1' }, { id: 'pane-2' }], sizes: { columnRatio: 0.5, rowRatio: 0.5 }
    } },
    terminalLayout: { layout: 'columns', panes: [{ terminalId: 'source-pane' }, { terminalId: 'second-pane' }], sizes: { columnRatio: 0.5, rowRatio: 0.5 } },
    onAddPane, onSelectTab: vi.fn(), onAddTab: vi.fn(), onTabRenameStart: vi.fn(), onRenameTab: vi.fn(),
    onCloseTab: vi.fn(), onLayoutChange: vi.fn(), onLayoutResize: vi.fn(), onPaneOrderChange: vi.fn(),
    onReduceLayout: vi.fn(), onClosePane: vi.fn(), onPaneFocus: vi.fn(), onPaneTitleChange: vi.fn(), onLinkTask: vi.fn()
  })))
  return { onAddPane }
}

describe('terminal history entry points', () => {
  it('prioritizes the source terminal live directory over the workspace directory', async () => {
    useWorkspace.setState({ terminalDirectories: { 'source-pane': '/workspace/backend' } })
    await renderTerminal()
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="terminal-opencode-sessions-source-pane"]')!.click())
    expect(input().getAttribute('aria-activedescendant')).toBe('opencode-result-ses_old')
    await key(input(), 'Enter')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it('opens from the pane toolbar and exits fullscreen when selection adds a pane', async () => {
    const { onAddPane } = await renderTerminal()
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="terminal-fullscreen-toggle-source-pane"]')!.click())
    expect(document.querySelectorAll('.terminal-host')).toHaveLength(1)
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="terminal-opencode-sessions-source-pane"]')!.click())
    await key(input(), 'Enter')
    expect(onAddPane).toHaveBeenCalledWith('source-pane', { sourceTerminalId: 'source-pane', opencodeSessionId: 'ses_new', executable: 'opencode' })
    expect(document.querySelectorAll('.terminal-host')).toHaveLength(2)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('opens with Ctrl+Shift+O from the focused terminal and consumes the shortcut', async () => {
    await renderTerminal()
    const host = document.querySelector('.terminal-host')!
    const textarea = document.createElement('textarea')
    host.append(textarea)
    await act(async () => textarea.focus())
    const event = await key(textarea, 'O', { ctrlKey: true, shiftKey: true })
    expect(event.defaultPrevented).toBe(true)
    expect(input()).not.toBeNull()
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ sourceTerminalId: 'source-pane' }))
    const count = list.mock.calls.length
    await key(input(), 'O', { ctrlKey: true, shiftKey: true })
    expect(list).toHaveBeenCalledTimes(count)
  })

  it('keeps the entry points unavailable for native terminals', async () => {
    await renderTerminal({ ...session, kind: 'native', distro: undefined })
    expect(document.querySelector('[aria-label="Open OpenCode sessions"]')).toBeNull()
    const textarea = document.createElement('textarea')
    document.querySelector('.terminal-host')!.append(textarea)
    await act(async () => textarea.focus())
    const event = await key(textarea, 'O', { ctrlKey: true, shiftKey: true })
    expect(event.defaultPrevented).toBe(false)
    expect(list).not.toHaveBeenCalled()
  })
})
