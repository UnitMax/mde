// @vitest-environment happy-dom
import { act, createElement, Fragment, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../src/renderer/components/inbox/InboxTerminal', () => ({
  // The real one draws xterm.js, which needs a real browser; its own tests use a stand-in for the terminal view.
  InboxTerminal: () => createElement('div', { 'data-testid': 'inbox-terminal-stub' }),
  focusInboxTerminalWhenShown: vi.fn(),
}))
import { focusInboxTerminalWhenShown } from '../src/renderer/components/inbox/InboxTerminal'
import { CHANGES_LIST_LIMIT, InboxChangesBadge, InboxChangeViewer, InboxSidebar } from '../src/renderer/components/inbox/InboxChanges'
import { useInboxChanges, inboxChangesKey } from '../src/renderer/store/inbox-changes'
import { useWorkspace } from '../src/renderer/store/workspace'
import type { InboxChangeDiff, InboxChangesResponse, InboxThread, DirectoryContext } from '../src/shared/types'

const thread: InboxThread = { id: 'ses_one', title: 'Fix', directory: '/home/me/app', target: { kind: 'native' }, branch: 'main', folderId: 'fld_app', createdAt: 1, lastActivityAt: 1, readAt: 0, archived: false, status: 'completed' }
const value: InboxChangesResponse = { available: true, branch: 'main', worktree: '/home/me/app', additions: 2, deletions: 1, fileCount: 1, files: [{ path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1 }] }
const session: DirectoryContext = { id: thread.id, name: 'app', path: thread.directory, kind: 'native', createdAt: '' }
const diff: InboxChangeDiff = { path: 'src/a.ts', diff: '@@ -1 +1,2 @@\n-old\n+new\n+more', binary: false, truncated: false }
let root: Root
let container: HTMLDivElement
const changes = vi.fn(async (): Promise<InboxChangesResponse> => value)
const changeDiff = vi.fn(async (): Promise<InboxChangeDiff> => diff)
const chip = (): HTMLButtonElement | null => container.querySelector(`[data-testid="inbox-changes-${thread.id}"]`)
const popover = (): HTMLElement | null => document.body.querySelector('[data-testid="inbox-changes-popover"]')
const fileRow = (path = 'src/a.ts'): HTMLButtonElement | null => document.body.querySelector(`[data-testid="inbox-changes-file"][title="${path}"]`)
const pointer = (type: 'pointerover' | 'pointerenter' | 'pointerleave', target: Element | null): void => { target!.dispatchEvent(new MouseEvent(type, { bubbles: type === 'pointerover' })) }
/** The row the line sits in; the harness for these tests is the container itself. */
const leaveRow = (): void => pointer('pointerleave', container)
// Entering a row fires the row's own pointerenter just after the chip's, which must not cancel the wait to open.
const hover = async (): Promise<void> => {
  await act(async () => {
    pointer('pointerover', chip())
    container.dispatchEvent(new MouseEvent('pointerenter'))
    await vi.advanceTimersByTimeAsync(200)
  })
}
const unhover = async (): Promise<void> => { await act(async () => { leaveRow(); await vi.advanceTimersByTimeAsync(200) }) }
const render = (...children: ReactElement[]): Promise<void> => act(async () => root.render(createElement(Fragment, null, ...children)))
const viewerFor = (threadId: string): ReactElement => createElement(InboxChangeViewer, { threadId })
const mount = (): Promise<void> => render(createElement(InboxChangesBadge, { threadId: thread.id }), viewerFor(thread.id))

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.stubGlobal('api', {
    inbox: { changes, changeDiff, setRead: vi.fn(async () => null) },
    files: { list: vi.fn(async ({ path }: { path: string }) => ({ path, truncated: false, entries: [{ name: 'src', kind: 'directory' }, { name: 'README.md', kind: 'file' }] })) },
  })
  changes.mockReset().mockResolvedValue(value)
  changeDiff.mockReset().mockResolvedValue(diff)
  useWorkspace.setState({ inboxThreads: [thread], selectedInboxThreadId: thread.id, inboxMarkedUnread: {}, inboxCues: {}, activeWorkspaceView: 'inbox', fileTreeCollapsed: false, openFiles: {} })
  useInboxChanges.setState({ entries: {}, selectedPath: null, tab: 'files' })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('shows the changes as a line under the thread and lists the files in a popover on hover', async () => {
  vi.useFakeTimers()
  await mount()
  expect(chip()?.textContent).toContain('1 file')
  expect(chip()?.textContent).toContain('+2')
  expect(chip()?.textContent).toContain('−1')
  expect(chip()?.getAttribute('aria-label')).toBe('Git changes: 1 file, 2 additions, 1 deletions')
  expect(popover()).toBeNull()
  // Passing over the line is not enough; resting on it is.
  await act(async () => { pointer('pointerover', chip()); await vi.advanceTimersByTimeAsync(50) })
  expect(popover()).toBeNull()
  await act(async () => { await vi.advanceTimersByTimeAsync(200) })
  expect(popover()?.textContent).toContain('main')
  expect(popover()?.textContent).toContain('Uncommitted changes against HEAD')
  expect(fileRow()?.textContent).toContain('a.ts')
  expect(fileRow()?.textContent).toContain('+2')
  // The sidebar has no tabs: nothing but the popover shows the file list.
  expect(container.querySelector('[role="tab"]')).toBeNull()
  expect(changes).toHaveBeenLastCalledWith({ threadId: thread.id, details: true })
  await unhover()
  expect(popover()).toBeNull()
})

it('keeps the popover while the pointer crosses from the row into it, and leaves keyboard focus alone', async () => {
  vi.useFakeTimers()
  await mount()
  const composer = document.createElement('textarea')
  document.body.append(composer)
  composer.focus()
  await hover()
  // Leaving the row for the popover beside it: the pointer is in neither for a moment.
  await act(async () => { leaveRow(); await vi.advanceTimersByTimeAsync(60) })
  await act(async () => { pointer('pointerenter', popover()); await vi.advanceTimersByTimeAsync(300) })
  expect(popover()).not.toBeNull()
  // Moving off the chip but staying on the row keeps it too.
  await act(async () => { container.dispatchEvent(new MouseEvent('pointerenter')); await vi.advanceTimersByTimeAsync(300) })
  expect(popover()).not.toBeNull()
  expect(document.activeElement).toBe(composer)
  composer.remove()
})

it('pins the popover on click until Escape or a press elsewhere', async () => {
  vi.useFakeTimers()
  await mount()
  await act(async () => chip()!.click())
  expect(popover()).not.toBeNull()
  expect(chip()?.getAttribute('aria-expanded')).toBe('true')
  // Opened from the keyboard (a click with no pointer), it takes focus so arrows and Tab work from inside it.
  expect(document.activeElement).toBe(popover())
  await unhover()
  expect(popover()).not.toBeNull()
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(popover()).toBeNull()
  await act(async () => chip()!.click())
  await act(async () => { document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })) })
  expect(popover()).toBeNull()
  // A press inside it is not "elsewhere".
  await act(async () => chip()!.click())
  await act(async () => { popover()!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })) })
  expect(popover()).not.toBeNull()
  await act(async () => chip()!.click())
  expect(popover()).toBeNull()
})

it('reviews a changed file chosen in the popover, and closes the review with Escape', async () => {
  vi.useFakeTimers()
  await mount()
  await hover()
  await act(async () => fileRow()!.click())
  expect(popover()).toBeNull()
  expect(useInboxChanges.getState().selectedPath).toEqual({ threadId: thread.id, path: 'src/a.ts' })
  const viewer = container.querySelector<HTMLElement>('[data-testid="inbox-change-viewer"]')!
  expect(viewer.textContent).toContain('new')
  expect(viewer.textContent).toContain('old')
  expect(viewer.textContent).toContain('Uncommitted changes against HEAD')
  await act(async () => viewer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(container.querySelector('[data-testid="inbox-change-viewer"]')).toBeNull()
})

it('opens a file from another thread in that thread, and drops the review when a file is opened from the tree', async () => {
  const other = { ...thread, id: 'ses_two', directory: '/home/me/other' }
  useWorkspace.setState({ inboxThreads: [thread, other], selectedInboxThreadId: thread.id })
  useInboxChanges.setState({ entries: { [inboxChangesKey(other.id)]: { value, loading: false, stale: false } } })
  const closeFile = vi.spyOn(useWorkspace.getState(), 'closeFile')
  useInboxChanges.getState().openFile(other.id, 'src/a.ts')
  expect(useWorkspace.getState().selectedInboxThreadId).toBe(other.id)
  expect(closeFile).toHaveBeenCalledWith(other.id)
  await render(viewerFor(other.id))
  expect(container.querySelector('[data-testid="inbox-change-viewer"]')).not.toBeNull()
  // The file tree's viewer would open beneath the review; the review gives way instead.
  await act(async () => useWorkspace.setState({ openFiles: { [other.id]: 'README.md' } }))
  expect(container.querySelector('[data-testid="inbox-change-viewer"]')).toBeNull()
  expect(useInboxChanges.getState().selectedPath).toBeNull()
})

it('does not bring a review back when the thread is visited again', async () => {
  useInboxChanges.setState({ entries: { [inboxChangesKey(thread.id)]: { value, loading: false, stale: false } } })
  await render(viewerFor(thread.id))
  await act(async () => useInboxChanges.getState().openFile(thread.id, 'src/a.ts'))
  expect(container.querySelector('[data-testid="inbox-change-viewer"]')).not.toBeNull()
  await act(async () => root.render(createElement(Fragment)))
  expect(useInboxChanges.getState().selectedPath).toBeNull()
})

it('shows no line for a checkout without changes or without Git', async () => {
  changes.mockResolvedValue({ ...value, fileCount: 0, additions: 0, deletions: 0, files: [] })
  await mount()
  expect(chip()).toBeNull()
  changes.mockResolvedValue({ available: false, reason: 'This folder is not a Git repository.', branch: null, worktree: null, additions: 0, deletions: 0, fileCount: 0 })
  await act(async () => useInboxChanges.getState().load(thread.id, false, true))
  expect(chip()).toBeNull()
  expect(container.textContent).toBe('')
})

it('distinguishes a failed read from zero changes, and recovers on the next read', async () => {
  vi.useFakeTimers()
  changes.mockRejectedValue(new Error('Git unavailable'))
  await mount()
  expect(chip()?.textContent).toContain('Changes unavailable')
  await act(async () => chip()!.click())
  expect(popover()?.querySelector('[role="alert"]')?.textContent).toContain('Git unavailable')
  expect(popover()?.textContent).not.toContain('No uncommitted changes.')
  changes.mockResolvedValue(value)
  await act(async () => useInboxChanges.getState().load(thread.id, true, true))
  expect(chip()?.textContent).toContain('1 file')
  expect(popover()?.querySelector('[role="alert"]')).toBeNull()
  expect(fileRow()).not.toBeNull()
})

it('says when a commit empties the list while it is open, and does not reopen on its own later', async () => {
  vi.useFakeTimers()
  await mount()
  await act(async () => chip()!.click())
  changes.mockResolvedValue({ ...value, fileCount: 0, additions: 0, deletions: 0, files: [] })
  await act(async () => useInboxChanges.getState().load(thread.id, true, true))
  expect(chip()).toBeNull()
  expect(popover()).toBeNull()
  changes.mockResolvedValue(value)
  await act(async () => useInboxChanges.getState().load(thread.id, true, true))
  expect(chip()).not.toBeNull()
  expect(popover()).toBeNull()
})

it('lists a bounded number of files and says how many it left out', async () => {
  vi.useFakeTimers()
  const files = Array.from({ length: CHANGES_LIST_LIMIT + 3 }, (_, n) => ({ path: `dir/file-${n}.ts`, status: 'untracked' as const, additions: 1, deletions: 0 }))
  changes.mockResolvedValue({ ...value, fileCount: files.length, additions: files.length, deletions: 0, uncounted: 4, files })
  await mount()
  await act(async () => chip()!.click())
  expect(document.body.querySelectorAll('[data-testid="inbox-changes-file"]')).toHaveLength(CHANGES_LIST_LIMIT)
  expect(popover()?.textContent).toContain('and 3 files more not shown')
  expect(popover()?.textContent).toContain('Line counts leave out 4 files')
})

it('keeps counts, file rows, and the open diff visible throughout a background refresh', async () => {
  vi.useFakeTimers()
  await mount()
  await act(async () => chip()!.click())
  const row = fileRow()
  await act(async () => row!.click())
  await act(async () => chip()!.click())
  const scroll = container.querySelector('[data-testid="chat-diff-scroll"]')
  const original = document.body.textContent
  let finishChanges!: (next: InboxChangesResponse) => void
  let finishDiff!: (next: InboxChangeDiff) => void
  changes.mockImplementationOnce(() => new Promise((resolve) => { finishChanges = resolve }))
  changeDiff.mockImplementationOnce(() => new Promise((resolve) => { finishDiff = resolve }))
  await act(async () => vi.advanceTimersByTimeAsync(10_500))
  expect(changes).toHaveBeenLastCalledWith({ threadId: thread.id, details: true })
  expect(useInboxChanges.getState().entries[inboxChangesKey(thread.id)]).toMatchObject({ loading: true, stale: false })
  expect(document.body.textContent).toBe(original)
  expect(document.body.querySelector('[data-stale]')).toBeNull()
  expect(document.body.querySelector('[role="status"]')).toBeNull()
  expect(fileRow()).not.toBeNull()
  expect(container.querySelector('[data-testid="chat-diff-scroll"]')).toBe(scroll)
  await act(async () => finishChanges({ ...value, additions: 3, files: [{ ...value.files![0]!, additions: 3 }] }))
  expect(document.body.textContent).toContain('+3')
  expect(document.body.textContent).toContain('old')
  expect(document.body.querySelector('[role="status"]')).toBeNull()
  expect(container.querySelector('[data-testid="chat-diff-scroll"]')).toBe(scroll)
  await act(async () => finishDiff({ path: 'src/a.ts', diff: '@@ -1 +1,3 @@\n-old\n+updated\n+more\n+lines', binary: false, truncated: false }))
  expect(document.body.textContent).toContain('updated')
})

it('marks cached counts stale only on failure and keeps them visible through retry', async () => {
  vi.useFakeTimers()
  await mount()
  await act(async () => chip()!.click())
  changes.mockRejectedValueOnce(new Error('Git unavailable'))
  await act(async () => useInboxChanges.getState().load(thread.id, true, true))
  expect(chip()?.getAttribute('data-stale')).toBe('true')
  expect(chip()?.textContent).toContain('+2')
  expect(fileRow()).not.toBeNull()
  expect(popover()?.querySelector('[role="alert"]')?.textContent).toContain('Git unavailable')
  expect(popover()?.querySelector('[role="alert"]')?.textContent).toContain('Showing the last result.')
  let finish!: (next: InboxChangesResponse) => void
  changes.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  await act(async () => { void useInboxChanges.getState().load(thread.id, true, true) })
  expect(chip()?.getAttribute('data-stale')).toBe('true')
  expect(fileRow()).not.toBeNull()
  await act(async () => finish(value))
  expect(document.body.querySelector('[data-stale]')).toBeNull()
  expect(document.body.querySelector('[role="alert"]')).toBeNull()
})

it('does not poll while the window is hidden, and catches up when it is shown again', async () => {
  vi.useFakeTimers()
  const stop = useInboxChanges.getState().watch(thread.id)
  try {
    await useInboxChanges.getState().load(thread.id)
    changes.mockClear()
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(changes).not.toHaveBeenCalled()
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(500)
    expect(changes).toHaveBeenCalledTimes(1)
  } finally {
    delete (document as { hidden?: boolean }).hidden
    stop()
  }
})

it('ignores an in-flight result after deleting a thread', async () => {
  let finish!: (value: InboxChangesResponse) => void
  changes.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  const loading = useInboxChanges.getState().load(thread.id)
  useWorkspace.setState({ inboxThreads: [] })
  useInboxChanges.getState().prune([])
  finish(value)
  await loading
  expect(useInboxChanges.getState().entries[inboxChangesKey(thread.id)]).toBeUndefined()
})


it('limits simultaneous loads to two and prioritizes a selected thread already queued', async () => {
  const ids = ['ses_a', 'ses_b', 'ses_c', 'ses_d']
  useWorkspace.setState({ inboxThreads: ids.map((id) => ({ ...thread, id, directory: `/home/me/${id}` })) })
  const finish = new Map<string, (value: InboxChangesResponse) => void>()
  const calls: string[] = []
  changes.mockImplementation((...args: unknown[]) => {
    const id = (args[0] as { threadId: string }).threadId
    calls.push(id)
    return new Promise((resolve) => finish.set(id, resolve))
  })
  const loads = ids.map((id) => useInboxChanges.getState().load(id))
  const details = useInboxChanges.getState().load('ses_d', true)
  expect(calls).toEqual(['ses_a', 'ses_b'])
  finish.get('ses_a')!(value)
  await vi.waitFor(() => expect(calls).toHaveLength(3))
  expect(calls[2]).toBe('ses_d')
  finish.get('ses_b')!(value)
  await vi.waitFor(() => expect(calls).toHaveLength(4))
  finish.get('ses_c')!(value)
  finish.get('ses_d')!(value)
  await Promise.all([...loads, details])
})

it('coalesces background refresh requests and rereads Git status on focus', async () => {
  vi.useFakeTimers()
  const stop = useInboxChanges.getState().watch(thread.id, true)
  try {
    await useInboxChanges.getState().load(thread.id, true)
    expect(changes).toHaveBeenCalledTimes(1)
    for (let n = 0; n < 10; n += 1) useInboxChanges.getState().scheduleRefresh(thread.id)
    expect(useInboxChanges.getState().entries[inboxChangesKey(thread.id)]?.stale).toBe(false)
    await vi.advanceTimersByTimeAsync(500)
    expect(changes).toHaveBeenCalledTimes(2)
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(500)
    expect(changes).toHaveBeenCalledTimes(3)
    expect(changes).toHaveBeenLastCalledWith({ threadId: thread.id, details: true })
    await vi.advanceTimersByTimeAsync(10_500)
    expect(changes).toHaveBeenCalledTimes(4)
  } finally {
    stop()
    vi.useRealTimers()
  }
})


it('shares counts and requests between conversations and forks in the same checkout', async () => {
  useWorkspace.setState({ inboxThreads: [thread, { ...thread, id: 'ses_fork', forkedFrom: thread.id }] })
  await Promise.all([useInboxChanges.getState().load(thread.id), useInboxChanges.getState().load('ses_fork')])
  expect(changes).toHaveBeenCalledTimes(1)
  expect(inboxChangesKey(thread.id)).toBe(inboxChangesKey('ses_fork'))
})


it('keeps different checkouts and WSL distros separate even when their branch names match', async () => {
  useWorkspace.setState({ inboxThreads: [
    thread,
    { ...thread, id: 'ses_other', directory: '/home/me/other' },
    { ...thread, id: 'ses_wsl', target: { kind: 'wsl', distro: 'Ubuntu' } },
  ] })
  await Promise.all(['ses_one', 'ses_other', 'ses_wsl'].map((id) => useInboxChanges.getState().load(id)))
  expect(changes).toHaveBeenCalledTimes(3)
  expect(new Set(['ses_one', 'ses_other', 'ses_wsl'].map(inboxChangesKey)).size).toBe(3)
})


it('uses one polling schedule for staggered rows and a pane sharing a checkout', async () => {
  vi.useFakeTimers()
  useWorkspace.setState({ inboxThreads: [thread, { ...thread, id: 'ses_fork', forkedFrom: thread.id }] })
  const stops: Array<() => void> = []
  try {
    stops.push(useInboxChanges.getState().watch(thread.id))
    await useInboxChanges.getState().load(thread.id)
    await vi.advanceTimersByTimeAsync(2_000)
    stops.push(useInboxChanges.getState().watch('ses_fork'))
    await vi.advanceTimersByTimeAsync(2_000)
    stops.push(useInboxChanges.getState().watch(thread.id, true))
    await useInboxChanges.getState().load(thread.id, true)
    changes.mockClear()
    await vi.advanceTimersByTimeAsync(6_500)
    expect(changes).toHaveBeenCalledTimes(1)
    // Later-mounted rows and the pane must not start their own extra polls.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(changes).toHaveBeenCalledTimes(1)
    stops.shift()!()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(changes).toHaveBeenCalledTimes(2)
  } finally {
    stops.forEach((stop) => stop())
  }
})

it('keeps a cached file list when a row asks for a summary refresh', async () => {
  const key = inboxChangesKey(thread.id)
  useInboxChanges.setState({ entries: { [key]: { value, loading: false, stale: false } } })
  changes.mockImplementation(async (...args: unknown[]) => {
    const { details } = args[0] as { details?: boolean }
    const { files: _files, ...summary } = value
    return details ? value : summary
  })
  await useInboxChanges.getState().load(thread.id, false, true)
  expect(changes).toHaveBeenLastCalledWith({ threadId: thread.id, details: true })
  expect(useInboxChanges.getState().entries[key]?.value?.files).toEqual(value.files)
})

it('accepts slow poll results instead of discarding them each time a timer fires', async () => {
  vi.useFakeTimers()
  const key = inboxChangesKey(thread.id)
  useInboxChanges.setState({ entries: { [key]: { value, loading: false, stale: false } } })
  const stop = useInboxChanges.getState().watch(thread.id, true)
  let finish!: (next: InboxChangesResponse) => void
  changes.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  try {
    await vi.advanceTimersByTimeAsync(30_500)
    expect(changes).toHaveBeenCalledTimes(1)
    expect(useInboxChanges.getState().entries[key]).toMatchObject({ loading: true, stale: false })
    finish({ ...value, additions: 5 })
    await useInboxChanges.getState().load(thread.id, true)
    expect(useInboxChanges.getState().entries[key]).toMatchObject({ loading: false, stale: false, value: { additions: 5 } })
    expect(changes).toHaveBeenCalledTimes(1)
  } finally {
    stop()
  }
})

const tab = (name: 'files' | 'changes' | 'terminal'): HTMLButtonElement | null => container.querySelector(`[data-testid="inbox-sidebar-tab-${name}"]`)
const changesPanel = (): HTMLElement | null => container.querySelector('[data-testid="inbox-changes-panel"]')
const sidebar = (): Promise<void> => render(createElement(InboxSidebar, { session, threadId: thread.id }), viewerFor(thread.id))

it('offers Files, Changes and Terminal tabs for an open thread, starting on Files', async () => {
  await sidebar()
  expect(Array.from(container.querySelectorAll('[role="tab"]')).map((item) => item.textContent?.replace(/\d+$/, ''))).toEqual(['Files', 'Changes', 'Terminal'])
  expect(tab('files')?.getAttribute('aria-selected')).toBe('true')
  expect(tab('changes')?.getAttribute('aria-selected')).toBe('false')
  expect(container.querySelector('[data-testid="file-tree-panel"]')?.textContent).toContain('README.md')
  expect(changesPanel()).toBeNull()
})

it('shows the changes on the Changes tab, the same view as the popover, and reviews a file chosen there', async () => {
  await sidebar()
  await act(async () => tab('changes')!.click())
  expect(tab('changes')?.getAttribute('aria-selected')).toBe('true')
  expect(changesPanel()?.textContent).toContain('main')
  expect(changesPanel()?.textContent).toContain('1 file changed')
  expect(changesPanel()?.textContent).toContain('Uncommitted changes against HEAD')
  expect(changes).toHaveBeenLastCalledWith({ threadId: thread.id, details: true })
  // Only the tab on screen carries tabs.
  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(3)
  const row = changesPanel()!.querySelector<HTMLButtonElement>('[data-testid="inbox-changes-file"]')!
  expect(row.getAttribute('aria-current')).toBeNull()
  await act(async () => row.click())
  expect(useInboxChanges.getState().selectedPath).toEqual({ threadId: thread.id, path: 'src/a.ts' })
  expect(container.querySelector('[data-testid="inbox-change-viewer"]')?.textContent).toContain('new')
  expect(changesPanel()!.querySelector('[data-testid="inbox-changes-file"]')?.getAttribute('aria-current')).toBe('true')
  // The review stays while the tab changes; it is a file from the tree that replaces it.
  await act(async () => tab('files')!.click())
  expect(container.querySelector('[data-testid="inbox-change-viewer"]')).not.toBeNull()
})

it('keeps the file tree mounted behind Changes, so it comes back as it was', async () => {
  await sidebar()
  const tree = container.querySelector('[data-testid="file-tree-panel"]')
  await act(async () => tab('changes')!.click())
  expect(container.querySelector('[data-testid="file-tree-panel"]')).toBe(tree)
  expect(tree?.closest('[data-testid="inbox-files-panel"]')?.className).toContain('hidden')
  await act(async () => tab('files')!.click())
  expect(container.querySelector('[data-testid="file-tree-panel"]')).toBe(tree)
  expect(tree?.closest('[data-testid="inbox-files-panel"]')?.className).toContain('contents')
  expect(changesPanel()).toBeNull()
})

it('counts the changed files on the tab without opening it, and reads Git for just this thread', async () => {
  await sidebar()
  expect(tab('changes')?.textContent).toContain('1')
  expect(changes).toHaveBeenCalledTimes(1)
  expect(changes).toHaveBeenCalledWith({ threadId: thread.id, details: false })
})

it('moves between the tabs with the arrow keys, Home and End', async () => {
  await sidebar()
  const key = (name: string): Promise<void> => act(async () => { container.querySelector('[role="tablist"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })) })
  await key('ArrowRight')
  expect(tab('changes')?.getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(tab('changes'))
  await key('ArrowRight')
  expect(useInboxChanges.getState().tab).toBe('terminal')
  // The ends are joined, as in any set of tabs.
  await key('ArrowRight')
  expect(useInboxChanges.getState().tab).toBe('files')
  await key('ArrowLeft')
  expect(useInboxChanges.getState().tab).toBe('terminal')
  await key('ArrowLeft')
  expect(tab('changes')?.getAttribute('aria-selected')).toBe('true')
  await key('End')
  expect(useInboxChanges.getState().tab).toBe('terminal')
  await key('Home')
  expect(useInboxChanges.getState().tab).toBe('files')
  // Choosing the tab that is already showing leaves no pending focus to land somewhere unrelated later.
  await key('Home')
  tab('files')!.blur()
  await act(async () => tab('changes')!.click())
  expect(document.activeElement).toBe(tab('changes'))
})

it('refreshes the Changes tab by hand, and keeps the list while it does', async () => {
  await sidebar()
  await act(async () => tab('changes')!.click())
  changes.mockClear()
  let finish!: (next: InboxChangesResponse) => void
  changes.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Refresh changes"]')!.click() })
  expect(changes).toHaveBeenCalledWith({ threadId: thread.id, details: true })
  expect(changesPanel()!.querySelector('[data-testid="inbox-changes-file"]')).not.toBeNull()
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Refresh changes"]')?.disabled).toBe(true)
  await act(async () => finish({ ...value, additions: 9 }))
  expect(changesPanel()?.textContent).toContain('+9')
})

it('offers only Files and Terminal for a new thread, which has no changes yet, and nothing for a collapsed sidebar', async () => {
  await render(createElement(InboxSidebar, { session }))
  expect(Array.from(container.querySelectorAll('[role="tab"]')).map((item) => item.textContent)).toEqual(['Files', 'Terminal'])
  expect(container.querySelector('[data-testid="file-tree-panel"]')).not.toBeNull()
  expect(changes).not.toHaveBeenCalled()
  // A choice of Changes made for a thread does not leave the new-thread page without a panel.
  useInboxChanges.setState({ tab: 'changes' })
  await render(createElement(InboxSidebar, { session }))
  expect(tab('files')?.getAttribute('aria-selected')).toBe('true')
  expect(changesPanel()).toBeNull()
  useInboxChanges.setState({ tab: 'files' })
  useWorkspace.setState({ fileTreeCollapsed: true })
  await sidebar()
  expect(container.querySelector('[role="tablist"]')).toBeNull()
  expect(container.querySelector('[aria-label="Expand files"]')).not.toBeNull()
  expect(changes).not.toHaveBeenCalled()
})

it('lists the changes on the Changes tab even when the thread list does not show them', async () => {
  useInboxChanges.setState({ sidebarChanges: false })
  await sidebar()
  await act(async () => tab('changes')!.click())
  expect(changesPanel()?.querySelectorAll('[data-testid="inbox-changes-file"]')).toHaveLength(1)
})

const terminalPanel = (): HTMLElement | null => container.querySelector('[data-testid="inbox-terminal-panel"]')

it('shows the terminal on the Terminal tab, with the tabs and the collapse button, and keeps the file tree behind it', async () => {
  await sidebar()
  const tree = container.querySelector('[data-testid="file-tree-panel"]')
  await act(async () => tab('terminal')!.click())
  expect(tab('terminal')?.getAttribute('aria-selected')).toBe('true')
  expect(terminalPanel()?.querySelector('[data-testid="inbox-terminal-stub"]')).not.toBeNull()
  expect(terminalPanel()?.querySelectorAll('[role="tab"]')).toHaveLength(3)
  expect(terminalPanel()?.querySelector('[aria-label="Collapse sidebar"]')).not.toBeNull()
  expect(container.querySelector('[data-testid="file-tree-panel"]')).toBe(tree)
  expect(tree?.closest('[data-testid="inbox-files-panel"]')?.className).toContain('hidden')
  expect(changesPanel()).toBeNull()
  await act(async () => tab('files')!.click())
  expect(terminalPanel()).toBeNull()
})

it('shows the terminal for a new thread too: it belongs to no thread', async () => {
  await render(createElement(InboxSidebar, { session }))
  await act(async () => tab('terminal')!.click())
  expect(terminalPanel()?.querySelector('[data-testid="inbox-terminal-stub"]')).not.toBeNull()
  expect(Array.from(terminalPanel()!.querySelectorAll('[role="tab"]')).map((item) => item.textContent)).toEqual(['Files', 'Terminal'])
  expect(changes).not.toHaveBeenCalled()
})

it('takes the keyboard to the terminal when the tab is clicked, but not when it is reached from the keyboard', async () => {
  vi.mocked(focusInboxTerminalWhenShown).mockClear()
  await sidebar()
  await act(async () => tab('terminal')!.click())
  expect(focusInboxTerminalWhenShown).not.toHaveBeenCalled()
  await act(async () => tab('files')!.click())
  await act(async () => { tab('terminal')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })) })
  expect(focusInboxTerminalWhenShown).toHaveBeenCalledTimes(1)
})

it('puts every panel in the resizable frame, but not the collapsed rail', async () => {
  await sidebar()
  expect(container.querySelector('[data-testid="inbox-sidebar-frame"] [data-testid="file-tree-panel"]')).not.toBeNull()
  await act(async () => tab('terminal')!.click())
  expect(container.querySelector('[data-testid="inbox-sidebar-frame"] [data-testid="inbox-terminal-panel"]')).not.toBeNull()
  useWorkspace.setState({ fileTreeCollapsed: true })
  await sidebar()
  expect(container.querySelector('[data-testid="inbox-sidebar-frame"]')).toBeNull()
  expect(container.querySelector('[aria-label="Expand files"]')).not.toBeNull()
})
