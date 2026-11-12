// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InboxPanel } from '../src/renderer/components/InboxPanel'
import { getInboxSnoozedOpen, INBOX_SNOOZED_OPEN_STORAGE_KEY } from '../src/renderer/lib/inbox-settings'
import { useInboxChanges } from '../src/renderer/store/inbox-changes'
import { useInboxView } from '../src/renderer/store/inbox-view'
import { useWorkspace } from '../src/renderer/store/workspace'
import type { InboxThread } from '../src/shared/types'

const HOUR = 60 * 60 * 1000

function thread(overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id: 'ses_one', title: 'Fix login', directory: '/home/me/app', target: { kind: 'native' }, branch: 'main', folderId: 'fld_app',
    createdAt: 1, lastActivityAt: Date.now() - 60_000, readAt: Date.now(), archived: false, status: 'completed',
    ...overrides,
  }
}

let root: Root
let container: HTMLDivElement
const setSnoozed = vi.fn(async ({ id, until }: { id: string; until: number | null }) => {
  const current = useWorkspace.getState().inboxThreads.find((item) => item.id === id)
  if (!current) return null
  const { snoozedUntil: _until, ...rest } = current
  return until === null ? rest : { ...rest, snoozedUntil: until }
})
const q = (testId: string): HTMLElement | null => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
const menu = (testId: string): HTMLElement | null => document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
const render = async (): Promise<void> => { await act(async () => root.render(createElement(InboxPanel))) }
const openThreadMenu = async (id: string): Promise<void> => {
  const row = q(`inbox-thread-${id}`)!.parentElement!
  await act(async () => {
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20, button: 2 }))
  })
}

describe('Inbox snooze', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('IntersectionObserver', undefined)
    vi.stubGlobal('api', { inbox: { changes: vi.fn(), setRead: vi.fn(async () => null), setArchived: vi.fn(), setPinned: vi.fn(), setSnoozed, remove: vi.fn(), folders: vi.fn() } })
    setSnoozed.mockClear()
    useWorkspace.setState({
      platform: { platform: 'darwin', isWindows: false },
      inboxThreads: [
        thread({ id: 'ses_one', title: 'Fix login' }),
        thread({ id: 'ses_later', title: 'Review later', snoozedUntil: Date.now() + 5 * HOUR }),
        thread({ id: 'ses_woke', title: 'Back again', woke: true, readAt: 0 }),
      ],
      selectedInboxThreadId: null,
      inboxMarkedUnread: {},
      inboxCues: {},
      activeWorkspaceView: 'inbox',
    })
    useInboxChanges.setState({ entries: {}, selectedPath: null, tab: 'files', sidebarChanges: false })
    useInboxView.setState({ workingSection: false, snoozedOpen: getInboxSnoozedOpen() })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('keeps snoozed threads in a section that starts folded up, and remembers it opened', async () => {
    expect(getInboxSnoozedOpen()).toBe(false)
    await render()
    const list = q('inbox-thread-list')!
    expect(list.querySelector('[data-testid="inbox-thread-ses_later"]')).toBeNull()
    expect(list.querySelector('[data-testid="inbox-thread-ses_one"]')).not.toBeNull()
    expect(q('inbox-snoozed-count')?.textContent).toBe('1')
    expect(q('inbox-snoozed-toggle')?.getAttribute('aria-expanded')).toBe('false')
    expect(q('inbox-snoozed-list')).toBeNull()

    await act(async () => q('inbox-snoozed-toggle')!.click())
    expect(localStorage.getItem(INBOX_SNOOZED_OPEN_STORAGE_KEY)).toBe('on')
    expect(q('inbox-snoozed-list')?.querySelector('[data-testid="inbox-thread-ses_later"]')).not.toBeNull()
    // It says when it comes back instead of how long ago something happened.
    expect(q('inbox-thread-snoozed-until-ses_later')?.title).toMatch(/^Snoozed until /)
  })

  it('has no section while nothing is snoozed', async () => {
    useWorkspace.setState({ inboxThreads: [thread()] })
    await render()
    expect(q('inbox-snoozed-section')).toBeNull()
  })

  it('snoozes from the right-click menu for an hour, five hours, or until tomorrow at 8:00', async () => {
    await render()
    await openThreadMenu('ses_one')
    await act(async () => menu('inbox-thread-snooze-ses_one')!.click())
    expect(menu('inbox-snooze-hour')?.textContent).toContain('1 hour')
    expect(menu('inbox-snooze-hours')?.textContent).toContain('5 hours')
    expect(menu('inbox-snooze-morning')?.textContent).toContain('Tomorrow morning')
    const before = Date.now()
    await act(async () => menu('inbox-snooze-hour')!.click())
    expect(setSnoozed).toHaveBeenCalledTimes(1)
    const { id, until } = setSnoozed.mock.calls[0]![0]
    expect(id).toBe('ses_one')
    expect(until).toBeGreaterThanOrEqual(before + HOUR)
    expect(until).toBeLessThan(before + HOUR + 5_000)
    // Out of the list, into the section.
    expect(q('inbox-thread-list')!.querySelector('[data-testid="inbox-thread-ses_one"]')).toBeNull()
    expect(q('inbox-snoozed-count')?.textContent).toBe('2')

    await openThreadMenu('ses_woke')
    await act(async () => menu('inbox-thread-snooze-ses_woke')!.click())
    await act(async () => menu('inbox-snooze-morning')!.click())
    const tomorrow = new Date()
    expect(setSnoozed.mock.calls[1]![0].until).toBe(new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate() + 1, 8).getTime())
  })

  it('offers Unsnooze for a snoozed thread', async () => {
    useInboxView.setState({ snoozedOpen: true })
    await render()
    await openThreadMenu('ses_later')
    expect(menu('inbox-thread-snooze-ses_later')).toBeNull()
    await act(async () => menu('inbox-thread-unsnooze-ses_later')!.click())
    expect(setSnoozed).toHaveBeenCalledWith({ id: 'ses_later', until: null })
    expect(q('inbox-thread-list')!.querySelector('[data-testid="inbox-thread-ses_later"]')).not.toBeNull()
    expect(q('inbox-snoozed-section')).toBeNull()
  })

  it('marks a thread that came back as "Woke up", unread', async () => {
    await render()
    const row = q('inbox-thread-ses_woke')!
    expect(row.getAttribute('data-unread')).toBe('true')
    expect(row.querySelector('[data-testid="inbox-status-chip"]')?.textContent).toContain('Woke up')
  })
})
