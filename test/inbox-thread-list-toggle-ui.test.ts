// @vitest-environment happy-dom
import { act, createElement, Fragment } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../src/renderer/components/Sidebar'
import { ThreadListToggle } from '../src/renderer/components/inbox/ThreadListToggle'
import { INBOX_THREAD_LIST_HIDDEN_STORAGE_KEY } from '../src/renderer/lib/inbox-settings'
import { THREAD_LIST_PEEK_CLOSE_DELAY, THREAD_LIST_PEEK_OPEN_DELAY } from '../src/renderer/components/inbox/thread-list-peek'
import { useInboxDrafts } from '../src/renderer/store/inbox-drafts'
import { useInboxView } from '../src/renderer/store/inbox-view'
import { useWorkspace } from '../src/renderer/store/workspace'

vi.mock('../src/renderer/components/InboxPanel', () => ({ InboxPanel: () => createElement('div', { 'data-testid': 'inbox-panel' }) }))
vi.mock('../src/renderer/components/inbox/HiddenTerminalIndicator', () => ({ HiddenTerminalIndicator: () => null }))

let root: Root
let container: HTMLDivElement
const query = (testId: string): HTMLElement | null => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
const sidebarShown = (): boolean => !query('sidebar')!.classList.contains('invisible')

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
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** React makes pointerenter and pointerleave out of pointerover and pointerout. */
function move(from: Element, to: Element, buttons = 0): void {
  act(() => {
    from.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: to, buttons }))
    to.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: from, buttons }))
  })
}
const wait = (ms: number): void => act(() => void vi.advanceTimersByTime(ms))
const peeking = (): boolean => query('sidebar')!.dataset.peek === 'true'

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

  describe('showing the hidden list from the left edge', () => {
    let outside: HTMLElement
    beforeEach(() => {
      vi.useFakeTimers()
      useInboxView.setState({ threadListHidden: true })
      outside = document.createElement('div')
      document.body.append(outside)
      render()
    })
    afterEach(() => outside.remove())

    it('slides in after the pointer rests on the edge and out after it leaves, without saving anything', () => {
      const edge = query('inbox-thread-list-edge')!
      const sidebar = query('sidebar')!
      expect(sidebar.classList.contains('invisible')).toBe(true)
      move(outside, edge)
      wait(THREAD_LIST_PEEK_OPEN_DELAY)
      expect(peeking()).toBe(true)
      expect(sidebar.classList.contains('invisible')).toBe(false)
      move(edge, sidebar)
      move(sidebar, outside)
      wait(THREAD_LIST_PEEK_CLOSE_DELAY - 1)
      expect(peeking()).toBe(true)
      wait(1)
      expect(peeking()).toBe(false)
      expect(useInboxView.getState().threadListHidden).toBe(true)
      expect(localStorage.getItem(INBOX_THREAD_LIST_HIDDEN_STORAGE_KEY)).toBeNull()
    })

    it('does not open for a pointer passing by or dragging, and stays while the pointer comes back', () => {
      const edge = query('inbox-thread-list-edge')!
      const sidebar = query('sidebar')!
      move(outside, edge)
      wait(THREAD_LIST_PEEK_OPEN_DELAY - 1)
      move(edge, outside)
      wait(THREAD_LIST_PEEK_OPEN_DELAY)
      expect(peeking()).toBe(false)
      move(outside, edge, 1)
      wait(THREAD_LIST_PEEK_OPEN_DELAY)
      expect(peeking()).toBe(false)

      move(outside, edge)
      wait(THREAD_LIST_PEEK_OPEN_DELAY)
      move(edge, sidebar)
      move(sidebar, outside)
      wait(THREAD_LIST_PEEK_CLOSE_DELAY / 2)
      move(outside, sidebar)
      wait(THREAD_LIST_PEEK_CLOSE_DELAY)
      expect(peeking()).toBe(true)
    })

    it('goes away once a thread or a new thread is opened from it', () => {
      const edge = query('inbox-thread-list-edge')!
      const sidebar = query('sidebar')!
      const open = (): void => {
        move(outside, edge)
        wait(THREAD_LIST_PEEK_OPEN_DELAY)
        move(edge, sidebar)
        expect(peeking()).toBe(true)
      }
      open()
      act(() => useWorkspace.setState({ selectedInboxThreadId: 'thread-2' }))
      expect(peeking()).toBe(false)
      open()
      act(() => useInboxDrafts.setState({ page: { id: 'draft-new', opened: false } }))
      expect(peeking()).toBe(false)
    })

    it('stays while its search field has the keyboard, and goes when the keyboard moves on', () => {
      const edge = query('inbox-thread-list-edge')!
      const sidebar = query('sidebar')!
      const field = document.createElement('input')
      sidebar.append(field)
      const button = document.createElement('button')
      outside.append(button)
      move(outside, edge)
      wait(THREAD_LIST_PEEK_OPEN_DELAY)
      move(edge, sidebar)
      act(() => field.focus())
      move(sidebar, outside)
      wait(THREAD_LIST_PEEK_CLOSE_DELAY)
      expect(peeking()).toBe(true)
      act(() => button.focus())
      wait(THREAD_LIST_PEEK_CLOSE_DELAY)
      expect(peeking()).toBe(false)
      field.remove()
    })

    it('has no edge and takes its room again once shown with the button', () => {
      act(() => query('inbox-thread-list-toggle')!.click())
      expect(query('inbox-thread-list-edge')).toBeNull()
      expect(query('sidebar')!.classList.contains('absolute')).toBe(false)
      expect(peeking()).toBe(false)
    })
  })
})
