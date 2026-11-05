// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxThread } from '../src/shared/types'

vi.mock('../src/renderer/terminal/sessions', () => ({ disposeSession: vi.fn() }))

import { TerminalThreadHighlight } from '../src/renderer/components/inbox/TerminalThreadHighlight'
import { INBOX_TERMINAL_HIGHLIGHT_MS } from '../src/renderer/lib/inbox-terminal-highlight'
import { useWorkspace } from '../src/renderer/store/workspace'

let root: Root
let container: HTMLDivElement

function report(id: string, status: InboxThread['status']): void {
  const store = useWorkspace.getState()
  const previous = store.inboxThreads.find((thread) => thread.id === id)
  const thread: InboxThread = previous ?? {
    id, title: 'Review tests', mode: 'terminal', folderId: 'fld_app', directory: '/workspace/app',
    target: { kind: 'native' }, branch: 'main', status: 'working', createdAt: 1, lastActivityAt: 1, readAt: 1, archived: false,
  }
  if (!previous) store.upsertInboxThread(thread)
  store.upsertInboxThread({ ...thread, status, lastActivityAt: thread.lastActivityAt + 1 })
}

function render(threadId = 'ses_one'): void {
  act(() => root.render(createElement(TerminalThreadHighlight, { threadId })))
}
const highlight = (): HTMLElement | null => container.querySelector('[data-testid="inbox-terminal-highlight"]')

describe('Inbox Terminal chat border animation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    useWorkspace.setState({ inboxThreads: [], inboxTerminalHighlights: {}, activeWorkspaceView: 'sessions' })
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

  it('renders nothing without a thread transition', () => {
    render()
    expect(highlight()).toBeNull()
  })

  it('keeps highlights separate for each Inbox thread', () => {
    report('ses_two', 'error')
    render()
    expect(highlight()).toBeNull()
    render('ses_two')
    expect(highlight()?.dataset.tone).toBe('error')
    expect(highlight()?.getAttribute('aria-hidden')).toBe('true')
    expect(highlight()?.className).toBe('inbox-terminal-highlight')
  })

  it('expires without an animation event, including under reduced motion', () => {
    report('ses_one', 'attention')
    render()
    expect(highlight()?.dataset.tone).toBe('attention')
    act(() => vi.advanceTimersByTime(INBOX_TERMINAL_HIGHLIGHT_MS + 200))
    expect(highlight()).toBeNull()
    expect(useWorkspace.getState().inboxTerminalHighlights).toEqual({})
  })

  it('restarts for a new transition and ignores a stale clear of the old animation', () => {
    report('ses_one', 'attention')
    render()
    const first = highlight()
    act(() => {
      vi.advanceTimersByTime(1000)
      report('ses_one', 'completed')
      useWorkspace.getState().clearInboxTerminalHighlight('ses_one', 1)
    })
    expect(highlight()).not.toBe(first)
    expect(highlight()?.dataset.tone).toBe('done')
    act(() => vi.advanceTimersByTime(INBOX_TERMINAL_HIGHLIGHT_MS - 500))
    expect(highlight()).not.toBeNull()
    act(() => vi.advanceTimersByTime(700))
    expect(highlight()).toBeNull()
  })

  it('does not replay an expired animation after switching back to a thread', () => {
    report('ses_one', 'completed')
    vi.advanceTimersByTime(INBOX_TERMINAL_HIGHLIGHT_MS + 500)
    render()
    expect(highlight()).toBeNull()
    act(() => vi.advanceTimersByTime(10))
    expect(useWorkspace.getState().inboxTerminalHighlights).toEqual({})
  })

  it('ignores metadata-only updates during an animation', () => {
    report('ses_one', 'completed')
    render()
    const first = highlight()
    act(() => useWorkspace.getState().upsertInboxThread({ ...useWorkspace.getState().inboxThreads[0]!, title: 'Renamed', readAt: 3 }))
    expect(highlight()).toBe(first)
    expect(useWorkspace.getState().inboxTerminalHighlights.ses_one?.token).toBe(1)
  })
})
