// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../src/shared/types'
import { Sidebar } from '../src/renderer/components/Sidebar'
import { useWorkspace } from '../src/renderer/store/workspace'
import { sessionTabs } from '../src/renderer/terminal/tabs'
import { TERMINAL_SETTINGS_STORAGE_KEY } from '../src/renderer/terminal/terminal-settings'
import { testLayout } from './helpers/terminal-layout'

const session: Session = {
  id: 'session-1', name: 'Frontend', kind: 'native',
  createdAt: '2026-01-01T00:00:00.000Z',
}
const terminals = ['pane-first', 'pane-second', 'pane-third']
const tab = sessionTabs(session)[0]!
let root: Root
let container: HTMLDivElement
const onFocusTerminal = vi.fn()

function render(): void {
  act(() => root.render(createElement(Sidebar, {
    onNewTodoProject: vi.fn(), onNewTodoTask: vi.fn(), onNewSession: vi.fn(), onFocusTerminal,
    terminalLayouts: { [session.id]: { [tab.id]: testLayout(terminals.map((terminalId) => ({ terminalId }))) } },
  })))
}

describe('sidebar terminal instances', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    localStorage.clear()
    onFocusTerminal.mockClear()
    useWorkspace.setState({
      sessions: [session], activeWorkspaceView: 'sessions', selectedSessionId: null, sidebarCollapsed: false,
      terminalDirectories: {},
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('hides individual panes by default', () => {
    render()
    expect(container.querySelector('[data-testid="terminal-instances"]')).toBeNull()
  })

  it('lists panes in layout order when enabled and focuses the clicked pane', () => {
    localStorage.setItem(TERMINAL_SETTINGS_STORAGE_KEY, JSON.stringify({ showTerminalInstances: true }))
    render()
    const rows = container.querySelectorAll<HTMLButtonElement>('[data-testid="terminal-instances"] button')
    expect(Array.from(rows, (row) => row.textContent)).toEqual(['Terminal 1Tab 1', 'Terminal 2Tab 1', 'Terminal 3Tab 1'])
    act(() => rows[1]!.click())
    expect(onFocusTerminal).toHaveBeenCalledWith(session.id, tab.id, 'pane-second')
  })
})
