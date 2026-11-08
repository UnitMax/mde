// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatDraft, ChatDraftRequest, ChatForkRequest, ChatForkResult, InboxRemoveRequest, InboxThread } from '../src/shared/types'
import { InboxPanel } from '../src/renderer/components/InboxPanel'
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useWorkspace } from '../src/renderer/store/workspace'
import { messageInput, pressMessageKey } from './helpers/chat-input'
import { openInboxFilterMenu, openInboxSearch, showInboxThreads } from './helpers/inbox-toolbar'

const roots: Root[] = []
const setRead = vi.fn(async () => null)
const remove = vi.fn(async (_request: InboxRemoveRequest): Promise<void> => undefined)
const folders = vi.fn(async () => ({ folders: [], composer: {} }))
const fork = vi.fn(async (_request: ChatForkRequest): Promise<ChatForkResult> => ({ thread: thread({ id: 'ses_fork', title: 'Fix login (fork #1)', status: 'idle', forkedFrom: 'ses_one', readAt: Date.now(), lastActivityAt: Date.now() }) }))
const draft = vi.fn(async (_request: ChatDraftRequest): Promise<ChatDraft> => ({ text: '', revision: 0, attachments: [] }))

function thread(overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id: 'ses_one',
    title: 'Fix login',
    directory: '/home/me/app',
    target: { kind: 'wsl', distro: 'Ubuntu' },
    branch: 'feature/login',
    model: { id: 'model-1', providerId: 'provider-1' },
    status: 'completed',
    createdAt: 1,
    lastActivityAt: Date.now() - 5 * 60_000,
    readAt: 0,
    archived: false,
    folderId: 'fld_app',
    ...overrides
  }
}

async function render(element: Parameters<Root['render']>[0]): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(element))
  return container
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('api', {
    inbox: { setRead, setArchived: vi.fn(async () => null), remove, folders },
    chat: {
      draft,
      fork,
      subscribe: vi.fn(async () => undefined),
      unsubscribe: vi.fn(async () => undefined),
      messages: vi.fn(async () => ({
        messages: [{ kind: 'user', id: 'msg_1', time: 1, text: 'Please fix the login' }],
        older: null,
        running: false
      })),
      requests: vi.fn(async () => ({ permissions: [], forms: [] })),
      options: vi.fn(() => new Promise(() => {}))
    }
  })
  setRead.mockClear()
  remove.mockReset()
  remove.mockResolvedValue(undefined)
  folders.mockClear()
  fork.mockClear()
  draft.mockClear()
  useInboxChat.setState({ threads: {}, recent: [], draftReloads: {} })
  useWorkspace.setState({
    platform: { platform: 'win32', isWindows: true },
    wslAvailable: true,
    inboxThreads: [],
    selectedInboxThreadId: null,
    inboxMarkedUnread: {},
    inboxCues: {},
    activeWorkspaceView: 'inbox',
    settingsDialog: { open: false, section: 'appearance' }
  })
})

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()))
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('Inbox chat message history', () => {
  it('recalls only nonempty user text from this conversation and pending messages', async () => {
    vi.mocked(window.api.chat.messages).mockResolvedValue({
      messages: [
        { kind: 'user', id: 'msg_1', time: 1, text: 'First message' },
        { kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model: { id: 'm', providerId: 'p' }, completed: true, parts: [{ kind: 'text', text: 'Reply' }] },
        { kind: 'user', id: 'msg_3', time: 3, text: ' \n ' },
        { kind: 'user', id: 'msg_4', time: 4, text: 'Second message', attachments: [{ id: 'file_1', name: 'notes.txt', mime: 'text/plain', size: 10 }] },
        { kind: 'user', id: 'msg_8', time: 8, text: 'Reverted message' },
      ],
      older: null,
      running: false,
      revert: { messageId: 'msg_8', files: [] },
      pending: [{ id: 'msg_9', delivery: 'queue', message: { kind: 'user', id: 'msg_9', time: 9, text: 'Queued message' } }],
    })
    useWorkspace.setState({ inboxThreads: [thread()], selectedInboxThreadId: 'ses_one' })
    const main = await render(createElement(InboxThreadView))
    const input = messageInput(main)
    await pressMessageKey(input, 'ArrowUp')
    expect(input.state.doc.toString()).toBe('Queued message')
    await pressMessageKey(input, 'ArrowUp')
    expect(input.state.doc.toString()).toBe('Second message')
    expect(main.querySelector('[aria-label="Attachments"]')).toBeNull()
    await pressMessageKey(input, 'ArrowUp')
    expect(input.state.doc.toString()).toBe('First message')
    await pressMessageKey(input, 'ArrowUp')
    expect(input.state.doc.toString()).toBe('First message')
    expect(draft).toHaveBeenLastCalledWith({ key: 'thread:ses_one', action: 'text', text: 'First message' })
  })

  it('loads earlier pages when Up reaches the oldest loaded user message', async () => {
    vi.mocked(window.api.chat.messages).mockImplementation(async ({ cursor }) => {
      if (cursor === 'earliest') return { messages: [{ kind: 'user', id: 'msg_1', time: 1, text: 'First message' }], older: null, running: false }
      if (cursor === 'earlier') return {
        messages: [{ kind: 'assistant', id: 'msg_4', time: 4, agent: 'build', model: { id: 'm', providerId: 'p' }, completed: true, parts: [{ kind: 'text', text: 'Reply' }] }],
        older: 'earliest', running: false,
      }
      return { messages: [{ kind: 'user', id: 'msg_5', time: 5, text: 'Latest message' }], older: 'earlier', running: false }
    })
    useWorkspace.setState({ inboxThreads: [thread()], selectedInboxThreadId: 'ses_one' })
    const main = await render(createElement(InboxThreadView))
    const input = messageInput(main)
    await pressMessageKey(input, 'ArrowUp')
    expect(input.state.doc.toString()).toBe('Latest message')
    expect(window.api.chat.messages).toHaveBeenCalledTimes(1)
    await pressMessageKey(input, 'ArrowUp')
    expect(input.state.doc.toString()).toBe('First message')
    expect(window.api.chat.messages).toHaveBeenCalledWith({ threadId: 'ses_one', cursor: 'earlier' })
    expect(window.api.chat.messages).toHaveBeenCalledWith({ threadId: 'ses_one', cursor: 'earliest' })
    await pressMessageKey(input, 'ArrowUp')
    expect(input.state.doc.toString()).toBe('First message')
    expect(window.api.chat.messages).toHaveBeenCalledTimes(3)
    await pressMessageKey(input, 'ArrowDown')
    expect(input.state.doc.toString()).toBe('Latest message')
    await pressMessageKey(input, 'ArrowDown')
    expect(input.state.doc.toString()).toBe('')
  })

  it('keeps recalled text after a page fails and allows another Up to retry', async () => {
    vi.mocked(window.api.chat.messages)
      .mockResolvedValueOnce({ messages: [{ kind: 'user', id: 'msg_5', time: 5, text: 'Latest message' }], older: 'earlier', running: false })
      .mockRejectedValueOnce(new Error('Service unavailable'))
      .mockResolvedValueOnce({ messages: [{ kind: 'user', id: 'msg_1', time: 1, text: 'First message' }], older: null, running: false })
    useWorkspace.setState({ inboxThreads: [thread()], selectedInboxThreadId: 'ses_one' })
    const main = await render(createElement(InboxThreadView))
    const input = messageInput(main)
    await pressMessageKey(input, 'ArrowUp')
    await pressMessageKey(input, 'ArrowUp')
    expect(input.state.doc.toString()).toBe('Latest message')
    expect(main.textContent).toContain('Service unavailable')
    expect(window.api.chat.messages).toHaveBeenCalledTimes(2)
    await pressMessageKey(input, 'ArrowUp')
    expect(input.state.doc.toString()).toBe('First message')
    expect(window.api.chat.messages).toHaveBeenCalledTimes(3)
  })
})

describe('Inbox', () => {
  it('is locked where OpenCode’s service is not reachable, and works elsewhere', async () => {
    useWorkspace.setState({ platform: { platform: 'linux', isWindows: false }, inboxThreads: [thread()] })
    const panel = await render(createElement(InboxPanel))
    expect(panel.querySelector('[data-testid="inbox-locked"]')).not.toBeNull()
    expect(panel.querySelector('[data-testid="inbox-thread-ses_one"]')).toBeNull()
    const main = await render(createElement(InboxThreadView))
    expect(main.querySelector('[data-testid="inbox-locked"]')).not.toBeNull()
    expect(main.querySelector('[aria-label="Regenerate title"]')).toBeNull()

    useWorkspace.setState({ platform: { platform: 'win32', isWindows: true } })
    const open = await render(createElement(InboxPanel))
    expect(open.querySelector('[data-testid="inbox-locked"]')).toBeNull()
    expect(open.querySelector('[data-testid="inbox-thread-ses_one"]')).not.toBeNull()
  })

  it('says how to start a thread while empty', async () => {
    useWorkspace.setState({ inboxThreads: [] })
    const panel = await render(createElement(InboxPanel))
    expect(panel.textContent).toContain('No threads yet.')
    expect(panel.textContent).toContain('Start one with New thread.')
  })

  it('lists threads like mail and opens the selected one', async () => {
    useWorkspace.setState({
      inboxThreads: [
        thread(),
        thread({ id: 'ses_two', title: 'Old work', readAt: Date.now(), lastActivityAt: Date.now() - 2 * 3_600_000, status: 'idle' })
      ]
    })
    const panel = await render(createElement(InboxPanel))
    const rows = panel.querySelectorAll('[data-testid^="inbox-thread-ses_"]')
    expect(Array.from(rows).map((row) => row.getAttribute('data-testid'))).toEqual(['inbox-thread-ses_one', 'inbox-thread-ses_two'])
    const first = rows[0] as HTMLElement
    expect(first.dataset.unread).toBe('true')
    expect(first.textContent).toContain('Fix login')
    expect(first.textContent).toContain('5m ago')
    expect(first.textContent).toContain('app')
    expect(first.textContent).toContain('feature/login')
    expect(first.textContent).toContain('model-1')
    expect(first.textContent).toContain('Done')
    expect((rows[1] as HTMLElement).dataset.unread).toBeUndefined()
    expect(rows[1]!.textContent).toContain('2h ago')

    await act(async () => first.click())
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_one')
    expect(setRead).toHaveBeenCalledWith({ id: 'ses_one', read: true })

    const main = await render(createElement(InboxThreadView))
    expect(main.textContent).toContain('Fix login')
    expect(main.querySelector('[data-testid="inbox-thread-folder"]')?.textContent).toBe('app')
    expect(main.querySelector('[data-testid="inbox-thread-folder"]')?.getAttribute('title')).toBe('/home/me/app (Ubuntu)')
    await vi.waitFor(() => expect(main.textContent).toContain('Please fix the login'))
    expect(main.querySelector('[data-testid="chat-composer"]')).not.toBeNull()
  })

  it('parks a thread straight from its row and shows a spinner while it works', async () => {
    useWorkspace.setState({ inboxThreads: [thread({ status: 'working' })] })
    const panel = await render(createElement(InboxPanel))
    expect(panel.querySelector('[data-testid="inbox-status-chip"] svg.animate-spin')).not.toBeNull()
    const park = panel.querySelector<HTMLButtonElement>('[data-testid="inbox-thread-park-ses_one"]')!
    expect(park.getAttribute('aria-label')).toBe('Park')
    expect(park.textContent).toBe('Park')
    expect(park.querySelector('svg.lucide-car')).not.toBeNull()
    await act(async () => park.click())
    expect(window.api.inbox.setArchived).toHaveBeenCalledWith({ id: 'ses_one', archived: true })
    // The row itself is not clicked, so the thread is not opened.
    expect(useWorkspace.getState().selectedInboxThreadId).toBeNull()
  })

  it('counts up how long a working thread has been going in its pill', async () => {
    vi.useFakeTimers({ now: 5_000_000 })
    try {
      useWorkspace.setState({
        inboxThreads: [
          thread({ id: 'ses_one', status: 'working', workingSince: 5_000_000 - 90_000 }),
          // Working, but nothing says since when: the pill names the state and no more.
          thread({ id: 'ses_two', status: 'working' }),
          thread({ id: 'ses_three', status: 'completed' })
        ]
      })
      const panel = await render(createElement(InboxPanel))
      const chip = (id: string): string | undefined =>
        panel.querySelector(`[data-testid="inbox-thread-${id}"] [data-testid="inbox-status-chip"]`)?.textContent ?? undefined
      expect(chip('ses_one')).toBe('Working·1m 30s')
      expect(chip('ses_two')).toBe('Working')
      expect(chip('ses_three')).toBe('Done')

      // The count moves on a moment after each whole second has passed, never before it.
      await act(async () => { vi.advanceTimersByTime(900) })
      expect(chip('ses_one')).toBe('Working·1m 30s')
      await act(async () => { vi.advanceTimersByTime(200) })
      expect(chip('ses_one')).toBe('Working·1m 31s')
      await act(async () => { vi.advanceTimersByTime(30_000) })
      expect(chip('ses_one')).toBe('Working·2m 1s')
      expect(panel.querySelector('[data-testid="inbox-thread-ses_one"] [role="timer"]')).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops the clock when the thread stops working', async () => {
    vi.useFakeTimers({ now: 5_000_000 })
    try {
      useWorkspace.setState({ inboxThreads: [thread({ status: 'working', workingSince: 5_000_000 - 5_000 })] })
      const panel = await render(createElement(InboxPanel))
      expect(panel.querySelector('[data-testid="inbox-status-chip"]')?.textContent).toBe('Working·5s')
      await act(async () => {
        useWorkspace.setState({ inboxThreads: [thread({ status: 'completed' })] })
      })
      expect(panel.querySelector('[data-testid="inbox-status-chip"]')?.textContent).toBe('Done')
      expect(panel.querySelector('[role="timer"]')).toBeNull()
      // Nothing is left ticking once the pill no longer shows a count.
      expect(vi.getTimerCount()).toBeLessThanOrEqual(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cues something new in the thread being read with a glow on its row and a pop of its chip, for a moment', async () => {
    useWorkspace.setState({
      inboxThreads: [thread({ status: 'completed', readAt: Date.now() }), thread({ id: 'ses_two', status: 'completed', readAt: Date.now() })],
      inboxCues: { ses_one: Date.now() - 100, ses_two: Date.now() - 60_000 }
    })
    const panel = await render(createElement(InboxPanel))
    const row = (id: string): Element => panel.querySelector(`[data-testid="inbox-thread-${id}"]`)!.parentElement!
    expect(panel.querySelector('[data-testid="inbox-thread-cue-ses_one"]')).not.toBeNull()
    expect(row('ses_one').querySelector('[data-testid="inbox-status-chip"]')?.classList.contains('inbox-cue-pop')).toBe(true)
    // A cue that has run its course is not played again when the row is drawn anew.
    expect(panel.querySelector('[data-testid="inbox-thread-cue-ses_two"]')).toBeNull()
    expect(row('ses_two').querySelector('[data-testid="inbox-status-chip"]')?.classList.contains('inbox-cue-pop')).toBe(false)
    // It is only a cue: the thread stays read.
    expect(panel.querySelector('[data-unread]')).toBeNull()

    // A newer cue replaces the element, which is what starts the animation again.
    const first = panel.querySelector('[data-testid="inbox-thread-cue-ses_one"]')
    await act(async () => useWorkspace.setState({ inboxCues: { ses_one: Date.now() + 1 } }))
    expect(panel.querySelector('[data-testid="inbox-thread-cue-ses_one"]')).not.toBe(first)
  })

  it('counts the open thread as seen when the window comes back, unless it was marked unread by hand', async () => {
    useWorkspace.setState({ inboxThreads: [thread()], selectedInboxThreadId: 'ses_one' })
    await render(createElement(InboxThreadView))
    expect(setRead).not.toHaveBeenCalled()
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(setRead).toHaveBeenCalledWith({ id: 'ses_one', read: true })

    setRead.mockClear()
    useWorkspace.setState({ inboxMarkedUnread: { ses_one: true } })
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(setRead).not.toHaveBeenCalled()
  })

  it('filters and searches the list', async () => {
    useWorkspace.setState({
      inboxThreads: [
        thread({ readAt: Date.now() }),
        thread({ id: 'ses_two', title: 'Question', status: 'attention', attentionReason: 'question', branch: null, readAt: Date.now() })
      ]
    })
    const panel = await render(createElement(InboxPanel))
    await openInboxFilterMenu(panel)
    expect(Array.from(document.body.querySelectorAll('[role="menuitemradio"]')).map((item) => item.textContent))
      .toEqual(['All', 'Unread', 'Parked'])
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await showInboxThreads(panel, 'Parked')
    expect(panel.textContent).toContain('No parked threads.')
    // A narrowed list says so, with a way back, under the toolbar.
    expect(panel.querySelector('[data-testid="inbox-status-filter"]')?.textContent).toBe('Parked')
    await showInboxThreads(panel, 'Unread')
    expect(panel.querySelector('[data-testid="inbox-thread-ses_one"]')).toBeNull()
    expect(panel.querySelector('[data-testid="inbox-thread-ses_two"]')).not.toBeNull()
    await act(async () => panel.querySelector<HTMLElement>('[aria-label="Show all threads"]')!.click())
    expect(panel.querySelector('[data-testid="inbox-status-filter"]')).toBeNull()

    // Search is a button until it is wanted.
    expect(panel.querySelector('[aria-label="Search inbox"]')).toBeNull()
    const search = await openInboxSearch(panel)
    expect(document.activeElement).toBe(search)
    expect(panel.querySelector('[aria-label="Clear search"]')).toBeNull()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(search, 'feature')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(panel.querySelector('[data-testid="inbox-thread-ses_one"]')).not.toBeNull()
    expect(panel.querySelector('[data-testid="inbox-thread-ses_two"]')).toBeNull()
    await act(async () => panel.querySelector<HTMLButtonElement>('[aria-label="Clear search"]')!.click())
    expect(search.value).toBe('')
    expect(document.activeElement).toBe(search)
    expect(panel.querySelector('[aria-label="Clear search"]')).toBeNull()
    expect(panel.querySelector('[data-testid="inbox-thread-ses_one"]')).not.toBeNull()
    expect(panel.querySelector('[data-testid="inbox-thread-ses_two"]')).not.toBeNull()
  })

  it('puts the search away with Escape, or with its button, and keeps it while it has text', async () => {
    useWorkspace.setState({ inboxThreads: [thread({ readAt: Date.now() })] })
    const panel = await render(createElement(InboxPanel))
    const button = (): HTMLButtonElement => panel.querySelector<HTMLButtonElement>('[aria-label="Search threads"]')!
    expect(button().getAttribute('aria-expanded')).toBe('false')
    await openInboxSearch(panel)
    expect(button().getAttribute('aria-expanded')).toBe('true')
    // The field is made again each time the search is opened, so it is looked up each time.
    const type = async (text: string): Promise<void> => act(async () => {
      const field = panel.querySelector<HTMLInputElement>('[aria-label="Search inbox"]')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, text)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await type('feature')
    // The first Escape empties the field, the second puts it away.
    const escape = (): Promise<void> => act(async () => void panel.querySelector('[aria-label="Search inbox"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await escape()
    expect(panel.querySelector<HTMLInputElement>('[aria-label="Search inbox"]')!.value).toBe('')
    await escape()
    expect(panel.querySelector('[aria-label="Search inbox"]')).toBeNull()
    expect(button().getAttribute('aria-expanded')).toBe('false')

    // The button also puts it away, and clears what was typed, so the list is not narrowed by something out of sight.
    await openInboxSearch(panel)
    await type('zebra')
    expect(panel.querySelector('[data-testid="inbox-thread-ses_one"]')).toBeNull()
    await act(async () => button().click())
    expect(panel.querySelector('[aria-label="Search inbox"]')).toBeNull()
    expect(panel.querySelector('[data-testid="inbox-thread-ses_one"]')).not.toBeNull()
  })

  it('shows the filter button as on while the list is narrowed, and not otherwise', async () => {
    useWorkspace.setState({ inboxThreads: [thread({ readAt: Date.now() })] })
    const panel = await render(createElement(InboxPanel))
    const filterButton = (): HTMLElement => panel.querySelector<HTMLElement>('[data-testid="inbox-filter-button"]')!
    expect(filterButton().getAttribute('data-active')).toBeNull()
    expect(panel.querySelector('[data-testid="inbox-active-filters"]')).toBeNull()
    await showInboxThreads(panel, 'Parked')
    expect(filterButton().getAttribute('data-active')).toBe('true')
    await act(async () => panel.querySelector<HTMLElement>('[aria-label="Show all threads"]')!.click())
    expect(filterButton().getAttribute('data-active')).toBeNull()
  })
})

describe('Inbox thread fork', () => {
  const menuItem = (label: string): HTMLElement | undefined =>
    Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) => item.textContent?.trim() === label)
  const openMenu = async (panel: HTMLElement, id = 'ses_one'): Promise<void> => {
    const row = panel.querySelector(`[data-testid="inbox-thread-${id}"]`)!.parentElement!
    await act(async () => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20, button: 2 })) })
  }
  const choose = async (label: string): Promise<void> => {
    await act(async () => menuItem(label)!.click())
  }
  const alertText = (panel: HTMLElement): string | undefined => panel.querySelector('[data-testid="inbox-fork-error"]')?.textContent?.trim()

  it('offers Fork thread in the right-click menu, next to the other thread actions', async () => {
    useWorkspace.setState({ inboxThreads: [thread()] })
    const panel = await render(createElement(InboxPanel))
    await openMenu(panel)
    const labels = Array.from(document.body.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent?.trim())
    expect(labels).toEqual(['Rename thread', 'Clear custom name', 'Pin thread', 'Mark as read', 'Park', 'Fork thread', 'Delete from Inbox'])
    expect(fork).not.toHaveBeenCalled()
  })

  it('renames a thread and clears the override using the context menu', async () => {
    useWorkspace.setState({ inboxThreads: [thread()] })
    const setCustomTitle = vi.fn(async ({ customTitle }: { id: string; customTitle: string | null }) => {
      const current = useWorkspace.getState().inboxThreads[0]!
      const { customTitle: _old, ...rest } = current
      return { ...rest, ...(customTitle ? { customTitle } : {}) }
    })
    window.api.inbox.setCustomTitle = setCustomTitle
    const panel = await render(createElement(InboxPanel))
    await openMenu(panel)
    expect(menuItem('Clear custom name')?.getAttribute('data-disabled')).not.toBeNull()
    await choose('Rename thread')
    const input = document.body.querySelector<HTMLInputElement>('input[id="inbox-thread-name-ses_one"]')!
    expect(input.value).toBe('Fix login')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'My task')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(setCustomTitle).toHaveBeenLastCalledWith({ id: 'ses_one', customTitle: 'My task' })
    expect(panel.textContent).toContain('My task')
    await act(async () => useWorkspace.getState().upsertInboxThread({ ...useWorkspace.getState().inboxThreads[0]!, title: 'Updated OpenCode title' }))
    expect(panel.querySelector('[data-testid="inbox-thread-ses_one"]')?.textContent).toContain('My task')
    await openMenu(panel)
    await choose('Clear custom name')
    expect(setCustomTitle).toHaveBeenLastCalledWith({ id: 'ses_one', customTitle: null })
    expect(panel.textContent).toContain('Updated OpenCode title')
    expect(panel.textContent).not.toContain('My task')
  })

  it('forks the whole thread, adds the new thread to the list and opens it', async () => {
    useWorkspace.setState({ inboxThreads: [thread(), thread({ id: 'ses_two', title: 'Other', lastActivityAt: Date.now() - 9 * 60_000 })], selectedInboxThreadId: 'ses_two' })
    const panel = await render(createElement(InboxPanel))
    await openMenu(panel)
    await choose('Fork thread')
    // Only the thread is named: the service decides where a whole-conversation fork is cut.
    expect(fork).toHaveBeenCalledTimes(1)
    expect(fork).toHaveBeenCalledWith({ threadId: 'ses_one' })
    expect(draft).not.toHaveBeenCalled()
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_fork')
    expect(useWorkspace.getState().activeWorkspaceView).toBe('inbox')
    const row = panel.querySelector('[data-testid="inbox-thread-ses_fork"]')
    expect(row?.textContent).toContain('Fix login (fork #1)')
    expect(row?.getAttribute('aria-current')).toBe('true')
    // The original is where it was, unchanged.
    expect(panel.querySelector('[data-testid="inbox-thread-ses_one"]')?.getAttribute('aria-current')).toBeNull()
    expect(useWorkspace.getState().inboxThreads.find((item) => item.id === 'ses_one')).toEqual(thread({ lastActivityAt: expect.any(Number) }))
    expect(panel.querySelector('[data-testid="inbox-fork-status"]')).toBeNull()
    expect(alertText(panel)).toBeUndefined()
  })

  it('puts the unfinished turn\'s text in the new thread\'s box when the fork was cut before it', async () => {
    fork.mockResolvedValueOnce({ thread: thread({ id: 'ses_fork', title: 'Fix login (fork #1)', status: 'idle', forkedFrom: 'ses_one' }), text: 'Run the whole suite' })
    useWorkspace.setState({ inboxThreads: [thread({ status: 'working' })] })
    const panel = await render(createElement(InboxPanel))
    await openMenu(panel)
    await choose('Fork thread')
    expect(draft).toHaveBeenCalledTimes(1)
    expect(draft).toHaveBeenCalledWith({ key: 'thread:ses_fork', action: 'prepend', text: 'Run the whole suite' })
    // The box that shows the draft is told to read it again, with the caret after the added text.
    expect(useInboxChat.getState().draftReloads.ses_fork).toEqual({ id: 1, caret: 'Run the whole suite'.length })
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_fork')
  })

  it('still opens the fork and says so when the text could not be put in its box', async () => {
    fork.mockResolvedValueOnce({ thread: thread({ id: 'ses_fork', title: 'Fix login (fork #1)', status: 'idle', forkedFrom: 'ses_one' }), text: 'Run the whole suite' })
    draft.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:draft': Error: The text is too long to add to this draft."))
    useWorkspace.setState({ inboxThreads: [thread()] })
    const panel = await render(createElement(InboxPanel))
    await openMenu(panel)
    await choose('Fork thread')
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_fork')
    expect(useInboxChat.getState().threads.ses_fork?.notice)
      .toBe('The thread was forked, but the message could not be put in its box: The text is too long to add to this draft.')
    expect(useInboxChat.getState().draftReloads.ses_fork).toBeUndefined()
    expect(alertText(panel)).toBeUndefined()
  })

  it('shows that it is forking and waits for it before another fork', async () => {
    let finish!: (result: ChatForkResult) => void
    fork.mockImplementationOnce(() => new Promise<ChatForkResult>((resolve) => { finish = resolve }))
    useWorkspace.setState({ inboxThreads: [thread(), thread({ id: 'ses_two', title: 'Other', lastActivityAt: Date.now() - 9 * 60_000 })] })
    const panel = await render(createElement(InboxPanel))
    await openMenu(panel)
    await choose('Fork thread')
    expect(panel.querySelector('[data-testid="inbox-fork-status"]')?.textContent).toContain('Forking thread…')
    expect(useWorkspace.getState().selectedInboxThreadId).toBeNull()
    // Any thread's menu waits, so the same click cannot make two forks.
    await openMenu(panel, 'ses_two')
    expect(menuItem('Fork thread')?.hasAttribute('data-disabled')).toBe(true)
    await choose('Fork thread')
    expect(fork).toHaveBeenCalledTimes(1)
    await act(async () => finish({ thread: thread({ id: 'ses_fork', title: 'Fix login (fork #1)', status: 'idle', forkedFrom: 'ses_one' }) }))
    expect(panel.querySelector('[data-testid="inbox-fork-status"]')).toBeNull()
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_fork')
  })

  it('says why a fork failed, changes nothing, and lets the message be dismissed', async () => {
    fork.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:fork': Error: This OpenCode service does not support forking. Update OpenCode and try again."))
    useWorkspace.setState({ inboxThreads: [thread()], selectedInboxThreadId: 'ses_one' })
    const panel = await render(createElement(InboxPanel))
    await openMenu(panel)
    await choose('Fork thread')
    expect(alertText(panel)).toBe('This OpenCode service does not support forking. Update OpenCode and try again.')
    expect(panel.querySelector('[data-testid="inbox-fork-status"]')).toBeNull()
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_one')
    expect(useWorkspace.getState().inboxThreads.map((item) => item.id)).toEqual(['ses_one'])

    // Trying again clears the old message first, and a dismissed one is gone.
    await openMenu(panel)
    await choose('Fork thread')
    expect(alertText(panel)).toBeUndefined()
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_fork')
    fork.mockRejectedValueOnce(new Error('Service unavailable'))
    await openMenu(panel, 'ses_one')
    await choose('Fork thread')
    expect(alertText(panel)).toBe('Service unavailable')
    await act(async () => (panel.querySelector('[data-testid="inbox-fork-error"] button') as HTMLButtonElement).click())
    expect(alertText(panel)).toBeUndefined()
  })
})

describe('Inbox fork marker', () => {
  const original = (): InboxThread => thread({ id: 'ses_one', title: 'Fix login' })
  const fork = (): InboxThread => thread({ id: 'ses_fork', title: 'Fix login (fork #1)', forkedFrom: 'ses_one', status: 'idle', readAt: Date.now() })

  it('marks a fork in the list and nothing else', async () => {
    useWorkspace.setState({ inboxThreads: [original(), fork()] })
    const panel = await render(createElement(InboxPanel))
    expect(panel.querySelector('[data-testid="inbox-thread-fork-mark-ses_fork"]')?.getAttribute('aria-label')).toBe('Forked thread')
    expect(panel.querySelector('[data-testid="inbox-thread-fork-mark-ses_one"]')).toBeNull()
  })

  it('says in the header which thread this one was forked from, and opens that thread from there', async () => {
    useWorkspace.setState({ inboxThreads: [original(), fork()], selectedInboxThreadId: 'ses_fork' })
    const view = await render(createElement(InboxThreadView))
    const line = view.querySelector('[data-testid="inbox-forked-from"]')!
    expect(line.textContent).toBe('Forked from Fix login')
    expect(line.getAttribute('title')).toContain('same folder')
    await act(async () => (line as HTMLButtonElement).click())
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_one')
    // The original is not a fork, so its header has no such line.
    await act(async () => { /* the view follows the selection */ })
    expect(view.querySelector('[data-testid="inbox-forked-from"]')).toBeNull()
  })

  it('does not offer a link when the thread it came from is no longer in the Inbox', async () => {
    useWorkspace.setState({ inboxThreads: [fork()], selectedInboxThreadId: 'ses_fork' })
    const view = await render(createElement(InboxThreadView))
    const line = view.querySelector('[data-testid="inbox-forked-from"]')!
    expect(line.textContent).toContain('Forked from a thread that is no longer in the Inbox')
    expect(line.tagName).not.toBe('BUTTON')
  })
})

describe('Inbox thread deletion and worktrees', () => {
  const worktree = { repository: '/home/me/app', root: '/home/me/.mde/worktrees/app-abc/1a2b3c4d', branch: 'mde/1a2b3c4d', base: 'main' }
  const inWorktree = (overrides: Partial<InboxThread> = {}): InboxThread =>
    thread({ directory: worktree.root, branch: worktree.branch, worktree, ...overrides })
  const dialog = (): HTMLElement | null => document.body.querySelector('[role="alertdialog"]')
  const checkbox = (): HTMLInputElement | null => document.body.querySelector('[data-testid="inbox-remove-worktree"]')
  const openDialog = async (panel: HTMLElement, id = 'ses_one'): Promise<void> => {
    const row = panel.querySelector(`[data-testid="inbox-thread-${id}"]`)!.parentElement!
    await act(async () => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20, button: 2 })) })
    const item = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((entry) => entry.textContent?.trim() === 'Delete from Inbox')!
    await act(async () => item.click())
  }
  const confirm = async (): Promise<void> => {
    const button = Array.from(dialog()!.querySelectorAll('button')).find((entry) => entry.textContent?.trim() === 'Delete')!
    await act(async () => button.click())
  }

  it('deletes an ordinary thread with no worktree choice and no worktree flag', async () => {
    useWorkspace.setState({ inboxThreads: [thread()] })
    const panel = await render(createElement(InboxPanel))
    await openDialog(panel)
    expect(dialog()).not.toBeNull()
    expect(checkbox()).toBeNull()
    await confirm()
    expect(remove).toHaveBeenCalledWith({ id: 'ses_one' })
    await vi.waitFor(() => expect(useWorkspace.getState().inboxThreads).toEqual([]))
    expect(dialog()).toBeNull()
  })

  it('offers to remove a worktree thread’s worktree, off unless ticked', async () => {
    useWorkspace.setState({ inboxThreads: [inWorktree()] })
    const panel = await render(createElement(InboxPanel))
    await openDialog(panel)
    expect(checkbox()?.checked).toBe(false)
    expect(dialog()?.textContent).toContain('Also remove the worktree')
    expect(dialog()?.textContent).toContain('mde/1a2b3c4d')
    await confirm()
    expect(remove).toHaveBeenCalledWith({ id: 'ses_one' })
    expect(remove.mock.calls[0]?.[0]).not.toHaveProperty('removeWorktree')
  })

  it('removes the worktree too when ticked', async () => {
    useWorkspace.setState({ inboxThreads: [inWorktree()] })
    const panel = await render(createElement(InboxPanel))
    await openDialog(panel)
    await act(async () => checkbox()!.click())
    expect(checkbox()?.checked).toBe(true)
    await confirm()
    expect(remove).toHaveBeenCalledWith({ id: 'ses_one', removeWorktree: true })
    await vi.waitFor(() => expect(useWorkspace.getState().inboxThreads).toEqual([]))
  })

  it('reads the folder list again when the worktree went with the thread, since its entry did too', async () => {
    useInboxChat.setState({ folders: [{ id: 'fld_tree', name: 'app · mde/1a2b3c4d', directory: worktree.root, target: { kind: 'wsl', distro: 'Ubuntu' }, createdAt: 1, lastUsedAt: 1, worktree }], composer: {} })
    useWorkspace.setState({ inboxThreads: [inWorktree()] })
    const panel = await render(createElement(InboxPanel))
    await openDialog(panel)
    await act(async () => checkbox()!.click())
    await confirm()
    await vi.waitFor(() => expect(folders).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(useInboxChat.getState().folders).toEqual([]))
  })

  it('leaves the folder list alone when only the thread is deleted', async () => {
    useWorkspace.setState({ inboxThreads: [inWorktree()] })
    const panel = await render(createElement(InboxPanel))
    await openDialog(panel)
    await confirm()
    await vi.waitFor(() => expect(useWorkspace.getState().inboxThreads).toEqual([]))
    expect(folders).not.toHaveBeenCalled()
  })

  it('leaves the folder list alone when Git refuses to remove the worktree', async () => {
    remove.mockRejectedValueOnce(new Error('Could not remove the worktree: it has changes'))
    useWorkspace.setState({ inboxThreads: [inWorktree()] })
    const panel = await render(createElement(InboxPanel))
    await openDialog(panel)
    await act(async () => checkbox()!.click())
    await confirm()
    await vi.waitFor(() => expect(dialog()?.querySelector('[role="alert"]')).not.toBeNull())
    expect(folders).not.toHaveBeenCalled()
  })

  it('does not offer a worktree that another thread still runs in', async () => {
    useWorkspace.setState({ inboxThreads: [inWorktree(), inWorktree({ id: 'ses_fork', title: 'Fix login (fork #1)', forkedFrom: 'ses_one' })] })
    const panel = await render(createElement(InboxPanel))
    await openDialog(panel)
    expect(checkbox()).toBeNull()
    await confirm()
    expect(remove).toHaveBeenCalledWith({ id: 'ses_one' })
  })

  it('keeps the dialog and the thread when Git refuses, shows why, and lets the user delete without it', async () => {
    remove.mockRejectedValueOnce(new Error("Error invoking remote method 'inbox:remove': Error: Could not remove the worktree: contains modified or untracked files"))
    useWorkspace.setState({ inboxThreads: [inWorktree()] })
    const panel = await render(createElement(InboxPanel))
    await openDialog(panel)
    await act(async () => checkbox()!.click())
    await confirm()
    await vi.waitFor(() => expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe('Could not remove the worktree: contains modified or untracked files'))
    expect(useWorkspace.getState().inboxThreads.map((item) => item.id)).toEqual(['ses_one'])
    expect(checkbox()?.checked).toBe(true)
    // Untick it and delete the thread alone.
    await act(async () => checkbox()!.click())
    await confirm()
    expect(remove).toHaveBeenLastCalledWith({ id: 'ses_one' })
    await vi.waitFor(() => expect(useWorkspace.getState().inboxThreads).toEqual([]))
  })

  it('labels a worktree thread by its folder, not by the worktree’s random name', async () => {
    useWorkspace.setState({ inboxThreads: [inWorktree()], selectedInboxThreadId: 'ses_one' })
    const panel = await render(createElement(InboxPanel))
    const row = panel.querySelector('[data-testid="inbox-thread-ses_one"]')!
    // The label is the folder's; the worktree's own path stays available as its tooltip.
    expect(row.querySelector(`[title="${worktree.root}"]`)?.textContent).toBe('app')
    expect(row.textContent).toContain('mde/1a2b3c4d')
  })

  it('marks a worktree thread in its header by its folder and branch, and keeps the details in the tooltip', async () => {
    useWorkspace.setState({ inboxThreads: [inWorktree()], selectedInboxThreadId: 'ses_one' })
    const view = await render(createElement(InboxThreadView))
    const header = view.querySelector('header')!
    expect(header.querySelector('[data-testid="inbox-thread-folder"]')?.textContent).toBe('app')
    expect(header.querySelector('[data-testid="inbox-thread-folder"]')?.getAttribute('title')).toContain(worktree.root)
    expect(header.textContent).not.toContain('/home/me/app')
    expect(header.textContent).not.toContain('.mde/worktrees')
    const marker = header.querySelector('[data-testid="inbox-thread-worktree"]')
    expect(marker?.textContent).toContain('mde/1a2b3c4d')
    expect(marker?.getAttribute('title')).toContain('started from main')
    expect(marker?.getAttribute('title')).toContain(worktree.root)
  })
})
