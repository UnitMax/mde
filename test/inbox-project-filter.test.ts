// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InboxPanel } from '../src/renderer/components/InboxPanel'
import { draftsInProject } from '../src/renderer/lib/inbox-drafts'
import {
  getInboxProjectFilter,
  INBOX_PROJECT_FILTER_STORAGE_KEY,
  saveInboxProjectFilter,
} from '../src/renderer/lib/inbox-settings'
import { inboxProjects, inboxProjectSummaries, inboxThreadsInProject } from '../src/renderer/lib/inbox'
import { useInboxChanges } from '../src/renderer/store/inbox-changes'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useInboxDrafts } from '../src/renderer/store/inbox-drafts'
import { useInboxView } from '../src/renderer/store/inbox-view'
import { useWorkspace } from '../src/renderer/store/workspace'
import type { ChatDraftSummary, InboxFolder, InboxThread } from '../src/shared/types'

function folder(id: string, name: string, overrides: Partial<InboxFolder> = {}): InboxFolder {
  return { id, name, directory: `/home/me/${name}`, target: { kind: 'native' }, createdAt: 1, lastUsedAt: 1, ...overrides }
}

function thread(overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id: 'ses_one', title: 'Fix login', directory: '/home/me/app', target: { kind: 'native' }, branch: 'main', folderId: 'fld_app',
    createdAt: 1, lastActivityAt: Date.now() - 60_000, readAt: Date.now(), archived: false, status: 'completed',
    ...overrides,
  }
}

function draft(overrides: Partial<ChatDraftSummary> = {}): ChatDraftSummary {
  return { id: 'drf_one', folderId: 'fld_app', preview: 'Add a dark theme', attachments: 0, updatedAt: Date.now() - 60_000, ...overrides }
}

const app = folder('fld_app', 'app', { icon: { kind: 'symbol', id: 'rocket', color: 'violet' } })
const web = folder('fld_web', 'web')
// A worktree MDE made from app: a folder of its own, but not a project.
const appWorktree = folder('fld_wt', 'app-wt', {
  directory: '/home/me/app/.mde/wt1',
  worktree: { repository: '/home/me/app', root: '/home/me/app/.mde/wt1', branch: 'mde/wt1', base: 'main' },
})
const folders = [web, appWorktree, app]
const ids = (list: readonly { id: string }[]): string[] => list.map((item) => item.id)

describe('the threads of a project', () => {
  const unread = Date.now() - 1_000
  const threads = [
    thread({ id: 'ses_app', folderId: 'fld_app' }),
    thread({ id: 'ses_web', folderId: 'fld_web', directory: '/home/me/web' }),
    thread({
      id: 'ses_wt', folderId: 'fld_wt', directory: '/home/me/app/.mde/wt1',
      worktree: { repository: '/home/me/app', root: '/home/me/app/.mde/wt1', branch: 'mde/wt1', base: 'main' },
    }),
    thread({ id: 'ses_gone', folderId: 'fld_removed', directory: '/home/me/old' }),
  ]

  it('are all of them with no project picked, and a copy, so sorting it cannot reorder the store', () => {
    const all = inboxThreadsInProject(threads, null, folders)
    expect(ids(all)).toEqual(['ses_app', 'ses_web', 'ses_wt', 'ses_gone'])
    expect(all).not.toBe(threads)
  })

  it('are the ones started in it, including those in a worktree cut from it', () => {
    expect(ids(inboxThreadsInProject(threads, app, folders))).toEqual(['ses_app', 'ses_wt'])
    expect(ids(inboxThreadsInProject(threads, web, folders))).toEqual(['ses_web'])
  })

  it('leave out a thread whose project has been removed from the Inbox', () => {
    expect(ids(inboxThreadsInProject(threads, app, folders))).not.toContain('ses_gone')
    expect(ids(inboxThreadsInProject(threads, web, folders))).not.toContain('ses_gone')
  })

  it('are told apart by where the project is, not just its path: the same folder on another target is another project', () => {
    const wslApp = folder('fld_wsl', 'app', { target: { kind: 'wsl', distro: 'Ubuntu' } })
    const worktreeThread = thread({
      id: 'ses_native_wt', folderId: 'fld_wt', worktree: { repository: '/home/me/app', root: '/x', branch: 'b', base: 'main' },
    })
    expect(ids(inboxThreadsInProject([worktreeThread], app, [app, wslApp, appWorktree]))).toEqual(['ses_native_wt'])
    expect(ids(inboxThreadsInProject([worktreeThread], wslApp, [app, wslApp, appWorktree]))).toEqual([])
  })

  it('count only what is in the Inbox, with the unread among them', () => {
    const summaries = inboxProjectSummaries(
      [
        thread({ id: 'ses_a', folderId: 'fld_app', readAt: 0, lastActivityAt: unread }),
        thread({ id: 'ses_b', folderId: 'fld_app' }),
        thread({ id: 'ses_parked', folderId: 'fld_app', archived: true, readAt: 0, lastActivityAt: unread }),
        thread({
          id: 'ses_c', folderId: 'fld_wt', readAt: 0, lastActivityAt: unread,
          worktree: { repository: '/home/me/app', root: '/x', branch: 'b', base: 'main' },
        }),
        thread({ id: 'ses_gone', folderId: 'fld_removed', readAt: 0, lastActivityAt: unread }),
      ],
      folders
    )
    expect(summaries.map(({ project, threads: count, unread: unreadCount }) => [project.id, count, unreadCount])).toEqual([
      ['fld_app', 3, 2],
      ['fld_web', 0, 0],
    ])
  })

  it('are listed by project name, with no worktree among the projects', () => {
    expect(inboxProjects(folders).map((project) => project.id)).toEqual(['fld_web', 'fld_app'])
    const named = [folder('fld_b', 'beta'), folder('fld_a', 'Alpha'), folder('fld_c', 'charlie')]
    expect(inboxProjectSummaries([], named).map((summary) => summary.project.name)).toEqual(['Alpha', 'beta', 'charlie'])
  })
})

describe('the drafts of a project', () => {
  const drafts = [
    draft({ id: 'drf_app', folderId: 'fld_app' }),
    draft({ id: 'drf_web', folderId: 'fld_web' }),
    draft({ id: 'drf_wt', folderId: 'fld_wt' }),
    draft({ id: 'drf_gone', folderId: 'fld_removed' }),
  ]

  it('are all of them with no project picked', () => {
    expect(ids(draftsInProject(drafts, null, folders))).toEqual(['drf_app', 'drf_web', 'drf_wt', 'drf_gone'])
  })

  it('are the ones for it, and for a worktree cut from it', () => {
    expect(ids(draftsInProject(drafts, app, folders))).toEqual(['drf_app', 'drf_wt'])
    expect(ids(draftsInProject(drafts, web, folders))).toEqual(['drf_web'])
  })
})

describe('the project the Inbox is narrowed to, as stored', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('is none until one is picked, and is forgotten when none is picked again', () => {
    expect(getInboxProjectFilter()).toBeNull()
    saveInboxProjectFilter('fld_app')
    expect(localStorage.getItem(INBOX_PROJECT_FILTER_STORAGE_KEY)).toBe('fld_app')
    expect(getInboxProjectFilter()).toBe('fld_app')
    saveInboxProjectFilter(null)
    expect(localStorage.getItem(INBOX_PROJECT_FILTER_STORAGE_KEY)).toBeNull()
    expect(getInboxProjectFilter()).toBeNull()
  })

  it('reads as none, and can still be set for the session, when storage is unreadable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })
    expect(getInboxProjectFilter()).toBeNull()
    expect(() => saveInboxProjectFilter('fld_app')).not.toThrow()
    expect(() => saveInboxProjectFilter(null)).not.toThrow()
    expect(() => useInboxView.getState().setProjectFilter('fld_web')).not.toThrow()
    expect(useInboxView.getState().projectFilter).toBe('fld_web')
  })

  it('is kept by the view store', () => {
    useInboxView.getState().setProjectFilter('fld_web')
    expect(localStorage.getItem(INBOX_PROJECT_FILTER_STORAGE_KEY)).toBe('fld_web')
    useInboxView.getState().setProjectFilter(null)
    expect(localStorage.getItem(INBOX_PROJECT_FILTER_STORAGE_KEY)).toBeNull()
  })
})

describe('the Inbox panel narrowed to a project', () => {
  const now = Date.now()
  const threads = [
    thread({ id: 'ses_app1', title: 'App one', folderId: 'fld_app', lastActivityAt: now - 1 * 60_000 }),
    thread({ id: 'ses_app2', title: 'App unread', folderId: 'fld_app', lastActivityAt: now - 2 * 60_000, readAt: 0 }),
    thread({ id: 'ses_appwork', title: 'App working', folderId: 'fld_app', status: 'working', workingSince: now - 5_000, lastActivityAt: now - 3 * 60_000 }),
    thread({ id: 'ses_appparked', title: 'App parked', folderId: 'fld_app', archived: true, lastActivityAt: now - 4 * 60_000 }),
    thread({
      id: 'ses_appwt', title: 'App in a worktree', folderId: 'fld_wt', directory: '/home/me/app/.mde/wt1',
      worktree: { repository: '/home/me/app', root: '/home/me/app/.mde/wt1', branch: 'mde/wt1', base: 'main' },
      lastActivityAt: now - 5 * 60_000,
    }),
    thread({ id: 'ses_web1', title: 'Web one', folderId: 'fld_web', directory: '/home/me/web', lastActivityAt: now - 6 * 60_000 }),
    thread({ id: 'ses_webwork', title: 'Web working', folderId: 'fld_web', directory: '/home/me/web', status: 'working', workingSince: now - 9_000, lastActivityAt: now - 7 * 60_000 }),
  ]
  const drafts = [
    draft({ id: 'drf_app', folderId: 'fld_app', preview: 'App draft' }),
    draft({ id: 'drf_web', folderId: 'fld_web', preview: 'Web draft' }),
  ]

  let root: Root
  let container: HTMLDivElement
  const loadDrafts = vi.fn(async () => undefined)
  const originalLoad = useInboxDrafts.getState().load
  const q = (testId: string): HTMLElement | null => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  const rowIds = (area: Element | null | undefined): string[] =>
    Array.from(area?.querySelectorAll('[data-testid^="inbox-thread-ses_"]') ?? [])
      .map((row) => row.getAttribute('data-testid')!)
      .filter((id) => !/-(park|cue|fork-mark|project|draft|title-icon)-/.test(id))
      .map((id) => id.replace('inbox-thread-', ''))
  const listIds = (): string[] => rowIds(q('inbox-thread-list'))
  const workingIds = (): string[] => rowIds(q('inbox-working-section'))
  const draftIds = (): string[] =>
    Array.from(container.querySelectorAll('[data-testid^="inbox-draft-drf_"]')).map((row) => row.getAttribute('data-testid')!.replace('inbox-draft-', ''))
  const filter = (): HTMLElement | null => q('inbox-project-filter')
  const render = async (): Promise<void> => { await act(async () => root.render(createElement(InboxPanel))) }
  const openMenu = async (): Promise<void> => {
    await act(async () => { filter()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  }
  const option = (id: string): HTMLElement | null => document.body.querySelector(`[data-testid="inbox-project-option-${id}"]`)
  const choose = async (id: string): Promise<void> => {
    await openMenu()
    await act(async () => option(id)!.click())
  }
  const setFolders = (list: InboxFolder[], loaded = true): void => useInboxChat.setState({ folders: list, foldersLoaded: loaded })

  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('IntersectionObserver', undefined)
    vi.stubGlobal('api', { inbox: { changes: vi.fn(), setRead: vi.fn(), setArchived: vi.fn(), folders: vi.fn() } })
    loadDrafts.mockClear()
    useWorkspace.setState({
      platform: { platform: 'darwin', isWindows: false },
      inboxThreads: threads,
      selectedInboxThreadId: null,
      inboxMarkedUnread: {},
      inboxCues: {},
      activeWorkspaceView: 'inbox',
    })
    useInboxChanges.setState({ entries: {}, selectedPath: null, tab: 'files', sidebarChanges: false })
    useInboxView.setState({ workingSection: false, workingCollapsed: false, draftsCollapsed: false, titleIcons: false, projectFilter: null })
    useInboxDrafts.setState({ drafts, threadDrafts: [], page: { id: 'drf_page', opened: false }, load: loadDrafts })
    setFolders(folders)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    useInboxDrafts.setState({ load: originalLoad })
    vi.unstubAllGlobals()
  })

  it('lists every project in the Inbox until one is picked', async () => {
    await render()

    expect(filter()!.textContent).toContain('All projects')
    expect(filter()!.getAttribute('data-active')).toBeNull()
    expect(q('inbox-project-filter-clear')).toBeNull()
    // Newest first; the parked thread waits under Parked.
    expect(listIds()).toEqual(['ses_app1', 'ses_app2', 'ses_appwork', 'ses_appwt', 'ses_web1', 'ses_webwork'])
    expect(draftIds()).toEqual(['drf_app', 'drf_web'])
  })

  it('is offered once there is a choice to make, and not before', async () => {
    setFolders([app])
    await render()
    expect(filter()).toBeNull()

    await act(async () => setFolders([app, web]))
    expect(filter()).not.toBeNull()

    await act(async () => setFolders([]))
    expect(filter()).toBeNull()
  })

  it('narrows the list, and the drafts, to the project picked, worktree threads included', async () => {
    await render()
    await choose('fld_app')

    expect(listIds()).toEqual(['ses_app1', 'ses_app2', 'ses_appwork', 'ses_appwt'])
    expect(draftIds()).toEqual(['drf_app'])
    expect(filter()!.textContent).toContain('app')
    expect(filter()!.getAttribute('data-active')).toBe('true')
    expect(filter()!.getAttribute('aria-label')).toBe('Project: app')
    expect(q('inbox-project-filter-icon')!.getAttribute('data-icon')).toBe('rocket')
    expect(useInboxView.getState().projectFilter).toBe('fld_app')
    expect(localStorage.getItem(INBOX_PROJECT_FILTER_STORAGE_KEY)).toBe('fld_app')
  })

  it('goes back to all of them from the X, and from "All projects" in the menu', async () => {
    useInboxView.setState({ projectFilter: 'fld_web' })
    await render()
    expect(listIds()).toEqual(['ses_web1', 'ses_webwork'])

    await act(async () => q('inbox-project-filter-clear')!.click())
    expect(listIds()).toHaveLength(6)
    expect(useInboxView.getState().projectFilter).toBeNull()
    expect(localStorage.getItem(INBOX_PROJECT_FILTER_STORAGE_KEY)).toBeNull()

    await choose('fld_web')
    expect(listIds()).toEqual(['ses_web1', 'ses_webwork'])
    await choose('all')
    expect(listIds()).toHaveLength(6)
    expect(filter()!.getAttribute('data-active')).toBeNull()
  })

  it('shows the project with a check, and every project with its threads and how many are unread', async () => {
    useInboxView.setState({ projectFilter: 'fld_app' })
    await render()
    await openMenu()

    const row = (id: string): HTMLElement => option(id)!
    expect(row('fld_app').getAttribute('aria-checked')).toBe('true')
    expect(row('fld_web').getAttribute('aria-checked')).toBe('false')
    expect(row('all').getAttribute('aria-checked')).toBe('false')
    const counts = (id: string): string[] => [
      row(id).querySelector('[data-testid="inbox-project-unread"]')?.textContent ?? '-',
      row(id).querySelector('[data-testid="inbox-project-count"]')!.textContent!,
    ]
    // Parked threads are not counted; the one in the worktree counts for app.
    expect(counts('fld_app')).toEqual(['1', '4'])
    expect(counts('fld_web')).toEqual(['-', '2'])
    expect(counts('all')).toEqual(['1', '6'])
    // Projects come in order of name, after "All projects".
    const order = Array.from(document.body.querySelectorAll('[role="menuitemradio"]')).map((item) => item.getAttribute('data-testid'))
    expect(order).toEqual(['inbox-project-option-all', 'inbox-project-option-fld_app', 'inbox-project-option-fld_web'])
  })

  it('narrows the Working section too, and says so when nothing in the project is working', async () => {
    useInboxView.setState({ workingSection: true })
    await render()
    expect(workingIds()).toEqual(['ses_appwork', 'ses_webwork'])

    await choose('fld_web')
    expect(workingIds()).toEqual(['ses_webwork'])
    expect(listIds()).toEqual(['ses_web1'])

    await act(async () => useWorkspace.setState({ inboxThreads: threads.filter((item) => item.id !== 'ses_webwork') }))
    expect(q('inbox-working-section')!.textContent).toContain('No threads are working in web.')
    expect(q('inbox-thread-list')!.textContent).toContain('Web one')
  })

  it('works with the status tabs and the search', async () => {
    await render()
    await choose('fld_app')

    const tab = (label: string): HTMLElement =>
      Array.from(container.querySelectorAll<HTMLElement>('[aria-label="Inbox filter"] button')).find((item) => item.textContent === label)!
    await act(async () => tab('Unread').click())
    expect(listIds()).toEqual(['ses_app2'])
    await act(async () => tab('Parked').click())
    expect(listIds()).toEqual(['ses_appparked'])

    await act(async () => tab('All').click())
    const search = container.querySelector<HTMLInputElement>('[aria-label="Search inbox"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'working')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(listIds()).toEqual(['ses_appwork'])
  })

  it('says which project has no threads', async () => {
    useInboxView.setState({ projectFilter: 'fld_web' })
    await render()
    await act(async () => useWorkspace.setState({ inboxThreads: threads.filter((item) => !item.id.startsWith('ses_web')) }))

    expect(q('inbox-thread-list')!.textContent).toContain('No threads in web yet.')
    expect(q('inbox-thread-list')!.textContent).toContain('Start one with New thread.')

    const tab = (label: string): HTMLElement =>
      Array.from(container.querySelectorAll<HTMLElement>('[aria-label="Inbox filter"] button')).find((item) => item.textContent === label)!
    await act(async () => tab('Unread').click())
    expect(q('inbox-thread-list')!.textContent).toContain('No unread threads in web.')
    await act(async () => tab('Parked').click())
    expect(q('inbox-thread-list')!.textContent).toContain('No parked threads in web.')
  })

  it('keeps the messages it has with no project picked', async () => {
    await render()
    await act(async () => useWorkspace.setState({ inboxThreads: [] }))
    expect(q('inbox-thread-list')!.textContent).toContain('No threads yet.')
  })

  it('still counts every project in the menu while narrowed to one', async () => {
    await render()
    await choose('fld_web')
    // Only app has an unread thread, and it is out of view; "All projects" still counts it.
    expect(listIds()).toEqual(['ses_web1', 'ses_webwork'])
    await openMenu()
    expect(option('all')!.querySelector('[data-testid="inbox-project-unread"]')!.textContent).toBe('1')
  })

  describe('a stored project that is gone', () => {
    it('is not applied, and not forgotten, until the projects have been read', async () => {
      useInboxView.setState({ projectFilter: 'fld_web' })
      setFolders([], false)
      await render()

      expect(listIds()).toHaveLength(6)
      expect(useInboxView.getState().projectFilter).toBe('fld_web')

      await act(async () => setFolders([app, web]))
      expect(listIds()).toEqual(['ses_web1', 'ses_webwork'])
      expect(useInboxView.getState().projectFilter).toBe('fld_web')
    })

    it('narrows nothing and is forgotten once the projects are known', async () => {
      localStorage.setItem(INBOX_PROJECT_FILTER_STORAGE_KEY, 'fld_removed')
      useInboxView.setState({ projectFilter: 'fld_removed' })
      await render()

      expect(listIds()).toHaveLength(6)
      expect(filter()!.textContent).toContain('All projects')
      expect(useInboxView.getState().projectFilter).toBeNull()
      expect(localStorage.getItem(INBOX_PROJECT_FILTER_STORAGE_KEY)).toBeNull()
    })

    it('is forgotten when the project being narrowed to is removed, and the filter goes with the last choice', async () => {
      useInboxView.setState({ projectFilter: 'fld_web' })
      await render()
      expect(listIds()).toEqual(['ses_web1', 'ses_webwork'])

      await act(async () => setFolders([app]))
      expect(useInboxView.getState().projectFilter).toBeNull()
      expect(listIds()).toHaveLength(6)
      expect(filter()).toBeNull()
    })

    it('does not count a worktree folder as a project to narrow to', async () => {
      useInboxView.setState({ projectFilter: 'fld_wt' })
      await render()

      expect(useInboxView.getState().projectFilter).toBeNull()
      expect(listIds()).toHaveLength(6)
    })
  })
})
