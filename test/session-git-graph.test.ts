// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionGitGraph } from '../src/renderer/components/SessionGitGraph'
import { useSessionGitGraph } from '../src/renderer/store/session-git-graph'
import type { GitTerminalInfoResponse, InboxChangesResponse, InboxGitGraph } from '../src/shared/types'

const h = (seed: string): string => seed.repeat(40).slice(0, 40)
const pane = 'session-1:tab:t1:pane:p1'
const other = 'session-1:tab:t1:pane:p2'
const graph: InboxGitGraph = {
  available: true, worktree: '/home/me/app', head: h('b'), branch: 'main', upstream: null, remotes: ['origin'],
  refs: [{ hash: h('b'), name: 'main', kind: 'branch' }],
  commits: [
    { hash: h('b'), parents: [h('a')], author: 'Ada', time: 1_700_000_100, subject: 'Second' },
    { hash: h('a'), parents: [], author: 'Ada', time: 1_700_000_000, subject: 'First' },
  ],
  more: false,
}
const info: GitTerminalInfoResponse = {
  repository: true, branch: 'main', additions: 3, deletions: 1, commitsAhead: null, changedFiles: 2, directory: '/home/me/app', worktree: '/home/me/app',
}
const changes: InboxChangesResponse = {
  available: true, branch: 'main', worktree: '/home/me/app', additions: 3, deletions: 1, fileCount: 2,
  files: [{ path: 'src/a.ts', status: 'modified', additions: 3, deletions: 1 }, { path: 'b.ts', status: 'untracked', additions: 0, deletions: 0 }],
}
const graphRead = vi.fn(async () => graph)
const terminalInfo = vi.fn(async () => info)
const changesRead = vi.fn(async () => changes)
const changeDiff = vi.fn(async () => ({ path: 'src/a.ts', diff: '@@ -1 +1,2 @@\n-old\n+new\n+more', binary: false, truncated: false }))
let root: Root
let container: HTMLDivElement

const view = (): HTMLElement | null => container.querySelector('[data-testid="git-graph-view"]')
const render = (props: { terminalIds?: string[]; filePath?: string } = {}): Promise<void> => act(async () => {
  root.render(createElement(SessionGitGraph, { sessionId: 'session-1', terminalIds: props.terminalIds ?? [pane, other], filePath: props.filePath }))
})

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('api', { git: { graph: graphRead, terminalInfo, changes: changesRead, changeDiff, commit: vi.fn(), fetch: vi.fn() } })
  graphRead.mockClear()
  terminalInfo.mockClear()
  changesRead.mockClear()
  useSessionGitGraph.setState({ terminalId: null })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('Sessions Git graph', () => {
  it('shows the graph of the terminal whose chip was clicked, with its uncommitted files', async () => {
    await render()
    expect(view()).toBeNull()
    await act(async () => useSessionGitGraph.getState().toggle(pane))
    expect(view()).not.toBeNull()
    expect(graphRead).toHaveBeenCalledWith({ terminalId: pane, limit: 400, scope: 'all' })
    const working = container.querySelector<HTMLElement>('[data-testid="git-graph-row"][data-hash="working-tree"]')!
    expect(working.textContent).toContain('Uncommitted changes · 2 files')
    await act(async () => working.click())
    expect(changesRead).toHaveBeenCalledWith({ terminalId: pane })
    const files = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="git-graph-working-file"]'))
    expect(files.map((f) => f.title)).toEqual(['src/a.ts', 'b.ts'])
    await act(async () => { view()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await act(async () => { view()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(view()).toBeNull()
    expect(useSessionGitGraph.getState().terminalId).toBeNull()
  })

  it('reviews an uncommitted file over the graph, and the graph is still there, on the same row, after', async () => {
    useSessionGitGraph.setState({ terminalId: pane })
    await render()
    await act(async () => container.querySelector<HTMLElement>('[data-testid="git-graph-row"][data-hash="working-tree"]')!.click())
    await act(async () => container.querySelector<HTMLElement>('[data-testid="git-graph-working-file"][title="src/a.ts"]')!.click())
    expect(changeDiff).toHaveBeenCalledWith({ terminalId: pane, path: 'src/a.ts' })
    const viewer = container.querySelector<HTMLElement>('[data-testid="inbox-change-viewer"]')!
    expect(viewer.textContent).toContain('a.ts')
    expect(viewer.textContent).toContain('main')
    // Escape closes the review only; the graph keeps the chosen row and the file list.
    await act(async () => { viewer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(container.querySelector('[data-testid="inbox-change-viewer"]')).toBeNull()
    expect(view()).not.toBeNull()
    expect(container.querySelector('[data-testid="git-graph-row"][data-hash="working-tree"]')?.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('[data-testid="git-graph-working"]')).not.toBeNull()
  })

  it('closes when its pane is gone, or when a file is opened over the terminals', async () => {
    useSessionGitGraph.setState({ terminalId: pane })
    await render()
    expect(view()).not.toBeNull()
    await render({ filePath: 'README.md' })
    expect(view()).toBeNull()
    useSessionGitGraph.setState({ terminalId: pane })
    await render({ filePath: 'README.md' })
    expect(view()).not.toBeNull()
    await render({ terminalIds: [other], filePath: 'README.md' })
    expect(useSessionGitGraph.getState().terminalId).toBeNull()
  })
})
