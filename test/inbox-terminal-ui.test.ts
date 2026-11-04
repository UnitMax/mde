// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalView } from '../src/renderer/components/TerminalView'
import { InboxTerminal } from '../src/renderer/components/inbox/InboxTerminal'
import { INBOX_TERMINAL_SESSION_ID } from '../src/shared/inbox-terminal'
import { INBOX_TERMINAL_TAB, useInboxTerminal } from '../src/renderer/store/inbox-terminal'
import { useWorkspace } from '../src/renderer/store/workspace'
import { createRuntimeLayout, defaultSessionTab } from '../src/renderer/terminal/tabs'
import { layoutSwitched } from '../src/renderer/terminal/layout-edits'
import type { SessionTerminalLayout } from '../src/renderer/terminal/layout'
import type { Session } from '../src/shared/types'

// xterm.js needs a real browser. The pane only needs something with a screen to put in its host.
vi.mock('../src/renderer/terminal/sessions', () => {
  const fake = (terminalId: string) => ({
    terminalId,
    term: { focus: vi.fn(), reset: vi.fn(), paste: vi.fn(), dispose: vi.fn() },
    container: document.createElement('div'),
    themeId: 'dark',
  })
  return {
    attachSession: (terminalId: string, host: HTMLElement) => {
      const session = fake(terminalId)
      host.append(session.container)
      return session
    },
    detachSession: vi.fn(),
    disposeSession: vi.fn(),
    fitSession: () => ({ cols: 80, rows: 24 }),
    getSession: (terminalId: string) => fake(terminalId),
  }
})

const session: Session = { id: 'ses-1', projectId: 'p', name: 'My project', kind: 'native', path: '/home/me/app', createdAt: '' }
let root: Root
let container: HTMLDivElement
const render = (element: ReactElement): Promise<void> => act(async () => root.render(element))
const layoutButtons = (): HTMLElement[] => Array.from(container.querySelectorAll<HTMLElement>('[data-testid^="terminal-layout-"]'))
const press = (target: Element, key: string, init: KeyboardEventInit = {}): Promise<void> =>
  act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true, ...init })) })

function props(layout: SessionTerminalLayout, overrides: Record<string, unknown> = {}) {
  return {
    session,
    activeTab: defaultSessionTab(session.id),
    terminalLayout: layout,
    onSelectTab: vi.fn(),
    onAddTab: vi.fn(),
    onTabRenameStart: vi.fn(),
    onRenameTab: vi.fn(),
    onCloseTab: vi.fn(),
    onLayoutChange: vi.fn(),
    onLayoutResize: vi.fn(),
    onPaneOrderChange: vi.fn(),
    onReduceLayout: vi.fn(),
    onAddPane: vi.fn(),
    onClosePane: vi.fn(),
    onPaneFocus: vi.fn(),
    onPaneTitleChange: vi.fn(),
    onLinkTask: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  vi.stubGlobal('api', { pty: { ensure: vi.fn(async () => 'running'), resize: vi.fn(async () => {}), statuses: vi.fn(async () => ({})) }, git: { terminalInfo: vi.fn(async () => null) } })
  useWorkspace.setState({ platform: { platform: 'darwin', isWindows: false }, wslAvailable: false, distros: [], statuses: {}, exits: {}, terminalDirectories: {}, terminalTaskLinks: {} })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('TerminalView in the Projects view', () => {
  it('keeps its tab strip, its session name and its location', async () => {
    const view = props(createRuntimeLayout(session.id, defaultSessionTab(session.id)))
    await render(createElement(TerminalView, view))
    expect(container.querySelector('[role="tablist"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="New terminal tab"]')).not.toBeNull()
    expect(container.textContent).toContain('My project')
    expect(container.textContent).toContain('/home/me/app')
    expect(layoutButtons()).toHaveLength(9)
  })

  it('answers a layout shortcut typed anywhere', async () => {
    const view = props(createRuntimeLayout(session.id, defaultSessionTab(session.id)))
    await render(createElement(TerminalView, view))
    await press(document.body, '2')
    expect(view.onLayoutChange).toHaveBeenCalledWith('columns')
  })
})

describe('TerminalView embedded in the Inbox sidebar', () => {
  const embedded = (overrides: Record<string, unknown> = {}) =>
    createElement(TerminalView, props(createRuntimeLayout(session.id, defaultSessionTab(session.id)), { embedded: true, onLinkTask: undefined, ...overrides }))

  it('has no tab strip and no session name, only the location and the layout picker', async () => {
    await render(embedded())
    expect(container.querySelector('[role="tablist"]')).toBeNull()
    expect(container.querySelector('[aria-label="New terminal tab"]')).toBeNull()
    expect(container.textContent).not.toContain('My project')
    expect(container.textContent).toContain('/home/me/app')
    expect(layoutButtons()).toHaveLength(9)
  })

  it('switches layout from the picker', async () => {
    const onLayoutChange = vi.fn()
    await render(embedded({ onLayoutChange }))
    await act(async () => container.querySelector<HTMLElement>('[data-testid="terminal-layout-quadrant"]')!.click())
    expect(onLayoutChange).toHaveBeenCalledWith('quadrant')
  })

  it('asks before a smaller layout closes terminals', async () => {
    const four = layoutSwitched(createRuntimeLayout(session.id, defaultSessionTab(session.id)), 'quadrant', session.id, 't')!
    const onReduceLayout = vi.fn()
    await render(createElement(TerminalView, props(four, { embedded: true, onLinkTask: undefined, onReduceLayout })))
    await act(async () => container.querySelector<HTMLElement>('[data-testid="terminal-layout-columns"]')!.click())
    expect(document.body.textContent).toContain('Close extra terminals?')
    expect(onReduceLayout).not.toHaveBeenCalled()
  })

  it('offers no To Do link, even for a running terminal', async () => {
    const layout = createRuntimeLayout(session.id, defaultSessionTab(session.id))
    useWorkspace.setState({ statuses: { [layout.panes[0]!.terminalId]: 'running' } })
    await render(embedded())
    expect(container.querySelector('[data-testid^="terminal-task-link-"]')).toBeNull()
  })

  it('answers a layout shortcut only while the keyboard is inside it, so typing elsewhere is left alone', async () => {
    const onLayoutChange = vi.fn()
    const outside = document.createElement('textarea')
    document.body.append(outside)
    await render(embedded({ onLayoutChange }))
    await press(outside, '2')
    expect(onLayoutChange).not.toHaveBeenCalled()
    await press(container.querySelector('[data-testid="terminal-layout-single"]')!, '2')
    expect(onLayoutChange).toHaveBeenCalledWith('columns')
    outside.remove()
  })
})

describe('InboxTerminal', () => {
  beforeEach(() => {
    useInboxTerminal.setState({ layout: createRuntimeLayout(INBOX_TERMINAL_SESSION_ID, INBOX_TERMINAL_TAB) })
  })

  it('shows the Inbox terminal at `~`, starts its shell in the Inbox terminal session, and follows the store', async () => {
    await render(createElement(InboxTerminal))
    expect(container.textContent).toContain('~')
    expect(container.querySelector('[role="tablist"]')).toBeNull()
    expect(layoutButtons()).toHaveLength(9)
    await vi.waitFor(() => expect(window.api.pty.ensure).toHaveBeenCalled())
    expect(vi.mocked(window.api.pty.ensure).mock.calls[0]![0]).toMatchObject({ sessionId: 'inbox-terminal' })

    await act(async () => container.querySelector<HTMLElement>('[data-testid="terminal-layout-columns"]')!.click())
    expect(useInboxTerminal.getState().layout.layout).toBe('columns')
    expect(container.querySelector('[data-testid="terminal-layout-columns"]')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('says what is missing on Windows without a WSL distribution', async () => {
    useWorkspace.setState({ platform: { platform: 'win32', isWindows: true }, distros: [] })
    await render(createElement(InboxTerminal))
    expect(container.textContent).toContain('needs a WSL distribution')
    expect(layoutButtons()).toHaveLength(0)
  })

  it('is a WSL shell in the default distro on Windows', async () => {
    useWorkspace.setState({ platform: { platform: 'win32', isWindows: true }, distros: [{ name: 'Debian', state: 'Running', version: 2, isDefault: true }] })
    await render(createElement(InboxTerminal))
    await vi.waitFor(() => expect(window.api.pty.ensure).toHaveBeenCalled())
    expect(container.textContent).toContain('~')
  })
})
