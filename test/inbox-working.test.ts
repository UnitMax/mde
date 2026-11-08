// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InboxPanel } from '../src/renderer/components/InboxPanel'
import {
  getInboxWorkingCollapsed,
  getInboxWorkingSection,
  INBOX_WORKING_COLLAPSED_STORAGE_KEY,
  INBOX_WORKING_SECTION_STORAGE_KEY,
  saveInboxWorkingCollapsed,
  saveInboxWorkingSection,
} from '../src/renderer/lib/inbox-settings'
import { useInboxChanges } from '../src/renderer/store/inbox-changes'
import { useInboxView } from '../src/renderer/store/inbox-view'
import { useWorkspace } from '../src/renderer/store/workspace'
import type { InboxThread } from '../src/shared/types'
import { openInboxSearch, showInboxThreads } from './helpers/inbox-toolbar'

function thread(overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id: 'ses_one', title: 'Fix login', directory: '/home/me/app', target: { kind: 'native' }, branch: 'main', folderId: 'fld_app',
    createdAt: 1, lastActivityAt: Date.now() - 60_000, readAt: Date.now(), archived: false, status: 'completed',
    ...overrides,
  }
}

const threads: InboxThread[] = [
  thread({ id: 'ses_run', title: 'Refactor parser', status: 'working', workingSince: Date.now() - 5_000 }),
  thread({ id: 'ses_run2', title: 'Write docs', status: 'working', workingSince: Date.now() - 90_000 }),
  thread({ id: 'ses_done', title: 'Finished job', status: 'completed' }),
  thread({ id: 'ses_failed', title: 'Broken job', status: 'error' }),
  thread({ id: 'ses_ask', title: 'Needs an answer', status: 'attention', attentionReason: 'question' }),
  thread({ id: 'ses_idle', title: 'Not started', status: 'idle' }),
  thread({ id: 'ses_parked', title: 'Parked run', status: 'working', archived: true }),
]

let root: Root
let container: HTMLDivElement
const setRead = vi.fn(async () => null)
const setArchived = vi.fn(async () => null)
const setPinned = vi.fn(async ({ id, pinned }: { id: string; pinned: boolean }) => {
  const current = useWorkspace.getState().inboxThreads.find((item) => item.id === id)
  return current ? { ...current, pinned } : null
})
const q = (testId: string): HTMLElement | null => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
const section = (): HTMLElement | null => q('inbox-working-section')
const gear = (): HTMLElement => q('inbox-settings')!
const toggle = (): HTMLElement => q('inbox-working-toggle')!
const idsIn = (area: Element | null | undefined): string[] =>
  Array.from(area?.querySelectorAll('[data-testid^="inbox-thread-ses_"]') ?? [])
    .map((row) => row.getAttribute('data-testid')!)
    .filter((id) => !/-(park|cue|fork-mark)-/.test(id))
    .map((id) => id.replace('inbox-thread-', ''))
/** The threads in the Working section. */
const rowIds = (): string[] => idsIn(section())
/** The threads in the list above it. */
const listIds = (): string[] => idsIn(q('inbox-thread-list'))
const menuItem = (): HTMLElement | null => document.body.querySelector('[data-testid="inbox-setting-working"]')
const openMenu = async (): Promise<void> => {
  await act(async () => { gear().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
}
const render = async (): Promise<void> => { await act(async () => root.render(createElement(InboxPanel))) }
const openThreadMenu = async (id: string): Promise<void> => {
  const row = q(`inbox-thread-${id}`)!.parentElement!
  await act(async () => {
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20, button: 2 }))
  })
}
const chooseThreadAction = async (label: string): Promise<void> => {
  const item = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    .find((entry) => entry.textContent?.trim() === label)!
  await act(async () => item.click())
}

describe('Inbox Working section', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('IntersectionObserver', undefined)
    vi.stubGlobal('api', { inbox: { changes: vi.fn(), setRead, setArchived, setPinned, remove: vi.fn(), folders: vi.fn() } })
    setRead.mockClear()
    setArchived.mockClear()
    setPinned.mockClear()
    useWorkspace.setState({
      platform: { platform: 'darwin', isWindows: false },
      inboxThreads: threads,
      selectedInboxThreadId: null,
      inboxMarkedUnread: {},
      inboxCues: {},
      activeWorkspaceView: 'inbox',
    })
    useInboxChanges.setState({ entries: {}, selectedPath: null, tab: 'files', sidebarChanges: false })
    useInboxView.setState({ workingSection: false, workingCollapsed: false })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('the preferences', () => {
    it('are off and open until they were set, and read as such when storage is unreadable or holds something else', () => {
      expect(getInboxWorkingSection()).toBe(false)
      expect(getInboxWorkingCollapsed()).toBe(false)
      saveInboxWorkingSection(true)
      saveInboxWorkingCollapsed(true)
      expect(localStorage.getItem(INBOX_WORKING_SECTION_STORAGE_KEY)).toBe('on')
      expect(localStorage.getItem(INBOX_WORKING_COLLAPSED_STORAGE_KEY)).toBe('on')
      expect(getInboxWorkingSection()).toBe(true)
      expect(getInboxWorkingCollapsed()).toBe(true)
      saveInboxWorkingSection(false)
      saveInboxWorkingCollapsed(false)
      expect(localStorage.getItem(INBOX_WORKING_SECTION_STORAGE_KEY)).toBe('off')
      expect(getInboxWorkingSection()).toBe(false)
      expect(getInboxWorkingCollapsed()).toBe(false)
      localStorage.setItem(INBOX_WORKING_SECTION_STORAGE_KEY, 'yes')
      expect(getInboxWorkingSection()).toBe(false)
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
      expect(getInboxWorkingSection()).toBe(false)
      expect(getInboxWorkingCollapsed()).toBe(false)
      expect(() => saveInboxWorkingSection(true)).not.toThrow()
      expect(() => useInboxView.getState().setWorkingCollapsed(true)).not.toThrow()
      // The choice still holds for this session.
      expect(useInboxView.getState().workingCollapsed).toBe(true)
    })

    it('are kept by the view store, which the section and the menu share', () => {
      useInboxView.getState().setWorkingSection(true)
      useInboxView.getState().setWorkingCollapsed(true)
      expect(localStorage.getItem(INBOX_WORKING_SECTION_STORAGE_KEY)).toBe('on')
      expect(localStorage.getItem(INBOX_WORKING_COLLAPSED_STORAGE_KEY)).toBe('on')
    })
  })

  it('is not there until the gear menu turns it on, however many threads are working, which stay in the list', async () => {
    await render()
    expect(q('inbox-thread-ses_run')).not.toBeNull()
    expect(section()).toBeNull()
    expect(listIds()).toEqual(expect.arrayContaining(['ses_run', 'ses_run2']))
  })

  it('is turned on and off from the gear menu, which names it and says what it does', async () => {
    await render()
    await openMenu()
    expect(menuItem()?.getAttribute('role')).toBe('menuitemcheckbox')
    expect(menuItem()?.getAttribute('aria-checked')).toBe('false')
    expect(menuItem()?.textContent).toContain('Working section')
    expect(menuItem()?.textContent).toContain('move from the list')
    await act(async () => menuItem()!.click())
    expect(section()).not.toBeNull()
    expect(localStorage.getItem(INBOX_WORKING_SECTION_STORAGE_KEY)).toBe('on')

    // The working threads moved out of the list into the section.
    expect(listIds()).not.toContain('ses_run')

    await openMenu()
    expect(menuItem()?.getAttribute('aria-checked')).toBe('true')
    await act(async () => menuItem()!.click())
    expect(section()).toBeNull()
    expect(localStorage.getItem(INBOX_WORKING_SECTION_STORAGE_KEY)).toBe('off')
    // Switched off, they are back in the list.
    expect(listIds()).toEqual(expect.arrayContaining(['ses_run', 'ses_run2']))
  })

  it('lists the working threads and no others, below the thread list', async () => {
    useInboxView.setState({ workingSection: true })
    await render()
    // The newest run first; the parked one, the finished, failed, waiting and idle ones are not working.
    expect(rowIds()).toEqual(['ses_run', 'ses_run2'])
    expect(q('inbox-working-count')?.textContent).toBe('2')
    expect(section()?.textContent).toContain('Working')
    expect(section()?.textContent).toContain('Refactor parser')
    expect(section()?.textContent).not.toContain('Finished job')
    const list = q('inbox-thread-list')!
    expect(list.compareDocumentPosition(section()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(list.contains(section())).toBe(false)
  })

  it('keeps a working thread in the section only, and the others in the list', async () => {
    useInboxView.setState({ workingSection: true })
    await render()
    // Each thread is in one place. The parked one is not working as far as the section goes, so it is in neither.
    expect(rowIds()).toEqual(['ses_run', 'ses_run2'])
    expect(listIds()).toEqual(expect.arrayContaining(['ses_done', 'ses_failed', 'ses_ask', 'ses_idle']))
    expect(listIds()).not.toContain('ses_run')
    expect(listIds()).not.toContain('ses_run2')
    expect(container.querySelectorAll('[data-testid="inbox-thread-ses_run"]')).toHaveLength(1)
    expect(section()?.querySelector('[data-testid="inbox-status-chip"]')?.textContent).toContain('Working')
  })

  it('leaves a parked thread that is working under Parked, since it is not in the section', async () => {
    useInboxView.setState({ workingSection: true })
    await render()
    expect(container.textContent).not.toContain('Parked run')
    await showInboxThreads(container, 'Parked')
    expect(listIds()).toEqual(['ses_parked'])
  })

  it('keeps working threads out of the Unread tab too', async () => {
    useWorkspace.setState({ inboxThreads: [
      thread({ id: 'ses_run', status: 'working', readAt: 0, workingSince: Date.now() }),
      thread({ id: 'ses_read_done', status: 'completed', readAt: 0 }),
    ] })
    await render()
    await showInboxThreads(container, 'Unread')
    expect(listIds()).toEqual(['ses_run', 'ses_read_done'])
    await act(async () => useInboxView.getState().setWorkingSection(true))
    expect(listIds()).toEqual(['ses_read_done'])
    expect(rowIds()).toEqual(['ses_run'])
  })

  it('does not say there are no threads when they are all working', async () => {
    useWorkspace.setState({ inboxThreads: [thread({ id: 'ses_run', status: 'working' })] })
    await render()
    expect(q('inbox-thread-list')?.textContent).not.toContain('No other threads.')
    await act(async () => useInboxView.getState().setWorkingSection(true))
    expect(q('inbox-thread-list')?.textContent).toBe('No other threads.')
    expect(rowIds()).toEqual(['ses_run'])
    await act(async () => useWorkspace.setState({ inboxThreads: [] }))
    expect(q('inbox-thread-list')?.textContent).toContain('No threads yet.')
  })

  it('opens a thread from the section, and marks it as the open one', async () => {
    useInboxView.setState({ workingSection: true })
    await render()
    await act(async () => q('inbox-thread-ses_run2')!.click())
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_run2')
    expect(q('inbox-thread-ses_run2')?.getAttribute('aria-current')).toBe('true')
    expect(q('inbox-thread-ses_run')?.getAttribute('aria-current')).toBeNull()
  })

  it('has the thread actions of the list, such as parking', async () => {
    useInboxView.setState({ workingSection: true })
    await render()
    await act(async () => q('inbox-thread-park-ses_run')!.click())
    expect(setArchived).toHaveBeenCalledWith({ id: 'ses_run', archived: true })
    expect(useWorkspace.getState().selectedInboxThreadId).toBeNull()
  })

  it('pins and unpins from the list menu with a pin icon and no extra heading', async () => {
    useWorkspace.setState({ inboxThreads: [
      thread({ id: 'ses_new', lastActivityAt: 200 }),
      thread({ id: 'ses_old', lastActivityAt: 100 }),
    ] })
    await render()
    expect(listIds()).toEqual(['ses_new', 'ses_old'])
    await openThreadMenu('ses_old')
    await chooseThreadAction('Pin thread')
    expect(setPinned).toHaveBeenCalledWith({ id: 'ses_old', pinned: true })
    expect(listIds()).toEqual(['ses_old', 'ses_new'])
    expect(q('inbox-thread-ses_old')?.querySelector('[role="img"][aria-label="Pinned thread"]')).not.toBeNull()
    expect(q('inbox-thread-list')?.textContent).not.toContain('Pinned')
    expect(q('inbox-thread-list')?.querySelector('h1, h2, h3, [role="heading"]')).toBeNull()
    expect(useWorkspace.getState().selectedInboxThreadId).toBeNull()
    await openThreadMenu('ses_old')
    await chooseThreadAction('Unpin thread')
    expect(setPinned).toHaveBeenLastCalledWith({ id: 'ses_old', pinned: false })
    expect(listIds()).toEqual(['ses_new', 'ses_old'])
    expect(q('inbox-thread-ses_old')?.querySelector('[aria-label="Pinned thread"]')).toBeNull()
  })

  it('moves a pinned working thread into the main list and keeps it there when Working is folded', async () => {
    useInboxView.setState({ workingSection: true })
    await render()
    expect(rowIds()).toEqual(['ses_run', 'ses_run2'])
    await openThreadMenu('ses_run2')
    await chooseThreadAction('Pin thread')
    expect(listIds()[0]).toBe('ses_run2')
    expect(rowIds()).toEqual(['ses_run'])
    expect(q('inbox-working-count')?.textContent).toBe('1')
    expect(q('inbox-thread-ses_run2')?.textContent).toContain('Working')
    await act(async () => toggle().click())
    expect(listIds()[0]).toBe('ses_run2')
    // Finishing and starting again keeps its place and pin.
    for (const status of ['completed', 'working'] as const) {
      await act(async () => {
        const current = useWorkspace.getState().inboxThreads.find((item) => item.id === 'ses_run2')!
        useWorkspace.getState().upsertInboxThread({ ...current, status })
      })
      expect(listIds()[0]).toBe('ses_run2')
    }
    await openThreadMenu('ses_run2')
    await chooseThreadAction('Unpin thread')
    expect(listIds()).not.toContain('ses_run2')
    expect(q('inbox-working-count')?.textContent).toBe('2')
    await act(async () => toggle().click())
    expect(rowIds()).toEqual(['ses_run', 'ses_run2'])
  })

  it('ignores the filter tabs, so it always shows what is running', async () => {
    useInboxView.setState({ workingSection: true })
    await render()
    await showInboxThreads(container, 'Unread')
    expect(listIds()).toEqual(['ses_ask'])
    expect(rowIds()).toEqual(['ses_run', 'ses_run2'])
    await showInboxThreads(container, 'Parked')
    expect(rowIds()).toEqual(['ses_run', 'ses_run2'])
  })

  it('is searched with the list, since a working thread is not in the list to be found there', async () => {
    useInboxView.setState({ workingSection: true })
    await render()
    const search = await openInboxSearch(container)
    const type = async (text: string): Promise<void> => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, text)
        search.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await type('parser')
    expect(rowIds()).toEqual(['ses_run'])
    expect(q('inbox-working-count')?.textContent).toBe('1')
    expect(q('inbox-thread-list')?.textContent).toBe('No threads match your search.')

    await type('finished')
    expect(listIds()).toEqual(['ses_done'])
    expect(rowIds()).toEqual([])
    expect(q('inbox-working-list')?.textContent).toBe('No working threads match your search.')
    expect(q('inbox-working-count')?.textContent).toBe('0')

    await type('')
    expect(rowIds()).toEqual(['ses_run', 'ses_run2'])
  })

  it('follows the threads as they start and stop', async () => {
    useInboxView.setState({ workingSection: true })
    await render()
    await act(async () => {
      useWorkspace.setState({
        inboxThreads: threads.map((item) => item.id === 'ses_run' ? { ...item, status: 'completed' as const }
          : item.id === 'ses_ask' ? { ...item, status: 'working' as const, attentionReason: undefined } : item),
      })
    })
    expect(rowIds().sort()).toEqual(['ses_ask', 'ses_run2'])
    expect(q('inbox-working-count')?.textContent).toBe('2')
    // A thread that stopped working is back in the list, and one that started has left it.
    expect(listIds()).toContain('ses_run')
    expect(listIds()).not.toContain('ses_ask')
    // A question that is asked moves the thread out of the section, into the list.
    await act(async () => {
      useWorkspace.setState({ inboxThreads: threads.map((item) => item.status === 'working' ? { ...item, status: 'attention' as const, attentionReason: 'permission' as const } : item) })
    })
    expect(rowIds()).toEqual([])
    expect(listIds()).toEqual(expect.arrayContaining(['ses_run', 'ses_run2']))
  })

  it('says so when nothing is working, and still counts', async () => {
    useWorkspace.setState({ inboxThreads: [thread({ id: 'ses_done', status: 'completed' })] })
    useInboxView.setState({ workingSection: true })
    await render()
    expect(q('inbox-working-count')?.textContent).toBe('0')
    expect(q('inbox-working-list')?.textContent).toBe('No threads are working.')
  })

  describe('folding up', () => {
    it('is open at first, and folds up to the header and its count', async () => {
      useInboxView.setState({ workingSection: true })
      await render()
      expect(toggle().getAttribute('aria-expanded')).toBe('true')
      expect(toggle().getAttribute('aria-controls')).toBe('inbox-working-list')
      expect(q('inbox-working-list')?.id).toBe('inbox-working-list')

      await act(async () => toggle().click())
      expect(toggle().getAttribute('aria-expanded')).toBe('false')
      expect(q('inbox-working-list')).toBeNull()
      expect(q('inbox-working-ses_run')).toBeNull()
      expect(q('inbox-working-count')?.textContent).toBe('2')
      expect(localStorage.getItem(INBOX_WORKING_COLLAPSED_STORAGE_KEY)).toBe('on')
      // Folded up, the working threads are only counted; the rest of the list is as it was.
      expect(q('inbox-thread-ses_run')).toBeNull()
      expect(listIds()).toContain('ses_done')

      await act(async () => toggle().click())
      expect(toggle().getAttribute('aria-expanded')).toBe('true')
      expect(rowIds()).toEqual(['ses_run', 'ses_run2'])
      expect(localStorage.getItem(INBOX_WORKING_COLLAPSED_STORAGE_KEY)).toBe('off')
    })

    it('comes back folded when it was left folded, and keeps counting while folded', async () => {
      useInboxView.setState({ workingSection: true, workingCollapsed: true })
      await render()
      expect(toggle().getAttribute('aria-expanded')).toBe('false')
      expect(q('inbox-working-list')).toBeNull()
      expect(q('inbox-working-count')?.textContent).toBe('2')
      await act(async () => {
        useWorkspace.setState({ inboxThreads: [...threads, thread({ id: 'ses_extra', status: 'working' })] })
      })
      expect(q('inbox-working-count')?.textContent).toBe('3')
    })

    it('stays folded through switching it off and on again', async () => {
      useInboxView.setState({ workingSection: true })
      await render()
      await act(async () => toggle().click())
      await act(async () => useInboxView.getState().setWorkingSection(false))
      expect(section()).toBeNull()
      await act(async () => useInboxView.getState().setWorkingSection(true))
      expect(toggle().getAttribute('aria-expanded')).toBe('false')
    })
  })

  it('is not drawn where the Inbox is locked', async () => {
    useWorkspace.setState({ platform: { platform: 'linux', isWindows: false } })
    useInboxView.setState({ workingSection: true })
    await render()
    expect(q('inbox-locked')).not.toBeNull()
    expect(section()).toBeNull()
  })

  it('keeps the gear at the end of the toolbar with both switches in its menu', async () => {
    await render()
    await openMenu()
    expect(document.body.querySelector('[data-testid="inbox-setting-changes"]')).not.toBeNull()
    expect(menuItem()).not.toBeNull()
    expect(container.querySelector('[aria-label="Filter threads"]')).not.toBeNull()
  })
})
