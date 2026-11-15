// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitTerminalInfoResponse } from '../src/shared/types'
import { TerminalGitInfo } from '../src/renderer/components/TerminalGitInfo'
import { useWorkspace } from '../src/renderer/store/workspace'
import { useSessionGitGraph } from '../src/renderer/store/session-git-graph'

const roots: Root[] = []
const terminalInfo = vi.fn()
const snapshot: GitTerminalInfoResponse = {
  repository: true, branch: 'feature/terminal', worktree: '/workspace/repo',
  directory: '/workspace/repo/src', additions: 12, deletions: 3, commitsAhead: 2, changedFiles: 1,
}

async function renderInfo(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(createElement(TerminalGitInfo, { terminalId: 'pane-1' })))
  return container
}

describe('TerminalGitInfo', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { git: { terminalInfo } },
    })
    terminalInfo.mockReset().mockResolvedValue(snapshot)
    useWorkspace.setState({ statuses: { 'pane-1': 'running' }, terminalDirectories: { 'pane-1': snapshot.directory } })
  })

  afterEach(() => {
    act(() => roots.splice(0).forEach((root) => root.unmount()))
    document.body.replaceChildren()
    Reflect.deleteProperty(window, 'api')
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows the branch and line changes, with the rest in its label, and opens the Git graph', async () => {
    const container = await renderInfo()
    const info = container.querySelector('[data-testid^="terminal-git-info-"]')
    expect(info?.textContent).toContain('feature/terminal')
    expect(info?.textContent).toContain('+12')
    expect(info?.textContent).toContain('−3')
    // Commits ahead and the worktree would crowd the bar; they stay in the label and the tooltip.
    expect(info?.textContent).not.toContain('/workspace/repo')
    expect(info?.textContent).not.toContain('↑2')
    for (const label of [info?.getAttribute('aria-label'), info?.getAttribute('title')]) {
      expect(label).toContain('2 commits ahead of upstream')
      expect(label).toContain('Git worktree /workspace/repo')
    }
    expect(info?.querySelector('.bg-warn')).not.toBeNull()
    // Clicking opens the Git graph for this terminal, and clicking again closes it.
    expect(info?.tagName).toBe('BUTTON')
    expect(info?.getAttribute('aria-pressed')).toBe('false')
    await act(async () => info?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(useSessionGitGraph.getState().terminalId).not.toBeNull()
    expect(info?.getAttribute('aria-pressed')).toBe('true')
    expect(info?.getAttribute('aria-label')).toContain('Close the Git graph')
    await act(async () => info?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(useSessionGitGraph.getState().terminalId).toBeNull()
  })

  it('renders nothing outside a repository', async () => {
    terminalInfo.mockResolvedValue({ ...snapshot, repository: false })
    expect((await renderInfo()).textContent).toBe('')
  })

  it('shows detached HEAD and changes that have no line counts', async () => {
    terminalInfo.mockResolvedValue({ ...snapshot, branch: null, additions: 0, deletions: 0, commitsAhead: null, changedFiles: 2 })
    const container = await renderInfo()
    expect(container.textContent).toContain('Detached HEAD')
    expect(container.textContent).toContain('2 changed')
    expect(container.querySelector('[data-testid^="terminal-git-info-"]')?.getAttribute('aria-label')).toContain('2 changed entries')
  })

  it('refreshes the summary after changing directory', async () => {
    const container = await renderInfo()
    terminalInfo.mockResolvedValue({ ...snapshot, branch: 'feature/live', worktree: '/workspace/other', directory: '/workspace/other' })
    await act(async () => useWorkspace.getState().setTerminalDirectory({ terminalId: 'pane-1', directory: '/workspace/other' }))
    expect(container.textContent).toContain('feature/live')
    expect(container.textContent).not.toContain('feature/terminal')
  })

  it('ignores a response for a previous directory', async () => {
    let finish: (info: GitTerminalInfoResponse) => void = () => undefined
    terminalInfo.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const container = await renderInfo()
    terminalInfo.mockResolvedValue({ ...snapshot, branch: 'new-repo', directory: '/workspace/new' })
    await act(async () => useWorkspace.getState().setTerminalDirectory({ terminalId: 'pane-1', directory: '/workspace/new' }))
    await act(async () => finish(snapshot))
    expect(container.textContent).toContain('new-repo')
    expect(container.textContent).not.toContain('feature/terminal')
  })

  it('polls without overlapping requests and refreshes on window focus', async () => {
    vi.useFakeTimers()
    let finish: (info: GitTerminalInfoResponse) => void = () => undefined
    terminalInfo.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const container = await renderInfo()
    await act(async () => vi.advanceTimersByTime(20_000))
    expect(terminalInfo).toHaveBeenCalledTimes(1)
    await act(async () => finish(snapshot))
    terminalInfo.mockResolvedValue({ ...snapshot, additions: 0, deletions: 0, changedFiles: 0, commitsAhead: null })
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(terminalInfo).toHaveBeenCalledTimes(2)
    const info = container.querySelector('[data-testid^="terminal-git-info-"]')
    expect(info?.textContent).toBe('feature/terminal')
    expect(info?.getAttribute('aria-label')).toContain('Working tree clean')
    expect(info?.querySelector('.bg-warn')).toBeNull()
  })
})
