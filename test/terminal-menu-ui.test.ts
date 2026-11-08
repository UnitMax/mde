// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalView } from '../src/renderer/components/TerminalView'
import { InboxTerminal } from '../src/renderer/components/inbox/InboxTerminal'
import { registerThreadInput } from '../src/renderer/lib/inbox-thread-input'
import { inboxTerminalSession } from '../src/shared/inbox-terminal'
import { useWorkspace } from '../src/renderer/store/workspace'
import { createRuntimeLayout, defaultSessionTab } from '../src/renderer/terminal/tabs'
import type { Session } from '../src/shared/types'

// What the pane's terminal says about itself; each test sets it.
const screen = vi.hoisted(() => ({ selection: '', tracking: 'none' as string, focus: vi.fn() }))
vi.mock('../src/renderer/terminal/sessions', () => {
  const fake = (terminalId: string) => ({
    terminalId,
    term: {
      focus: screen.focus,
      reset: vi.fn(),
      paste: vi.fn(),
      dispose: vi.fn(),
      hasSelection: () => screen.selection.length > 0,
      getSelection: () => screen.selection,
      modes: { get mouseTrackingMode() { return screen.tracking } },
    },
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
const writeText = vi.fn(async (_text: string): Promise<void> => undefined)
let root: Root
let container: HTMLDivElement
const render = (element: ReactElement): Promise<void> => act(async () => root.render(element))
const items = (): HTMLElement[] => Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'))
const labels = (): string[] => items().map((item) => item.textContent?.trim() ?? '')
const disabled = (testId: string): boolean => document.body.querySelector(`[data-testid="${testId}"]`)!.hasAttribute('data-disabled')

async function rightClick(init: MouseEventInit = {}): Promise<MouseEvent> {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20, button: 2, ...init })
  await act(async () => container.querySelector('.terminal-host')!.dispatchEvent(event))
  return event
}
const choose = (testId: string): Promise<void> => act(async () => document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!.click())

function sessionsTerminal(): ReactElement {
  const layout = createRuntimeLayout(session.id, defaultSessionTab(session.id))
  return createElement(TerminalView, {
    session,
    activeTab: defaultSessionTab(session.id),
    terminalLayout: layout,
    onSelectTab: vi.fn(), onAddTab: vi.fn(), onTabRenameStart: vi.fn(), onRenameTab: vi.fn(), onCloseTab: vi.fn(),
    onSplitPane: vi.fn(), onLayoutResize: vi.fn(), onPaneOrderChange: vi.fn(), onClosePane: vi.fn(), onPaneFocus: vi.fn(), onPaneTitleChange: vi.fn(),
  })
}

beforeEach(() => {
  localStorage.clear()
  writeText.mockClear()
  screen.selection = ''
  screen.tracking = 'none'
  screen.focus.mockClear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} unobserve(): void {} })
  vi.stubGlobal('api', {
    clipboard: { writeText },
    pty: { ensure: vi.fn(async () => 'running'), resize: vi.fn(async () => {}), statuses: vi.fn(async () => ({})), configureInbox: vi.fn(async () => ({ session: inboxTerminalSession('darwin', []), changed: false })) },
    git: { terminalInfo: vi.fn(async () => null) },
  })
  useWorkspace.setState({
    platform: { platform: 'darwin', isWindows: false }, wslAvailable: false, distros: [], statuses: {}, exits: {}, terminalDirectories: {},
    inboxThreads: [], selectedInboxThreadId: null,
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('the right-click menu of a Sessions terminal', () => {
  it('offers Copy alone, which copies the selection and gives the keyboard back to the terminal', async () => {
    screen.selection = 'Error: boom\n    at fn (a.js:1)'
    await render(sessionsTerminal())
    await rightClick()
    expect(labels()).toEqual(['Copy'])
    await choose('terminal-menu-copy')
    expect(writeText).toHaveBeenCalledExactlyOnceWith('Error: boom\n    at fn (a.js:1)')
    await vi.waitFor(() => expect(screen.focus).toHaveBeenCalled())
  })

  it('has nothing to copy without a selection', async () => {
    await render(sessionsTerminal())
    await rightClick()
    expect(disabled('terminal-menu-copy')).toBe(true)
    await choose('terminal-menu-copy')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies what was selected when the menu opened', async () => {
    screen.selection = 'first'
    await render(sessionsTerminal())
    await rightClick()
    screen.selection = 'changed while the menu was open'
    await choose('terminal-menu-copy')
    expect(writeText).toHaveBeenCalledExactlyOnceWith('first')
  })

  it('leaves the click to a program that uses the mouse, unless Shift is held', async () => {
    screen.selection = 'text'
    screen.tracking = 'vt200'
    await render(sessionsTerminal())
    const refused = await rightClick()
    expect(items()).toHaveLength(0)
    expect(refused.defaultPrevented).toBe(true)
    await rightClick({ shiftKey: true })
    expect(labels()).toEqual(['Copy'])
  })
})

describe('the right-click menu of the Inbox terminal', () => {
  const openThread = (id = 'ses_1'): void => useWorkspace.setState({
    inboxThreads: [{ id, title: 'Fix login' } as never],
    selectedInboxThreadId: id,
  })

  it('also offers to send the selection to the open thread, once the menu has closed', async () => {
    openThread()
    const input = vi.fn()
    const stop = registerThreadInput('ses_1', input)
    screen.selection = 'Error: boom'
    await render(createElement(InboxTerminal))
    screen.focus.mockClear()
    await rightClick()
    expect(labels()).toEqual(['Copy', 'Send to thread'])
    await choose('terminal-menu-send')
    await vi.waitFor(() => expect(input).toHaveBeenCalledExactlyOnceWith('Error: boom'))
    // Copy was not asked for, and the thread takes the keyboard rather than the terminal.
    expect(writeText).not.toHaveBeenCalled()
    expect(screen.focus).not.toHaveBeenCalled()
    stop()
  })

  it('cannot send without a thread open, or without a selection', async () => {
    screen.selection = 'text'
    await render(createElement(InboxTerminal))
    await rightClick()
    expect(disabled('terminal-menu-send')).toBe(true)
    expect(disabled('terminal-menu-copy')).toBe(false)
    await act(async () => document.body.querySelector<HTMLElement>('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await vi.waitFor(() => expect(items()).toHaveLength(0))

    openThread()
    screen.selection = ''
    await rightClick()
    expect(disabled('terminal-menu-send')).toBe(true)
  })
})
