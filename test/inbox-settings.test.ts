// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InboxPanel } from '../src/renderer/components/InboxPanel'
import { getInboxSidebarChanges, INBOX_SIDEBAR_CHANGES_STORAGE_KEY, saveInboxSidebarChanges } from '../src/renderer/lib/inbox-settings'
import { useInboxChanges } from '../src/renderer/store/inbox-changes'
import { useWorkspace } from '../src/renderer/store/workspace'
import type { InboxChangesResponse, InboxThread } from '../src/shared/types'

const thread: InboxThread = { id: 'ses_one', title: 'Fix', directory: '/home/me/app', target: { kind: 'native' }, branch: 'main', folderId: 'fld_app', createdAt: 1, lastActivityAt: Date.now(), readAt: Date.now(), archived: false, status: 'completed' }
const value: InboxChangesResponse = { available: true, branch: 'main', worktree: '/home/me/app', additions: 2, deletions: 1, fileCount: 1, files: [{ path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1 }] }
const changes = vi.fn(async (): Promise<InboxChangesResponse> => value)
let root: Root
let container: HTMLDivElement
const chip = (): Element | null => container.querySelector('[data-testid="inbox-changes-ses_one"]')
const gear = (): HTMLElement => container.querySelector<HTMLElement>('[data-testid="inbox-settings"]')!
const item = (): HTMLElement | null => document.body.querySelector('[data-testid="inbox-setting-changes"]')
const openMenu = async (): Promise<void> => {
  await act(async () => { gear().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
}

describe('Inbox display setting for Git changes', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('IntersectionObserver', undefined)
    vi.stubGlobal('api', { inbox: { changes, setRead: vi.fn(async () => null), setArchived: vi.fn(async () => null) } })
    changes.mockClear()
    useWorkspace.setState({
      platform: { platform: 'darwin', isWindows: false },
      inboxThreads: [thread],
      selectedInboxThreadId: null,
      inboxMarkedUnread: {},
      inboxCues: {},
      activeWorkspaceView: 'inbox',
    })
    useInboxChanges.setState({ entries: {}, selectedPath: null, tab: 'files', sidebarChanges: false })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('is off until it is turned on, and an unreadable or unknown stored value is off too', () => {
    expect(getInboxSidebarChanges()).toBe(false)
    saveInboxSidebarChanges(true)
    expect(localStorage.getItem(INBOX_SIDEBAR_CHANGES_STORAGE_KEY)).toBe('on')
    expect(getInboxSidebarChanges()).toBe(true)
    saveInboxSidebarChanges(false)
    expect(localStorage.getItem(INBOX_SIDEBAR_CHANGES_STORAGE_KEY)).toBe('off')
    expect(getInboxSidebarChanges()).toBe(false)
    localStorage.setItem(INBOX_SIDEBAR_CHANGES_STORAGE_KEY, 'yes')
    expect(getInboxSidebarChanges()).toBe(false)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(getInboxSidebarChanges()).toBe(false)
    expect(() => saveInboxSidebarChanges(true)).not.toThrow()
    vi.restoreAllMocks()
  })

  it('keeps Git changes out of the thread list, and out of Git, until the gear menu turns them on', async () => {
    await act(async () => root.render(createElement(InboxPanel)))
    expect(container.querySelector('[data-testid="inbox-thread-ses_one"]')).not.toBeNull()
    expect(chip()).toBeNull()
    expect(changes).not.toHaveBeenCalled()

    await openMenu()
    expect(item()?.getAttribute('role')).toBe('menuitemcheckbox')
    expect(item()?.getAttribute('aria-checked')).toBe('false')
    expect(item()?.textContent).toContain('Git changes')
    await act(async () => item()!.click())
    expect(chip()?.textContent).toContain('1 file')
    expect(changes).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(INBOX_SIDEBAR_CHANGES_STORAGE_KEY)).toBe('on')

    await openMenu()
    expect(item()?.getAttribute('aria-checked')).toBe('true')
    await act(async () => item()!.click())
    expect(chip()).toBeNull()
    expect(localStorage.getItem(INBOX_SIDEBAR_CHANGES_STORAGE_KEY)).toBe('off')
  })

  it('stops asking Git for the thread list as soon as it is turned off', async () => {
    vi.useFakeTimers()
    useInboxChanges.setState({ sidebarChanges: true })
    await act(async () => root.render(createElement(InboxPanel)))
    expect(changes).toHaveBeenCalledTimes(1)
    await act(async () => useInboxChanges.getState().setSidebarChanges(false))
    await act(async () => vi.advanceTimersByTimeAsync(60_000))
    expect(changes).toHaveBeenCalledTimes(1)
  })

  it('puts the gear after the filters, outside the filter group', async () => {
    await act(async () => root.render(createElement(InboxPanel)))
    const group = container.querySelector('[aria-label="Inbox filter"]')!
    expect(group.querySelectorAll('button')).toHaveLength(4)
    expect(group.contains(gear())).toBe(false)
    expect(gear().getAttribute('aria-label')).toBe('Inbox settings')
    expect(group.compareDocumentPosition(gear()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
