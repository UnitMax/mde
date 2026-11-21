// @vitest-environment happy-dom
import { act, createElement, Fragment } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../src/renderer/components/Sidebar'
import { ThreadListToggle } from '../src/renderer/components/inbox/ThreadListToggle'
import { INBOX_THREAD_LIST_HIDDEN_STORAGE_KEY } from '../src/renderer/lib/inbox-settings'
import { useInboxView } from '../src/renderer/store/inbox-view'
import { useWorkspace } from '../src/renderer/store/workspace'

vi.mock('../src/renderer/components/InboxPanel', () => ({ InboxPanel: () => createElement('div', { 'data-testid': 'inbox-panel' }) }))
vi.mock('../src/renderer/components/inbox/HiddenTerminalIndicator', () => ({ HiddenTerminalIndicator: () => null }))

let root: Root
let container: HTMLDivElement
const query = (testId: string): HTMLElement | null => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
const sidebarShown = (): boolean => !query('sidebar')!.classList.contains('hidden')

function render(): void {
  act(() => root.render(createElement(Fragment, null,
    createElement(Sidebar, { onNewSession: vi.fn(), onNewTodoProject: vi.fn(), onNewTodoTask: vi.fn() }),
    createElement(ThreadListToggle))))
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  useInboxView.setState({ threadListHidden: false })
  useWorkspace.setState({ sessions: [], activeWorkspaceView: 'inbox', sidebarCollapsed: false, inboxThreads: [] })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('hiding the Inbox thread list', () => {
  it('hides and shows the left sidebar from the button, keeps the choice, and keeps the panel mounted', () => {
    render()
    const toggle = query('inbox-thread-list-toggle')!
    expect(sidebarShown()).toBe(true)
    expect(toggle.getAttribute('aria-label')).toBe('Hide the thread list')
    act(() => toggle.click())
    expect(sidebarShown()).toBe(false)
    // Still there: it listens for Ctrl+N and reads the drafts.
    expect(query('inbox-panel')).not.toBeNull()
    expect(toggle.getAttribute('aria-label')).toBe('Show the thread list')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem(INBOX_THREAD_LIST_HIDDEN_STORAGE_KEY)).toBe('on')
    act(() => toggle.click())
    expect(sidebarShown()).toBe(true)
    expect(localStorage.getItem(INBOX_THREAD_LIST_HIDDEN_STORAGE_KEY)).toBe('off')
  })

  it('only hides the sidebar in the Inbox', () => {
    useInboxView.setState({ threadListHidden: true })
    useWorkspace.setState({ activeWorkspaceView: 'todo' })
    render()
    expect(sidebarShown()).toBe(true)
    act(() => useWorkspace.setState({ activeWorkspaceView: 'inbox' }))
    expect(sidebarShown()).toBe(false)
  })
})
