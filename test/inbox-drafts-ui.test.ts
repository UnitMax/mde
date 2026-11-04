// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InboxPanel } from '../src/renderer/components/InboxPanel'
import {
  getInboxDraftsCollapsed,
  INBOX_DRAFTS_COLLAPSED_STORAGE_KEY,
  saveInboxDraftsCollapsed,
} from '../src/renderer/lib/inbox-settings'
import { draftFolderLabel, draftTitle, newDraftId, visibleDrafts } from '../src/renderer/lib/inbox-drafts'
import { useInboxChanges } from '../src/renderer/store/inbox-changes'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useInboxDrafts } from '../src/renderer/store/inbox-drafts'
import { useInboxView } from '../src/renderer/store/inbox-view'
import { useWorkspace } from '../src/renderer/store/workspace'
import type { ChatDraftRequest, ChatDraftSummary, InboxFolder, InboxThread } from '../src/shared/types'

const minutes = (count: number): number => Date.now() - count * 60_000

function folder(id: string, name: string): InboxFolder {
  return {
    id, name, directory: `/home/me/${name}`, target: { kind: 'native' }, createdAt: 1, lastActivityAt: 1, lastUsedAt: 1,
  } as InboxFolder
}

function summary(overrides: Partial<ChatDraftSummary> = {}): ChatDraftSummary {
  return { id: 'drf_one', folderId: 'fld_app', preview: 'Add a dark theme', attachments: 0, updatedAt: minutes(5), ...overrides }
}

function thread(overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id: 'ses_one', title: 'Fix login', directory: '/home/me/app', target: { kind: 'native' }, branch: 'main', folderId: 'fld_app',
    createdAt: 1, lastActivityAt: minutes(5), readAt: Date.now(), archived: false, status: 'completed',
    ...overrides,
  }
}

const app = folder('fld_app', 'app')
const docs = folder('fld_docs', 'docs')

describe('Inbox draft rows', () => {
  it('are called by the first line that says something, or by their files', () => {
    expect(draftTitle(summary({ preview: '\n   \n  Add   a dark\ttheme  \nand more' }))).toBe('Add a dark theme')
    expect(draftTitle(summary({ preview: '', attachments: 1, attachmentName: 'screen.png' }))).toBe('screen.png')
    expect(draftTitle(summary({ preview: ' ', attachments: 3, attachmentName: 'screen.png' }))).toBe('screen.png and 2 more')
    expect(draftTitle(summary({ preview: '', attachments: 0 }))).toBe('Empty draft')
  })

  it('name their folder, or say it is gone', () => {
    expect(draftFolderLabel(summary(), [app, docs])).toBe('app')
    expect(draftFolderLabel(summary({ folderId: 'fld_docs' }), [app, docs])).toBe('docs')
    expect(draftFolderLabel(summary({ folderId: 'fld_gone' }), [app, docs])).toBe('Removed folder')
  })

  it('leave out the hidden one, and are searched by text, file and folder', () => {
    const drafts = [
      summary({ id: 'drf_a', preview: 'Add a dark theme' }),
      summary({ id: 'drf_b', preview: '', attachments: 1, attachmentName: 'mockup.png', folderId: 'fld_docs' }),
      summary({ id: 'drf_c', preview: 'Rewrite the parser', folderId: 'fld_docs' }),
    ]
    const ids = (list: ChatDraftSummary[]): string[] => list.map((draft) => draft.id)
    expect(ids(visibleDrafts(drafts, null, [app, docs]))).toEqual(['drf_a', 'drf_b', 'drf_c'])
    expect(ids(visibleDrafts(drafts, 'drf_b', [app, docs]))).toEqual(['drf_a', 'drf_c'])
    expect(ids(visibleDrafts(drafts, null, [app, docs], 'dark'))).toEqual(['drf_a'])
    expect(ids(visibleDrafts(drafts, null, [app, docs], 'mockup'))).toEqual(['drf_b'])
    expect(ids(visibleDrafts(drafts, null, [app, docs], 'docs'))).toEqual(['drf_b', 'drf_c'])
    expect(ids(visibleDrafts(drafts, null, [app, docs], 'docs parser'))).toEqual(['drf_c'])
    expect(ids(visibleDrafts(drafts, 'drf_c', [app, docs], 'docs'))).toEqual(['drf_b'])
    expect(visibleDrafts(drafts, null, [app, docs], 'zebra')).toEqual([])
  })

  it('get ids the main process accepts', () => {
    expect(newDraftId()).toMatch(/^drf_[A-Za-z0-9-]{1,64}$/)
    expect(newDraftId()).not.toBe(newDraftId())
  })
})

describe('Inbox draft preference', () => {
  beforeEach(() => localStorage.clear())

  it('is open until the section was folded, and open when storage cannot be read', () => {
    expect(getInboxDraftsCollapsed()).toBe(false)
    saveInboxDraftsCollapsed(true)
    expect(localStorage.getItem(INBOX_DRAFTS_COLLAPSED_STORAGE_KEY)).toBe('on')
    expect(getInboxDraftsCollapsed()).toBe(true)
    saveInboxDraftsCollapsed(false)
    expect(getInboxDraftsCollapsed()).toBe(false)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(getInboxDraftsCollapsed()).toBe(false)
    vi.restoreAllMocks()
  })
})

describe('Inbox Drafts section', () => {
  let root: Root
  let container: HTMLDivElement
  let stored: ChatDraftSummary[]
  /** The threads with an unsent message in their box. */
  let storedThreads: string[]
  const drafts = vi.fn(async () => ({ drafts: stored.map((draft) => ({ ...draft })), threads: [...storedThreads] }))
  const draft = vi.fn(async (request: ChatDraftRequest) => {
    if (request.action === 'clear') stored = stored.filter((entry) => `draft:${entry.id}` !== request.key)
    return { text: '', revision: 0, attachments: [] }
  })
  const setComposer = vi.fn(async (composer: unknown) => composer)
  const setArchived = vi.fn(async () => null)

  const q = (testId: string): HTMLElement | null => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  const section = (): HTMLElement | null => q('inbox-drafts-section')
  const rowIds = (): string[] =>
    Array.from(section()?.querySelectorAll('[data-testid^="inbox-draft-drf_"]') ?? [])
      .map((row) => row.getAttribute('data-testid')!.replace('inbox-draft-', ''))
  const dialog = (): HTMLElement | null => document.body.querySelector('[role="alertdialog"]')
  const render = async (): Promise<void> => { await act(async () => root.render(createElement(InboxPanel))) }
  const settle = async (): Promise<void> => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }) }
  const type = async (value: string): Promise<void> => {
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Search inbox"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const pageDraft = (): { id: string; opened: boolean; folderId?: string } => useInboxDrafts.getState().page

  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('IntersectionObserver', undefined)
    vi.stubGlobal('api', {
      inbox: { changes: vi.fn(), setRead: vi.fn(async () => null), setArchived, remove: vi.fn(), folders: vi.fn(), setComposer },
      chat: { drafts, draft },
    })
    for (const mock of [drafts, draft, setComposer, setArchived]) mock.mockClear()
    stored = []
    storedThreads = []
    useWorkspace.setState({
      platform: { platform: 'darwin', isWindows: false },
      inboxThreads: [thread()],
      selectedInboxThreadId: 'ses_one',
      inboxMarkedUnread: {},
      inboxCues: {},
      activeWorkspaceView: 'inbox',
    })
    useInboxChanges.setState({ entries: {}, selectedPath: null, tab: 'files', sidebarChanges: false })
    useInboxChat.setState({ folders: [app, docs], composer: { folderId: 'fld_app' }, foldersLoaded: true })
    useInboxView.setState({ workingSection: false, workingCollapsed: false, draftsCollapsed: false })
    useInboxDrafts.setState({ drafts: [], page: { id: 'drf_page', opened: false } })
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

  it('is not there while there are no drafts, and is read when the panel opens', async () => {
    await render()
    await settle()
    expect(drafts).toHaveBeenCalled()
    expect(section()).toBeNull()
    expect(container.textContent).not.toContain('Drafts')
  })

  it('appears above Working once there are drafts, counting them', async () => {
    stored = [summary({ id: 'drf_one' }), summary({ id: 'drf_two', preview: 'Rewrite the parser' })]
    useInboxView.setState({ workingSection: true })
    await render()
    await settle()
    expect(section()).not.toBeNull()
    expect(q('inbox-drafts-count')?.textContent).toBe('2')
    expect(q('inbox-drafts-toggle')?.textContent).toContain('Drafts')
    const working = q('inbox-working-section')!
    expect(section()!.compareDocumentPosition(working) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Below the thread list, which keeps the threads.
    const list = q('inbox-thread-list')!
    expect(list.compareDocumentPosition(section()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(list.querySelector('[data-testid^="inbox-draft-"]')).toBeNull()
  })

  it('lists each draft with what it says, where it is for, how old it is and how many files it has', async () => {
    stored = [
      summary({ id: 'drf_one', preview: '\nAdd a dark theme\nwith a toggle', updatedAt: minutes(5) }),
      summary({ id: 'drf_two', preview: '', attachments: 2, attachmentName: 'mockup.png', folderId: 'fld_docs', updatedAt: minutes(125) }),
      summary({ id: 'drf_three', preview: 'Orphan', folderId: 'fld_gone', updatedAt: minutes(3000) }),
    ]
    await render()
    await settle()
    expect(rowIds()).toEqual(['drf_one', 'drf_two', 'drf_three'])
    const text = (id: string): string => q(`inbox-draft-${id}`)!.textContent!
    expect(text('drf_one')).toContain('Add a dark theme')
    expect(text('drf_one')).not.toContain('with a toggle')
    expect(text('drf_one')).toContain('app')
    expect(text('drf_one')).toContain('5m ago')
    expect(text('drf_two')).toContain('mockup.png and 1 more')
    expect(text('drf_two')).toContain('docs')
    expect(text('drf_two')).toContain('2h ago')
    expect(text('drf_two')).toContain('2')
    expect(text('drf_three')).toContain('Removed folder')
    expect(text('drf_three')).toContain('2d ago')
  })

  it('says Delete draft where a thread says Park, and a thread still says Park', async () => {
    stored = [summary()]
    await render()
    await settle()
    const button = q('inbox-draft-delete-drf_one')!
    expect(button.getAttribute('aria-label')).toBe('Delete draft')
    expect(button.getAttribute('title')).toBe('Delete draft')
    expect(button.textContent).toBe('Delete draft')
    // Revealed by hovering or focusing the row, like the thread's own action.
    expect(button.className).toContain('group-hover:opacity-100')
    expect(button.className).toContain('group-focus-within:opacity-100')
    expect(section()!.textContent).not.toContain('Park')
    expect(section()!.querySelector('[data-testid^="inbox-thread-park-"]')).toBeNull()
    expect(q('inbox-thread-park-ses_one')?.textContent).toBe('Park')
  })

  it('deletes a draft after asking, and takes the section away with the last one', async () => {
    stored = [summary({ id: 'drf_one' }), summary({ id: 'drf_two', preview: 'Rewrite the parser' })]
    await render()
    await settle()
    await act(async () => q('inbox-draft-delete-drf_one')!.click())
    expect(dialog()).not.toBeNull()
    expect(dialog()!.textContent).toContain('Add a dark theme')
    expect(draft).not.toHaveBeenCalled()
    // Cancelling leaves it.
    await act(async () => Array.from(dialog()!.querySelectorAll('button')).find((entry) => entry.textContent === 'Cancel')!.click())
    expect(dialog()).toBeNull()
    expect(draft).not.toHaveBeenCalled()
    expect(rowIds()).toEqual(['drf_one', 'drf_two'])
    // Confirming deletes that one only.
    await act(async () => q('inbox-draft-delete-drf_one')!.click())
    await act(async () => document.body.querySelector<HTMLElement>('[data-testid="inbox-draft-confirm-delete"]')!.click())
    await vi.waitFor(() => expect(rowIds()).toEqual(['drf_two']))
    expect(draft).toHaveBeenCalledWith({ key: 'draft:drf_one', action: 'clear' })
    expect(dialog()).toBeNull()
    expect(q('inbox-drafts-count')?.textContent).toBe('1')
    await act(async () => q('inbox-draft-delete-drf_two')!.click())
    await act(async () => document.body.querySelector<HTMLElement>('[data-testid="inbox-draft-confirm-delete"]')!.click())
    await vi.waitFor(() => expect(section()).toBeNull())
  })

  it('keeps the draft and says why when it cannot be deleted, and lets it be tried again', async () => {
    stored = [summary()]
    draft.mockRejectedValueOnce(new Error('Draft storage is unavailable.'))
    await render()
    await settle()
    await act(async () => q('inbox-draft-delete-drf_one')!.click())
    const confirm = (): HTMLElement => document.body.querySelector<HTMLElement>('[data-testid="inbox-draft-confirm-delete"]')!
    await act(async () => confirm().click())
    await vi.waitFor(() => expect(dialog()!.textContent).toContain('Draft storage is unavailable.'))
    expect(rowIds()).toEqual(['drf_one'])
    await act(async () => confirm().click())
    await vi.waitFor(() => expect(section()).toBeNull())
  })

  it('opens a draft on the new-thread page, in its folder, and marks it as the open one', async () => {
    stored = [summary({ id: 'drf_one' }), summary({ id: 'drf_two', folderId: 'fld_docs', preview: 'Rewrite the parser' })]
    await render()
    await settle()
    expect(q('inbox-new-thread-button')!.getAttribute('aria-current')).toBeNull()
    await act(async () => q('inbox-draft-drf_two')!.click())
    expect(useWorkspace.getState().selectedInboxThreadId).toBeNull()
    expect(pageDraft()).toEqual({ id: 'drf_two', opened: true, folderId: 'fld_docs' })
    expect(useInboxChat.getState().composer.folderId).toBe('fld_docs')
    expect(setComposer).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'fld_docs' }))
    // It stays in the list, as the current one; New thread is not.
    expect(rowIds()).toEqual(['drf_one', 'drf_two'])
    expect(q('inbox-draft-drf_two')!.getAttribute('aria-current')).toBe('true')
    expect(q('inbox-draft-drf_one')!.getAttribute('aria-current')).toBeNull()
    expect(q('inbox-new-thread-button')!.getAttribute('aria-current')).toBeNull()
  })

  it('opens a draft whose folder is gone without changing the folder the page shows', async () => {
    stored = [summary({ folderId: 'fld_gone' })]
    await render()
    await settle()
    await act(async () => q('inbox-draft-drf_one')!.click())
    expect(pageDraft()).toEqual({ id: 'drf_one', opened: true, folderId: 'fld_gone' })
    expect(useInboxChat.getState().composer.folderId).toBe('fld_app')
    expect(setComposer).not.toHaveBeenCalled()
  })

  it('opens a draft from a thread, and a thread from a draft, each leaving the other', async () => {
    stored = [summary()]
    await render()
    await settle()
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_one')
    await act(async () => q('inbox-draft-drf_one')!.click())
    expect(q('inbox-thread-ses_one')!.getAttribute('aria-current')).toBeNull()
    await act(async () => q('inbox-thread-ses_one')!.click())
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_one')
    // No page is showing it now, so it is just a draft in the list.
    expect(q('inbox-draft-drf_one')!.getAttribute('aria-current')).toBeNull()
  })

  it('keeps the blank page’s own draft out of the list until the page is left', async () => {
    stored = [summary({ id: 'drf_page', preview: 'Half a thought' }), summary({ id: 'drf_old', preview: 'Earlier' })]
    useWorkspace.setState({ selectedInboxThreadId: null })
    await render()
    await settle()
    expect(rowIds()).toEqual(['drf_old'])
    expect(q('inbox-drafts-count')?.textContent).toBe('1')
    expect(q('inbox-new-thread-button')!.getAttribute('aria-current')).toBe('true')
    // Opening a thread leaves the page; what was typed there is a draft now.
    await act(async () => { useWorkspace.setState({ selectedInboxThreadId: 'ses_one' }) })
    expect(rowIds()).toEqual(['drf_page', 'drf_old'])
  })

  it('has no section for a page whose draft is the only one, until it is left', async () => {
    stored = [summary({ id: 'drf_page' })]
    useWorkspace.setState({ selectedInboxThreadId: null })
    await render()
    await settle()
    expect(section()).toBeNull()
    await act(async () => { useWorkspace.setState({ selectedInboxThreadId: 'ses_one' }) })
    expect(rowIds()).toEqual(['drf_page'])
  })

  it('sets aside what is typed on the page when New thread is chosen there, and starts blank', async () => {
    stored = [summary({ id: 'drf_page', preview: 'Half a thought' })]
    useWorkspace.setState({ selectedInboxThreadId: null })
    await render()
    await settle()
    expect(section()).toBeNull()
    await act(async () => q('inbox-new-thread-button')!.click())
    await vi.waitFor(() => expect(pageDraft().id).not.toBe('drf_page'))
    expect(pageDraft().opened).toBe(false)
    expect(rowIds()).toEqual(['drf_page'])
    expect(q('inbox-new-thread-button')!.getAttribute('aria-current')).toBe('true')
  })

  it('does nothing on a blank page when New thread is chosen there', async () => {
    stored = [summary({ id: 'drf_old' })]
    useWorkspace.setState({ selectedInboxThreadId: null })
    await render()
    await settle()
    await act(async () => q('inbox-new-thread-button')!.click())
    await settle()
    expect(pageDraft()).toEqual({ id: 'drf_page', opened: false })
    expect(rowIds()).toEqual(['drf_old'])
  })

  it('sets aside the open draft too, and keeps it in the list for later', async () => {
    stored = [summary({ id: 'drf_one' })]
    await render()
    await settle()
    await act(async () => q('inbox-draft-drf_one')!.click())
    await act(async () => q('inbox-new-thread-button')!.click())
    await vi.waitFor(() => expect(pageDraft().id).not.toBe('drf_one'))
    expect(pageDraft().opened).toBe(false)
    expect(rowIds()).toEqual(['drf_one'])
    expect(q('inbox-draft-drf_one')!.getAttribute('aria-current')).toBeNull()
  })

  it('opens the blank page when New thread is chosen from a thread', async () => {
    stored = [summary()]
    await render()
    await settle()
    await act(async () => q('inbox-new-thread-button')!.click())
    expect(useWorkspace.getState().selectedInboxThreadId).toBeNull()
    expect(pageDraft()).toEqual({ id: 'drf_page', opened: false })
  })

  it('goes with a deleted draft that is open, and leaves a blank page', async () => {
    stored = [summary({ id: 'drf_one' })]
    await render()
    await settle()
    await act(async () => q('inbox-draft-drf_one')!.click())
    await act(async () => q('inbox-draft-delete-drf_one')!.click())
    await act(async () => document.body.querySelector<HTMLElement>('[data-testid="inbox-draft-confirm-delete"]')!.click())
    await vi.waitFor(() => expect(section()).toBeNull())
    expect(pageDraft().id).not.toBe('drf_one')
    expect(pageDraft().opened).toBe(false)
    expect(q('inbox-new-thread-button')!.getAttribute('aria-current')).toBe('true')
  })

  it('is searched with the list, and ignores the filter tabs', async () => {
    stored = [
      summary({ id: 'drf_one', preview: 'Add a dark theme' }),
      summary({ id: 'drf_two', preview: 'Rewrite the parser', folderId: 'fld_docs' }),
    ]
    await render()
    await settle()
    await act(async () => Array.from(container.querySelectorAll<HTMLElement>('[aria-pressed]')).find((tab) => tab.textContent === 'Unread')!.click())
    expect(rowIds()).toEqual(['drf_one', 'drf_two'])
    await type('parser')
    expect(rowIds()).toEqual(['drf_two'])
    expect(q('inbox-drafts-count')?.textContent).toBe('1')
    await type('docs')
    expect(rowIds()).toEqual(['drf_two'])
    await type('zebra')
    expect(rowIds()).toEqual([])
    // The section stays, since there are drafts, and says none match.
    expect(q('inbox-drafts-list')!.textContent).toBe('No drafts match your search.')
    expect(q('inbox-drafts-count')?.textContent).toBe('0')
    await type('')
    expect(rowIds()).toEqual(['drf_one', 'drf_two'])
  })

  it('folds up to its header and its count, and comes back folded', async () => {
    stored = [summary()]
    await render()
    await settle()
    const toggle = q('inbox-drafts-toggle')!
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(q('inbox-drafts-list')).toBeNull()
    expect(q('inbox-drafts-count')?.textContent).toBe('1')
    expect(localStorage.getItem(INBOX_DRAFTS_COLLAPSED_STORAGE_KEY)).toBe('on')
    await act(async () => toggle.click())
    expect(q('inbox-drafts-list')).not.toBeNull()
    expect(localStorage.getItem(INBOX_DRAFTS_COLLAPSED_STORAGE_KEY)).toBe('off')
  })

  it('keeps its own fold apart from Working’s', async () => {
    stored = [summary()]
    useInboxView.setState({ workingSection: true })
    await render()
    await settle()
    await act(async () => q('inbox-drafts-toggle')!.click())
    expect(q('inbox-drafts-list')).toBeNull()
    expect(q('inbox-working-list')).not.toBeNull()
  })

  it('reads the list again after a failure to read it, keeping what is on screen', async () => {
    stored = [summary()]
    await render()
    await settle()
    drafts.mockRejectedValueOnce(new Error('gone'))
    await act(async () => { await useInboxDrafts.getState().load() })
    expect(rowIds()).toEqual(['drf_one'])
  })

  it('drops an answer that arrives after a newer one', async () => {
    let release: (value: { drafts: ChatDraftSummary[]; threads: string[] }) => void = () => {}
    drafts.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const first = useInboxDrafts.getState().load()
    stored = [summary({ id: 'drf_new' })]
    await useInboxDrafts.getState().load()
    release({ drafts: [summary({ id: 'drf_stale' })], threads: ['ses_stale'] })
    await first
    expect(useInboxDrafts.getState().drafts.map((entry) => entry.id)).toEqual(['drf_new'])
    expect(useInboxDrafts.getState().threadDrafts).toEqual([])
  })

  it('marks a worktree draft with where it would start, and no other', async () => {
    stored = [
      summary({ id: 'drf_tree', choice: { agent: 'build', model: { id: 'free-1', providerId: 'opencode' }, worktree: { base: 'origin/main' } } }),
      summary({ id: 'drf_plain', choice: { agent: 'build', model: { id: 'free-1', providerId: 'opencode' } } }),
      summary({ id: 'drf_old' }),
    ]
    await render()
    await settle()
    const hint = q('inbox-draft-worktree-drf_tree')
    expect(hint).not.toBeNull()
    expect(hint!.getAttribute('title')).toBe('Starts in a new worktree cut from origin/main')
    expect(hint!.textContent).toBe('New worktree')
    expect(hint!.closest('[data-testid="inbox-draft-drf_tree"]')).not.toBeNull()
    expect(q('inbox-draft-worktree-drf_plain')).toBeNull()
    expect(q('inbox-draft-worktree-drf_old')).toBeNull()
  })

  describe('marking threads with an unsent message', () => {
    const second = (): InboxThread => thread({ id: 'ses_two', title: 'Add dark theme', lastActivityAt: minutes(9) })
    const mark = (id: string): HTMLElement | null => q(`inbox-thread-draft-${id}`)

    it('puts a Draft mark on a thread that is not open, and none on one that is', async () => {
      useWorkspace.setState({ inboxThreads: [thread(), second()], selectedInboxThreadId: 'ses_one' })
      storedThreads = ['ses_one', 'ses_two']
      await render()
      await settle()
      expect(mark('ses_two')?.textContent).toBe('Draft')
      expect(mark('ses_two')?.closest('[data-testid="inbox-thread-ses_two"]')).not.toBeNull()
      // Its box is in front of the person, who sees the text there.
      expect(mark('ses_one')).toBeNull()
    })

    it('moves with the open thread, once the list has been read again', async () => {
      useWorkspace.setState({ inboxThreads: [thread(), second()], selectedInboxThreadId: 'ses_one' })
      storedThreads = ['ses_two']
      await render()
      await settle()
      expect(mark('ses_two')).not.toBeNull()
      drafts.mockClear()
      // Leaving ses_one with a message in it, and opening ses_two.
      storedThreads = ['ses_one']
      await act(async () => useWorkspace.getState().selectInboxThread('ses_two'))
      await settle()
      expect(drafts).toHaveBeenCalled()
      expect(mark('ses_two')).toBeNull()
      expect(mark('ses_one')?.textContent).toBe('Draft')
    })

    it('shows on a row that has no model or status to show, and is gone once the box is empty', async () => {
      // Neither a model nor a status chip: the row would have had only two lines.
      useWorkspace.setState({ inboxThreads: [thread(), { ...second(), status: 'idle' }], selectedInboxThreadId: 'ses_one' })
      storedThreads = ['ses_two']
      await render()
      await settle()
      expect(mark('ses_two')).not.toBeNull()
      storedThreads = []
      await act(async () => useInboxDrafts.getState().load())
      expect(mark('ses_two')).toBeNull()
    })

    it('is not on a thread the list names that is not in the sidebar, and not where the answer has no thread list', async () => {
      useWorkspace.setState({ inboxThreads: [thread(), second()], selectedInboxThreadId: 'ses_one' })
      storedThreads = ['ses_gone']
      await render()
      await settle()
      expect(container.querySelectorAll('[data-testid^="inbox-thread-draft-"]')).toHaveLength(0)
      // An answer from a build that does not know the marks leaves none.
      drafts.mockImplementationOnce(async () => ({ drafts: [] }) as unknown as { drafts: ChatDraftSummary[]; threads: string[] })
      await act(async () => useInboxDrafts.getState().load())
      expect(useInboxDrafts.getState().threadDrafts).toEqual([])
      expect(container.querySelectorAll('[data-testid^="inbox-thread-draft-"]')).toHaveLength(0)
    })

    it('does not cover the Park button or the status of the row', async () => {
      useWorkspace.setState({ inboxThreads: [thread(), second()], selectedInboxThreadId: 'ses_one' })
      storedThreads = ['ses_two']
      await render()
      await settle()
      expect(q('inbox-thread-park-ses_two')).not.toBeNull()
      expect(q('inbox-thread-ses_two')!.textContent).toContain('Add dark theme')
    })
  })

  it('works where the build has no draft list, with no section', async () => {
    vi.stubGlobal('api', { inbox: { changes: vi.fn(), setRead: vi.fn(async () => null), setArchived, remove: vi.fn(), folders: vi.fn() } })
    await render()
    await settle()
    expect(section()).toBeNull()
    expect(q('inbox-new-thread-button')).not.toBeNull()
  })
})
