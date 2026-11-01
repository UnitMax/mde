// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxThread } from '../src/shared/types'
import { InboxPanel } from '../src/renderer/components/InboxPanel'
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { useWorkspace } from '../src/renderer/store/workspace'

const roots: Root[] = []
const setRead = vi.fn(async () => null)

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
    inbox: { setRead, setArchived: vi.fn(async () => null), remove: vi.fn(async () => undefined) },
    chat: {
      draft: vi.fn(async () => ({ text: '', revision: 0, attachments: [] })),
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

describe('Inbox', () => {
  it('is locked where OpenCode’s service is not reachable, and works without status reporting elsewhere', async () => {
    useWorkspace.setState({ platform: { platform: 'linux', isWindows: false }, inboxThreads: [thread()] })
    const panel = await render(createElement(InboxPanel))
    expect(panel.querySelector('[data-testid="inbox-locked"]')).not.toBeNull()
    expect(panel.querySelector('[data-testid="inbox-thread-ses_one"]')).toBeNull()
    const main = await render(createElement(InboxThreadView))
    expect(main.querySelector('[data-testid="inbox-locked"]')).not.toBeNull()
    expect(main.querySelector('[aria-label="Regenerate title"]')).toBeNull()

    useWorkspace.setState({ platform: { platform: 'win32', isWindows: true }, opencodeTuiEnabled: false })
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
    expect(main.textContent).toContain('/home/me/app (Ubuntu)')
    await vi.waitFor(() => expect(main.textContent).toContain('Please fix the login'))
    expect(main.querySelector('[data-testid="chat-composer"]')).not.toBeNull()
  })

  it('archives a thread straight from its row and shows a spinner while it works', async () => {
    useWorkspace.setState({ inboxThreads: [thread({ status: 'working' })] })
    const panel = await render(createElement(InboxPanel))
    expect(panel.querySelector('[data-testid="inbox-status-chip"] svg.animate-spin')).not.toBeNull()
    const archive = panel.querySelector<HTMLButtonElement>('[data-testid="inbox-thread-archive-ses_one"]')!
    expect(archive.getAttribute('aria-label')).toBe('Archive')
    await act(async () => archive.click())
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
        thread(),
        thread({ id: 'ses_two', title: 'Question', status: 'attention', attentionReason: 'question', branch: null })
      ]
    })
    const panel = await render(createElement(InboxPanel))
    const filter = (label: string) => Array.from(panel.querySelectorAll('button')).find((item) => item.textContent === label)!
    await act(async () => filter('Needs input').click())
    expect(panel.querySelector('[data-testid="inbox-thread-ses_one"]')).toBeNull()
    expect(panel.querySelector('[data-testid="inbox-thread-ses_two"]')).not.toBeNull()
    await act(async () => filter('All').click())

    const search = panel.querySelector<HTMLInputElement>('[aria-label="Search inbox"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(search, 'feature')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(panel.querySelector('[data-testid="inbox-thread-ses_one"]')).not.toBeNull()
    expect(panel.querySelector('[data-testid="inbox-thread-ses_two"]')).toBeNull()
  })
})
