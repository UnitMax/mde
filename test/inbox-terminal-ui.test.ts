// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalView } from '../src/renderer/components/TerminalView'
import { InboxTerminal } from '../src/renderer/components/inbox/InboxTerminal'
import { INBOX_TERMINAL_SESSION_ID } from '../src/shared/inbox-terminal'
import { INBOX_TERMINAL_TAB, useInboxTerminal } from '../src/renderer/store/inbox-terminal'
import { useWorkspace } from '../src/renderer/store/workspace'
import { createRuntimeLayout, defaultSessionTab, splitRuntimePane } from '../src/renderer/terminal/tabs'
import { attachSession, detachSession } from '../src/renderer/terminal/sessions'
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
    attachSession: vi.fn((terminalId: string, host: HTMLElement) => {
      const session = fake(terminalId)
      host.append(session.container)
      return session
    }),
    detachSession: vi.fn(),
    disposeSession: vi.fn(),
    fitSession: () => ({ cols: 80, rows: 24 }),
    getSession: (terminalId: string) => fake(terminalId),
  }
})

const session: Session = { id: 'ses-1', name: 'My session', kind: 'native', createdAt: '' }
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
    onSplitPane: vi.fn(),
    onLayoutResize: vi.fn(),
    onPaneOrderChange: vi.fn(),
    onAddPane: vi.fn(),
    onClosePane: vi.fn(),
    onPaneFocus: vi.fn(),
    onPaneTitleChange: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  vi.stubGlobal('api', { pty: { ensure: vi.fn(async () => 'running'), resize: vi.fn(async () => {}), statuses: vi.fn(async () => ({})) }, git: { terminalInfo: vi.fn(async () => null) } })
  useWorkspace.setState({ platform: { platform: 'darwin', isWindows: false }, wslAvailable: false, distros: [], statuses: {}, exits: {}, terminalDirectories: {} })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const controls = () => container.querySelectorAll('[data-testid="terminal-split-controls"]')
const host = () => container.querySelector('.terminal-host')!
const initial = () => createRuntimeLayout(session.id, defaultSessionTab(session.id))
const release = () => act(async () => {
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', ctrlKey: false, bubbles: true }))
})

describe('TerminalView dynamic splits', () => {
  it('shows the session tabs directly above its panes', async () => {
    await render(createElement(TerminalView, props(initial())))
    expect(container.querySelector('[role="tablist"]')).not.toBeNull()
    expect(container.querySelector('header:not([data-testid="terminal-pane-title-bar"])')).toBeNull()
    expect(container.querySelectorAll('.terminal-host')).toHaveLength(1)
    expect(layoutButtons()).toHaveLength(0)
    expect(controls()).toHaveLength(0)
  })

  it.each(['left', 'right', 'top', 'bottom'] as const)('reveals controls while Ctrl is held and splits to the %s', async (side) => {
    const layout = initial()
    const view = props(layout)
    await render(createElement(TerminalView, view))
    await press(host(), 'Control')
    expect(controls()).toHaveLength(1)
    await act(async () => container.querySelector<HTMLElement>(`[data-testid="terminal-split-${side}"]`)!.click())
    expect(view.onSplitPane).toHaveBeenCalledWith(layout.panes[0]!.terminalId, side)
    expect(view.onClosePane).not.toHaveBeenCalled()
    await release()
    expect(controls()).toHaveLength(0)
  })

  it('hides split controls on blur and while Ctrl+Shift is used for pane switching', async () => {
    await render(createElement(TerminalView, props(initial())))
    await press(host(), 'Control')
    await press(host(), 'Shift', { shiftKey: true })
    expect(controls()).toHaveLength(0)
    await press(host(), 'Control')
    expect(controls()).toHaveLength(1)
    await act(async () => window.dispatchEvent(new Event('blur')))
    expect(controls()).toHaveLength(0)
  })

  it('leaves Ctrl+digits available to the terminal', async () => {
    const view = props(initial())
    await render(createElement(TerminalView, view))
    const event = new KeyboardEvent('keydown', { key: '2', code: 'Digit2', ctrlKey: true, bubbles: true, cancelable: true })
    await act(async () => host().dispatchEvent(event))
    expect(event.defaultPrevented).toBe(false)
    expect(view.onSplitPane).not.toHaveBeenCalled()
  })

  it('leaves fullscreen when adding a terminal beside the fullscreen pane', async () => {
    const base = initial()
    const two = splitRuntimePane(session.id, 't', base, base.panes[0]!.terminalId, 'right')!
    const view = props(two)
    await render(createElement(TerminalView, view))
    await act(async () => container.querySelector<HTMLElement>('[aria-label="Enter terminal fullscreen"]')!.click())
    expect(container.querySelectorAll('.terminal-host')).toHaveLength(1)
    await press(host(), 'Control')
    await act(async () => container.querySelector<HTMLElement>('[data-testid="terminal-split-bottom"]')!.click())
    expect(view.onSplitPane).toHaveBeenCalledWith(two.panes[0]!.terminalId, 'bottom')
    expect(container.querySelectorAll('.terminal-host')).toHaveLength(2)
  })

  it('keeps live terminal surfaces mounted while splitting a pane in any direction', async () => {
    let layout = initial()
    await render(createElement(TerminalView, props(layout)))
    const firstHost = host()
    for (const side of ['left', 'top', 'right', 'bottom'] as const) {
      layout = splitRuntimePane(session.id, defaultSessionTab(session.id).id, layout, layout.panes[0]!.terminalId, side)!
      await render(createElement(TerminalView, props(layout)))
      expect(firstHost.isConnected).toBe(true)
    }
    expect(attachSession).toHaveBeenCalledTimes(5)
    expect(detachSession).not.toHaveBeenCalled()
    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(4)
  })

  it('resizes a nested divider using its own region and restores pointer styles', async () => {
    const base = initial()
    const two = splitRuntimePane(session.id, 't', base, base.panes[0]!.terminalId, 'right')!
    const three = splitRuntimePane(session.id, 't', two, two.panes[1]!.terminalId, 'bottom')!
    const view = props(three)
    await render(createElement(TerminalView, view))
    const separator = container.querySelector<HTMLElement>('[aria-orientation="horizontal"]')!
    vi.spyOn(separator.parentElement!, 'getBoundingClientRect').mockReturnValue({ left: 500, top: 100, width: 500, height: 400 } as DOMRect)
    separator.setPointerCapture = vi.fn()
    separator.hasPointerCapture = () => true
    separator.releasePointerCapture = vi.fn()
    const pointer = (type: string, y: number) => act(async () => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 600, clientY: y })
      Object.assign(event, { pointerId: 1 })
      separator.dispatchEvent(event)
    })
    await pointer('pointerdown', 300)
    expect(document.body.style.cursor).toBe('row-resize')
    await pointer('pointermove', 260)
    await pointer('pointerup', 260)
    expect(view.onLayoutResize).toHaveBeenLastCalledWith(three.tree.type === 'split' && three.tree.second.type === 'split' ? three.tree.second.id : '', (160 - 0.5) / 399)
    expect(document.body.style.cursor).toBe('')
    expect(separator.releasePointerCapture).toHaveBeenCalledWith(1)
  })

  it('supports keyboard resizing of individual dividers', async () => {
    const base = initial()
    const two = splitRuntimePane(session.id, 't', base, base.panes[0]!.terminalId, 'right')!
    const view = props(two)
    await render(createElement(TerminalView, view))
    await press(container.querySelector('[role="separator"]')!, 'ArrowRight', { ctrlKey: false })
    expect(view.onLayoutResize).toHaveBeenCalledWith(two.tree.type === 'split' ? two.tree.id : '', 0.52)
  })
})

describe('TerminalView embedded in the Inbox sidebar', () => {
  const embedded = (overrides: Record<string, unknown> = {}) => createElement(TerminalView, props(initial(), { embedded: true, ...overrides }))

  it('embeds the panes without session chrome', async () => {
    await render(embedded())
    expect(container.querySelector('[role="tablist"]')).toBeNull()
    expect(container.querySelector('header:not([data-testid="terminal-pane-title-bar"])')).toBeNull()
    expect(container.querySelectorAll('.terminal-host')).toHaveLength(1)
    expect(layoutButtons()).toHaveLength(0)
  })

  it('shows controls only while the keyboard is inside the terminal', async () => {
    const outside = document.createElement('textarea')
    document.body.append(outside)
    await render(embedded())
    await press(outside, 'Control')
    expect(controls()).toHaveLength(0)
    await press(host(), 'Control')
    expect(controls()).toHaveLength(1)
    outside.remove()
  })

  it('clears the controls when focus moves back to the composer', async () => {
    const outside = document.createElement('textarea')
    document.body.append(outside)
    await render(embedded())
    await press(host(), 'Control')
    expect(controls()).toHaveLength(1)
    await act(async () => outside.focus())
    expect(controls()).toHaveLength(0)
    outside.remove()
  })
})

describe('InboxTerminal', () => {
  beforeEach(() => useInboxTerminal.setState({ layout: createRuntimeLayout(INBOX_TERMINAL_SESSION_ID, INBOX_TERMINAL_TAB) }))

  it('uses the Inbox session and follows the split store', async () => {
    await render(createElement(InboxTerminal))
    expect(container.querySelector('[role="tablist"]')).toBeNull()
    await vi.waitFor(() => expect(window.api.pty.ensure).toHaveBeenCalled())
    expect(vi.mocked(window.api.pty.ensure).mock.calls[0]![0]).toMatchObject({ sessionId: 'inbox-terminal' })
    await press(host(), 'Control')
    await act(async () => container.querySelector<HTMLElement>('[data-testid="terminal-split-bottom"]')!.click())
    expect(useInboxTerminal.getState().layout.tree).toMatchObject({ type: 'split', axis: 'row' })
    expect(container.querySelectorAll('.terminal-host')).toHaveLength(2)
    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(1)
  })

  it('says what is missing on Windows without WSL', async () => {
    useWorkspace.setState({ platform: { platform: 'win32', isWindows: true }, distros: [] })
    await render(createElement(InboxTerminal))
    expect(container.textContent).toContain('needs a WSL distribution')
    expect(container.querySelectorAll('.terminal-host')).toHaveLength(0)
  })

  it('uses the default WSL distro on Windows', async () => {
    useWorkspace.setState({ platform: { platform: 'win32', isWindows: true }, distros: [{ name: 'Debian', state: 'Running', version: 2, isDefault: true }] })
    await render(createElement(InboxTerminal))
    await vi.waitFor(() => expect(window.api.pty.ensure).toHaveBeenCalled())
  })
})
