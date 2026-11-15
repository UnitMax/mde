// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hideFloatingTerminalOver, InboxTerminalGitGraph } from '../src/renderer/components/inbox/InboxTerminalGitGraph'
import { useInboxChanges } from '../src/renderer/store/inbox-changes'
import { useInboxFloatingTerminal } from '../src/renderer/store/inbox-floating-terminal'
import { useInboxTerminal } from '../src/renderer/store/inbox-terminal'
import { useSessionGitGraph } from '../src/renderer/store/session-git-graph'
import type { GitTerminalInfoResponse, InboxGitGraph } from '../src/shared/types'

const pane = 'inbox-terminal:tab:t1:pane:p1'
const graph: InboxGitGraph = {
  available: true, worktree: '/home/me/app', head: 'b'.repeat(40), branch: 'mybranch', upstream: null, remotes: [],
  refs: [{ hash: 'b'.repeat(40), name: 'mybranch', kind: 'branch' }],
  commits: [{ hash: 'b'.repeat(40), parents: [], author: 'Ada', time: 1_700_000_000, subject: 'First' }],
  more: false,
}
const info: GitTerminalInfoResponse = {
  repository: true, branch: 'mybranch', additions: 3, deletions: 1, commitsAhead: null, changedFiles: 14, directory: '/home/me/app', worktree: '/home/me/app',
}
let root: Root
let container: HTMLDivElement
let main: HTMLElement
let floatingWindow: HTMLElement
const layout = useInboxTerminal.getState().layout

const box = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect
const view = (): HTMLElement | null => container.querySelector('[data-testid="git-graph-view"]')
const render = (filePath?: string): Promise<void> => act(async () => {
  const area = { current: main }
  root.render(createElement(InboxTerminalGitGraph, { area, filePath }))
})

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('api', {
    git: { graph: vi.fn(async () => graph), terminalInfo: vi.fn(async () => info), changes: vi.fn(), changeDiff: vi.fn(), commit: vi.fn(), fetch: vi.fn() },
  })
  useSessionGitGraph.setState({ terminalId: null })
  useInboxChanges.setState({ graphThreadId: null, selectedPath: null, graphReturn: null })
  useInboxTerminal.setState({ layout: { ...layout, panes: [{ ...layout.panes[0]!, terminalId: pane }] } })
  useInboxFloatingTerminal.setState({ floating: true, visible: true, rect: null, maximized: false })
  // The conversation area, and the floating window over it.
  main = document.createElement('main')
  main.getBoundingClientRect = () => box(300, 40, 900, 700)
  floatingWindow = document.createElement('section')
  floatingWindow.dataset.testid = 'floating-terminal'
  floatingWindow.getBoundingClientRect = () => box(700, 300, 500, 400)
  container = document.createElement('div')
  document.body.append(main, floatingWindow, container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('the Git chip of an Inbox terminal pane', () => {
  it('opens the pane checkout’s graph over the conversation, and the chip closes it again', async () => {
    useInboxFloatingTerminal.setState({ floating: false, visible: false })
    await render()
    expect(view()).toBeNull()
    await act(async () => useSessionGitGraph.getState().toggle(pane))
    expect(view()).not.toBeNull()
    expect(window.api.git.graph).toHaveBeenCalledWith({ terminalId: pane, limit: 400, scope: 'all', threads: true })
    await act(async () => useSessionGitGraph.getState().toggle(pane))
    expect(view()).toBeNull()
  })

  it('hides a floating terminal lying over the conversation, so the graph is seen', async () => {
    await render()
    await act(async () => useSessionGitGraph.getState().toggle(pane))
    expect(view()).not.toBeNull()
    expect(useInboxFloatingTerminal.getState()).toMatchObject({ floating: true, visible: false })
  })

  it('leaves a floating terminal parked clear of the conversation where it is', async () => {
    floatingWindow.getBoundingClientRect = () => box(0, 300, 300, 400)
    await render()
    await act(async () => useSessionGitGraph.getState().toggle(pane))
    expect(useInboxFloatingTerminal.getState().visible).toBe(true)
  })

  it('brings a thread’s graph, a diff or a file from the tree into view the same way', async () => {
    await render()
    await act(async () => useInboxChanges.getState().openGraph('thread-1'))
    expect(useInboxFloatingTerminal.getState().visible).toBe(false)
    await act(async () => useInboxFloatingTerminal.getState().show())
    await act(async () => useInboxChanges.setState({ graphThreadId: null, selectedPath: { threadId: 'thread-1', path: 'a.ts' } }))
    expect(useInboxFloatingTerminal.getState().visible).toBe(false)
    await act(async () => useInboxFloatingTerminal.getState().show())
    await render('README.md')
    expect(useInboxFloatingTerminal.getState().visible).toBe(false)
  })

  it('keeps one graph over the conversation: the one opened last', async () => {
    useInboxChanges.setState({ graphThreadId: 'thread-1' })
    await render()
    await act(async () => useSessionGitGraph.getState().toggle(pane))
    expect(useInboxChanges.getState().graphThreadId).toBeNull()
    expect(view()).not.toBeNull()
    await act(async () => useInboxChanges.getState().openGraph('thread-1'))
    expect(useSessionGitGraph.getState().terminalId).toBeNull()
    expect(useInboxChanges.getState().graphThreadId).toBe('thread-1')
  })

  it('closes when its pane closes, and on leaving the Inbox', async () => {
    useSessionGitGraph.setState({ terminalId: pane })
    await render()
    expect(view()).not.toBeNull()
    await act(async () => useInboxTerminal.setState({ layout: { ...layout, panes: [{ ...layout.panes[0]!, terminalId: 'inbox-terminal:tab:t1:pane:p2' }] } }))
    expect(useSessionGitGraph.getState().terminalId).toBeNull()

    useInboxTerminal.setState({ layout: { ...layout, panes: [{ ...layout.panes[0]!, terminalId: pane }] } })
    useSessionGitGraph.setState({ terminalId: pane })
    await render()
    await act(async () => root.unmount())
    expect(useSessionGitGraph.getState().terminalId).toBeNull()
    root = createRoot(container)
  })
})

describe('hiding the floating terminal for what opens beneath it', () => {
  it('does nothing while the terminal is docked or already hidden', () => {
    useInboxFloatingTerminal.setState({ floating: false, visible: false })
    hideFloatingTerminalOver(main)
    expect(useInboxFloatingTerminal.getState()).toMatchObject({ floating: false, visible: false })
    useInboxFloatingTerminal.setState({ floating: true, visible: true })
    floatingWindow.getBoundingClientRect = () => box(1200, 40, 200, 200)
    // Touching the area's edge is not lying over it.
    hideFloatingTerminalOver(main)
    expect(useInboxFloatingTerminal.getState().visible).toBe(true)
  })
})
