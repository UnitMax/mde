// @vitest-environment happy-dom
import { act, createElement, Fragment } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/renderer/components/inbox/InboxTerminal', () => ({
  InboxTerminal: () => createElement('div'),
  focusInboxTerminalWhenShown: vi.fn(),
}))
import { commitBodyParagraphs, fitRefChips, GitGraphView, refChipWidth, refChips } from '../src/renderer/components/inbox/GitGraphView'
import { InboxSidebar } from '../src/renderer/components/inbox/InboxChanges'
import { useInboxChanges } from '../src/renderer/store/inbox-changes'
import { useWorkspace } from '../src/renderer/store/workspace'
import type { DirectoryContext, InboxChangesResponse, InboxGitCommitDetails, InboxGitGraph, InboxThread } from '../src/shared/types'

const h = (seed: string): string => seed.repeat(40).slice(0, 40)
const thread: InboxThread = { id: 'ses_one', title: 'Fix', directory: '/home/me/app', target: { kind: 'native' }, branch: 'main', folderId: 'fld_app', createdAt: 1, lastActivityAt: 1, readAt: 0, archived: false, status: 'completed' }
const session: DirectoryContext = { id: thread.id, name: 'app', path: thread.directory, kind: 'native', createdAt: '' }
const graph: InboxGitGraph = {
  available: true, worktree: '/home/me/app', head: h('c'), branch: 'main',
  upstream: { name: 'origin/main', ahead: 1, behind: 2 }, remotes: ['origin'],
  refs: [
    { hash: h('c'), name: 'main', kind: 'branch' },
    { hash: h('b'), name: 'origin/main', kind: 'remote' },
    { hash: h('d'), name: 'feature', kind: 'branch' },
    { hash: h('a'), name: 'v1', kind: 'tag' },
  ],
  commits: [
    { hash: h('d'), parents: [h('a')], author: 'Bo', time: 1_700_000_300, subject: 'Feature work' },
    { hash: h('c'), parents: [h('b')], author: 'Ada', time: 1_700_000_200, subject: 'Local work' },
    { hash: h('b'), parents: [h('a')], author: 'Ada', time: 1_700_000_100, subject: 'Shared work' },
    { hash: h('a'), parents: [], author: 'Ada', time: 1_700_000_000, subject: 'First' },
  ],
  more: false,
}
const details: InboxGitCommitDetails = {
  hash: h('b'), parents: [h('a')], author: 'Ada', authorTime: 1_700_000_100, committer: 'Ada', commitTime: 1_700_000_100,
  message: 'Shared work\n\nWhy it was done.', files: [{ path: 'src/a.ts', status: 'modified', additions: 3, deletions: 1, binary: false }], truncated: false,
}
const changes: InboxChangesResponse = { available: true, branch: 'main', worktree: '/home/me/app', additions: 4, deletions: 1, fileCount: 2, files: [{ path: 'src/a.ts', status: 'modified', additions: 3, deletions: 1 }, { path: 'new.ts', status: 'untracked', additions: 1, deletions: 0 }] }

const gitGraph = vi.fn(async (): Promise<InboxGitGraph> => graph)
const gitCommit = vi.fn(async (): Promise<InboxGitCommitDetails> => details)
const gitFetch = vi.fn(async () => ({ remotes: ['origin'] }))
const commitDiff = vi.fn(async () => ({ path: 'src/a.ts', diff: '@@ -1 +1,2 @@\n-old\n+new\n+more', binary: false, truncated: false }))
let root: Root
let container: HTMLDivElement

const view = (): HTMLElement | null => container.querySelector('[data-testid="git-graph-view"]')
const rows = (): HTMLElement[] => Array.from(container.querySelectorAll<HTMLElement>('[data-testid="git-graph-row"]'))
const row = (hash: string): HTMLElement => container.querySelector<HTMLElement>(`[data-testid="git-graph-row"][data-hash="${hash}"]`)!
const click = (element: Element | null): Promise<void> => act(async () => { (element as HTMLElement).click() })
const render = (): Promise<void> => act(async () => {
  root.render(createElement(Fragment, null,
    createElement(InboxSidebar, { session, threadId: thread.id }),
    createElement(GitGraphView, { threadId: thread.id })))
})

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.stubGlobal('api', {
    inbox: { changes: vi.fn(async () => changes), changeDiff: vi.fn(), setRead: vi.fn(async () => null) },
    git: { graph: gitGraph, commit: gitCommit, fetch: gitFetch, commitDiff },
    files: { list: vi.fn(async ({ path }: { path: string }) => ({ path, truncated: false, entries: [] })) },
    clipboard: { writeText: vi.fn(async () => undefined) },
  })
  gitGraph.mockReset().mockResolvedValue(graph)
  gitCommit.mockReset().mockResolvedValue(details)
  gitFetch.mockReset().mockResolvedValue({ remotes: ['origin'] })
  try { localStorage.clear() } catch { /* not needed */ }
  useWorkspace.setState({ inboxThreads: [thread], selectedInboxThreadId: thread.id, activeWorkspaceView: 'inbox', fileTreeCollapsed: false, openFiles: {} })
  useInboxChanges.setState({ entries: {}, selectedPath: null, graphThreadId: null, graphReturn: null, tab: 'changes' })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('Git graph view', () => {
  it('opens from the Changes tab and shows the commits, refs, HEAD and upstream', async () => {
    await render()
    expect(view()).toBeNull()
    const button = container.querySelector('[data-testid="inbox-git-graph-button"]')!
    expect(button.getAttribute('aria-pressed')).toBe('false')
    await click(button)
    expect(view()).not.toBeNull()
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(gitGraph).toHaveBeenCalledWith({ threadId: thread.id, limit: 400, scope: 'all', threads: true })
    // The uncommitted changes sit above HEAD, then every commit.
    expect(rows().map((r) => r.dataset.hash)).toEqual(['working-tree', h('d'), h('c'), h('b'), h('a')])
    expect(row('working-tree').textContent).toContain('Uncommitted changes · 2 files')
    expect(row(h('c')).dataset.head).toBe('true')
    const current = row(h('c')).querySelector('[data-testid="git-graph-ref"][data-current]')
    expect(current?.textContent).toBe('main')
    expect(row(h('b')).querySelector('[data-kind="remote"]')?.textContent).toBe('origin/main')
    expect(row(h('a')).querySelector('[data-kind="tag"]')?.textContent).toBe('v1')
    const head = container.querySelector('[data-testid="git-graph-head"]')!
    expect(head.textContent).toContain('main')
    expect(head.querySelector('[aria-label="1 ahead"]')).not.toBeNull()
    expect(head.querySelector('[aria-label="2 behind"]')).not.toBeNull()
    expect(head.textContent).toContain('origin/main')
    // The same button closes it again.
    await click(button)
    expect(view()).toBeNull()
  })

  it('shows a commit with its message and files when it is chosen, and goes to its parent', async () => {
    useInboxChanges.getState().openGraph(thread.id)
    await render()
    await click(row(h('b')))
    const panel = container.querySelector('[data-testid="git-graph-details"]')!
    expect(gitCommit).toHaveBeenCalledWith({ threadId: thread.id, hash: h('b') })
    expect(panel.textContent).toContain('Shared work')
    expect(panel.textContent).toContain('Why it was done.')
    expect(panel.querySelector('[data-testid="git-graph-files"]')?.textContent).toContain('a.ts')
    await click(Array.from(panel.querySelectorAll('button')).find((b) => b.textContent === h('a').slice(0, 7))!)
    expect(row(h('a')).getAttribute('aria-selected')).toBe('true')
    // Escape closes the details first, then the graph.
    await act(async () => { view()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(container.querySelector('[data-testid="git-graph-details"]')).toBeNull()
    await act(async () => { view()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(view()).toBeNull()
  })

  it('lists the uncommitted changes beside the graph, and comes back to it from a diff', async () => {
    useInboxChanges.getState().openGraph(thread.id)
    await render()
    await click(row('working-tree'))
    expect(view()).not.toBeNull()
    expect(row('working-tree').getAttribute('aria-selected')).toBe('true')
    const files = (): HTMLElement[] => Array.from(container.querySelectorAll<HTMLElement>('[data-testid="git-graph-working-file"]'))
    expect(files().map((f) => f.title)).toEqual(['src/a.ts', 'new.ts'])
    await click(files()[0]!)
    expect(view()).toBeNull()
    expect(useInboxChanges.getState().selectedPath).toEqual({ threadId: thread.id, path: 'src/a.ts' })
    // Closing the review (its close button or Escape) returns to the graph, still on that row.
    await act(async () => useInboxChanges.getState().closeFile(true))
    expect(view()).not.toBeNull()
    expect(row('working-tree').getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('[data-testid="git-graph-working"]')).not.toBeNull()
  })

  it('does not come back to the graph when a review opened elsewhere closes', async () => {
    await render()
    await act(async () => useInboxChanges.getState().openFile(thread.id, 'src/a.ts'))
    await act(async () => useInboxChanges.getState().closeFile(true))
    expect(view()).toBeNull()
  })

  it('reviews a file of a commit over the graph, and keeps the commit chosen after', async () => {
    useInboxChanges.getState().openGraph(thread.id)
    await render()
    await click(row(h('b')))
    await click(container.querySelector('[data-testid="git-graph-commit-file"]'))
    expect(commitDiff).toHaveBeenCalledWith({ threadId: thread.id, hash: h('b'), path: 'src/a.ts' })
    const viewer = container.querySelector<HTMLElement>('[data-testid="inbox-change-viewer"]')!
    expect(viewer.textContent).toContain(`Commit ${h('b').slice(0, 7)}, against its parent.`)
    expect(viewer.textContent).toContain('new')
    await act(async () => { viewer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(container.querySelector('[data-testid="inbox-change-viewer"]')).toBeNull()
    expect(view()).not.toBeNull()
    expect(container.querySelector('[data-testid="git-graph-details"]')).not.toBeNull()
    expect(commitDiff).toHaveBeenCalledTimes(1)
  })

  it('moves through the commits with the arrow keys', async () => {
    useInboxChanges.getState().openGraph(thread.id)
    await render()
    const list = container.querySelector<HTMLElement>('[data-testid="git-graph-list"]')!
    const key = (k: string): Promise<void> => act(async () => { list.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) })
    await key('ArrowDown')
    expect(list.getAttribute('aria-activedescendant')).toBe('git-graph-row-working-tree')
    await key('ArrowDown')
    await key('ArrowDown')
    expect(list.getAttribute('aria-activedescendant')).toBe(`git-graph-row-${h('c')}`)
    await key('End')
    expect(list.getAttribute('aria-activedescendant')).toBe(`git-graph-row-${h('a')}`)
  })

  it('fetches, reads the graph again, and shows a failed fetch', async () => {
    useInboxChanges.getState().openGraph(thread.id)
    await render()
    const fetch = container.querySelector('[data-testid="git-graph-fetch"]')!
    await click(fetch)
    expect(gitFetch).toHaveBeenCalledWith({ threadId: thread.id })
    expect(gitGraph).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-testid="git-graph-fetched"]')?.textContent).toBe('Fetched just now')
    gitFetch.mockRejectedValueOnce(new Error('Could not fetch: fatal: Authentication failed'))
    await click(fetch)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Authentication failed')
  })

  it('cannot fetch a repository without remotes', async () => {
    gitGraph.mockResolvedValue({ ...graph, remotes: [], upstream: null })
    useInboxChanges.getState().openGraph(thread.id)
    await render()
    expect(container.querySelector<HTMLButtonElement>('[data-testid="git-graph-fetch"]')!.disabled).toBe(true)
  })

  it('narrows to the current branch and remembers the choice', async () => {
    useInboxChanges.getState().openGraph(thread.id)
    await render()
    await click(container.querySelector('[data-testid="git-graph-scope-head"]'))
    expect(gitGraph).toHaveBeenLastCalledWith({ threadId: thread.id, limit: 400, scope: 'head', threads: true })
    expect(container.querySelector('[data-testid="git-graph-scope-head"]')?.getAttribute('aria-checked')).toBe('true')
  })

  it('dims commits that do not match the search', async () => {
    useInboxChanges.getState().openGraph(thread.id)
    await render()
    const input = container.querySelector<HTMLInputElement>('[data-testid="git-graph-search"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'feature')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(row(h('d')).className).not.toContain('opacity-35')
    expect(row(h('b')).className).toContain('opacity-35')
  })

  it('gives way to a changed file opened for review', async () => {
    useInboxChanges.getState().openGraph(thread.id)
    await render()
    await act(async () => useInboxChanges.getState().openFile(thread.id, 'src/a.ts'))
    expect(view()).toBeNull()
  })

  it('says when the folder is not a repository', async () => {
    gitGraph.mockResolvedValue({ ...graph, available: false, reason: 'This folder is not a Git repository.', commits: [], refs: [] })
    useInboxChanges.getState().openGraph(thread.id)
    await render()
    expect(view()?.textContent).toContain('This folder is not a Git repository.')
  })
})

describe('Git graph threads', () => {
  const other = (id: string, title: string, status: InboxThread['status'], extra: Partial<InboxThread> = {}): InboxThread =>
    ({ ...thread, id, title, status, directory: '/home/me/.mde/worktrees/app/one', ...extra })
  const working = other('ses_two', 'Add login', 'working')
  const asking = other('ses_three', 'Tidy tests', 'attention', { attentionReason: 'question' })
  const elsewhere = other('ses_four', 'Old idea', 'idle')
  const withThreads: InboxGitGraph = {
    ...graph,
    threads: [
      { threadId: thread.id, head: h('c'), branch: 'main', root: '/home/me/app' },
      { threadId: working.id, head: h('d'), branch: 'feature', root: '/home/me/.mde/worktrees/app/one' },
      { threadId: asking.id, head: h('d'), branch: 'feature', root: '/home/me/.mde/worktrees/app/one' },
      { threadId: elsewhere.id, head: h('e'), branch: 'spike', root: '/home/me/.mde/worktrees/app/two' },
      { threadId: 'ses_gone', head: h('c'), branch: 'main', root: '/home/me/app' },
    ],
  }
  const settle = (): Promise<void> => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  const openMenu = (trigger: Element | null): Promise<void> =>
    act(async () => { trigger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  const items = (): HTMLElement[] => Array.from(document.body.querySelectorAll<HTMLElement>('[data-testid="git-graph-thread-item"]'))
  const start = async (): Promise<void> => {
    gitGraph.mockResolvedValue(withThreads)
    useWorkspace.setState({ inboxThreads: [thread, working, asking, elsewhere] })
    useInboxChanges.getState().openGraph(thread.id)
    await render()
  }

  it('marks each commit with the threads whose checkout is there, one by its title and several collected', async () => {
    await start()
    const own = row(h('c')).querySelector<HTMLElement>('[data-testid="git-graph-thread"]')!
    expect(own.textContent).toBe('Fix')
    expect(own.dataset.status).toBe('completed')
    const group = row(h('d')).querySelector<HTMLElement>('[data-testid="git-graph-thread-group"]')!
    expect(group.textContent).toBe('2 threads')
    expect(row(h('b')).querySelector('[data-testid="git-graph-thread"], [data-testid="git-graph-thread-group"]')).toBeNull()
    // Opening the collected ones lists them, the one that wants an answer first, each with its state.
    await openMenu(group)
    expect(items().map((item) => item.textContent)).toEqual(['Tidy testsNeeds input', 'Add loginWorking'])
    // Choosing one neither chooses the commit beneath nor leaves the graph over the thread it opens.
    await click(items()[1]!)
    await settle()
    expect(useWorkspace.getState().selectedInboxThreadId).toBe(working.id)
    expect(useInboxChanges.getState().graphThreadId).toBeNull()
  })

  it('opens a single thread from its marker without choosing the commit', async () => {
    await start()
    await click(row(h('c')).querySelector('[data-testid="git-graph-thread"]'))
    // Its own thread is already beneath the graph, which closes.
    expect(useWorkspace.getState().selectedInboxThreadId).toBe(thread.id)
    expect(view()).toBeNull()
    expect(gitCommit).not.toHaveBeenCalled()
  })

  it('collects every thread of the repository by checkout in the toolbar, and goes to a checkout’s commit', async () => {
    await start()
    const button = container.querySelector<HTMLElement>('[data-testid="git-graph-threads"]')!
    expect(button.textContent).toBe('4')
    await openMenu(button)
    const groups = Array.from(document.body.querySelectorAll<HTMLElement>('[data-testid="git-graph-thread-checkout"]'))
    // Its own checkout first; a checkout whose commit is not among those shown is listed all the same.
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['main', 'feature', 'spike'])
    expect(groups[0]!.textContent).toContain('This thread')
    expect(groups[2]!.textContent).toContain('not shown')
    expect(groups[2]!.querySelector('[role="menuitem"]')?.getAttribute('aria-disabled')).toBe('true')
    await click(groups[1]!.querySelector('[role="menuitem"]'))
    await settle()
    expect(row(h('d')).getAttribute('aria-selected')).toBe('true')
    expect(view()).not.toBeNull()
  })

  it('takes the markers off the graph with the switch, and remembers that', async () => {
    await start()
    await openMenu(container.querySelector('[data-testid="git-graph-threads"]'))
    await click(document.body.querySelector('[data-testid="git-graph-threads-shown"]'))
    expect(container.querySelector('[data-testid="git-graph-thread"]')).toBeNull()
    expect(container.querySelector('[data-testid="git-graph-thread-group"]')).toBeNull()
    expect(localStorage.getItem('mde.gitGraph.threads')).toBe('off')
    // The list of threads stays where it was.
    expect(items()).toHaveLength(4)
  })

  it('follows a thread’s state, and reads the graph again when it changes', async () => {
    await start()
    expect(gitGraph).toHaveBeenCalledTimes(1)
    await act(async () => { useWorkspace.setState({ inboxThreads: [thread, { ...working, status: 'completed' }, asking, elsewhere] }) })
    expect(gitGraph).toHaveBeenCalledTimes(2)
    await openMenu(row(h('d')).querySelector('[data-testid="git-graph-thread-group"]'))
    expect(items().map((item) => item.textContent)).toEqual(['Tidy testsNeeds input', 'Add loginDone'])
  })

  it('has no Threads button when no thread is known for the repository', async () => {
    gitGraph.mockResolvedValue({ ...graph, threads: [] })
    useInboxChanges.getState().openGraph(thread.id)
    await render()
    expect(view()).not.toBeNull()
    expect(container.querySelector('[data-testid="git-graph-threads"]')).toBeNull()
  })
})

describe('refChips', () => {
  it('puts the current branch first and folds a same-named remote branch at the same commit into it', () => {
    const chips = refChips([
      { hash: h('a'), name: 'feature', kind: 'branch' },
      { hash: h('a'), name: 'origin/main', kind: 'remote' },
      { hash: h('a'), name: 'main', kind: 'branch' },
      { hash: h('a'), name: 'upstream/other', kind: 'remote' },
      { hash: h('a'), name: 'v2', kind: 'tag' },
    ], 'main', false)
    expect(chips.map((c) => `${c.kind}:${c.name}${c.current ? '*' : ''}${c.remotes.length ? `+${c.remotes.join(',')}` : ''}`))
      .toEqual(['branch:main*+origin', 'branch:feature', 'remote:upstream/other', 'tag:v2'])
  })

  it('marks a detached HEAD', () => {
    expect(refChips([], null, true)[0]).toMatchObject({ kind: 'head', name: 'HEAD', current: true })
  })
})

describe('fitRefChips', () => {
  const chips = refChips([
    { hash: h('a'), name: 'mybranch', kind: 'branch' },
    ...['3d9d875f', '5dfba40b', 'ed857ea2', '0a1b2c3d'].map((id) => ({ hash: h('a'), name: `mde/${id}`, kind: 'branch' as const })),
  ], 'mybranch', false)
  const width = (count: number): number => chips.slice(0, count).reduce((sum, chip) => sum + refChipWidth(chip) + 6, 0)

  it('shows every chip when they fit, and in a row not yet measured', () => {
    expect(fitRefChips(chips, width(5))).toBe(5)
    expect(fitRefChips(chips, null)).toBe(5)
  })

  it('keeps room for the chip that stands for the rest, and always shows the first', () => {
    expect(fitRefChips(chips, width(5) - 10)).toBe(4)
    expect(fitRefChips(chips, width(4) + 10)).toBe(3)
    expect(fitRefChips(chips, width(2) + 40)).toBe(2)
    expect(fitRefChips(chips, 20)).toBe(1)
    expect(fitRefChips(chips, -100)).toBe(1)
    expect(fitRefChips(chips.slice(0, 1), 0)).toBe(1)
  })
})

describe('commitBodyParagraphs', () => {
  it('joins the wrapped lines of a plain paragraph and keeps lists, code and trailers as written', () => {
    expect(commitBodyParagraphs('One line wrapped\nat seventy-two.\n\n- first\n- second\n\n    code()\n    more()\n\nCo-Authored-By: A <a@example.com>\nSigned-off-by: B')).toEqual([
      'One line wrapped at seventy-two.',
      '- first\n- second',
      '    code()\n    more()',
      'Co-Authored-By: A <a@example.com>\nSigned-off-by: B',
    ])
  })
})
