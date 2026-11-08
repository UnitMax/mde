// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InboxPanel } from '../src/renderer/components/InboxPanel'
import {
  getInboxModelQuickSwitch,
  getInboxSidebarChanges,
  INBOX_MODEL_QUICK_SWITCH_STORAGE_KEY,
  INBOX_SIDEBAR_CHANGES_STORAGE_KEY,
  saveInboxModelQuickSwitch,
  saveInboxSidebarChanges
} from '../src/renderer/lib/inbox-settings'
import { useInboxView } from '../src/renderer/store/inbox-view'
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

  it('puts the gear at the end of the toolbar, after the buttons that open the filters', async () => {
    await act(async () => root.render(createElement(InboxPanel)))
    const filter = container.querySelector('[aria-label="Filter threads"]')!
    expect(gear().getAttribute('aria-label')).toBe('Inbox settings')
    expect(filter.compareDocumentPosition(gear()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('Inbox display setting for the model quick switch', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('IntersectionObserver', undefined)
    vi.stubGlobal('api', { inbox: { changes, setRead: vi.fn(async () => null), setArchived: vi.fn(async () => null) } })
    useWorkspace.setState({ platform: { platform: 'darwin', isWindows: false }, inboxThreads: [thread], selectedInboxThreadId: null, inboxMarkedUnread: {}, inboxCues: {}, activeWorkspaceView: 'inbox' })
    useInboxChanges.setState({ entries: {}, selectedPath: null, tab: 'files', sidebarChanges: false })
    useInboxView.setState({ modelQuickSwitch: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('is on until it is turned off, and an unreadable or unknown stored value is on too', () => {
    expect(getInboxModelQuickSwitch()).toBe(true)
    saveInboxModelQuickSwitch(false)
    expect(localStorage.getItem(INBOX_MODEL_QUICK_SWITCH_STORAGE_KEY)).toBe('off')
    expect(getInboxModelQuickSwitch()).toBe(false)
    saveInboxModelQuickSwitch(true)
    expect(getInboxModelQuickSwitch()).toBe(true)
    localStorage.setItem(INBOX_MODEL_QUICK_SWITCH_STORAGE_KEY, 'maybe')
    expect(getInboxModelQuickSwitch()).toBe(true)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(getInboxModelQuickSwitch()).toBe(true)
    vi.restoreAllMocks()
  })

  it('is a switch in the gear menu, checked at first, that turns it off and on', async () => {
    await act(async () => root.render(createElement(InboxPanel)))
    await openMenu()
    const entry = (): HTMLElement => document.body.querySelector<HTMLElement>('[data-testid="inbox-setting-quick-switch"]')!
    expect(entry().textContent).toContain('Model quick switch')
    expect(entry().getAttribute('aria-checked')).toBe('true')
    await act(async () => entry().click())
    expect(useInboxView.getState().modelQuickSwitch).toBe(false)
    expect(localStorage.getItem(INBOX_MODEL_QUICK_SWITCH_STORAGE_KEY)).toBe('off')
    await openMenu()
    expect(entry().getAttribute('aria-checked')).toBe('false')
  })
})
