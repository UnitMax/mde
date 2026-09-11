// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalGitInfo } from '../src/renderer/components/TerminalGitInfo'
import { useWorkspace } from '../src/renderer/store/workspace'

const roots: Root[] = []
const containers: HTMLDivElement[] = []

const terminalInfo = vi.fn()

function renderInfo(terminalId = 'pane-1'): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)

  act(() => {
    root.render(createElement(TerminalGitInfo, { terminalId }))
  })

  return container
}

describe('TerminalGitInfo', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { git: { terminalInfo } }
    })
    terminalInfo.mockReset()
    useWorkspace.setState({
      statuses: { 'pane-1': 'running' },
      terminalDirectories: { 'pane-1': '/workspace/repo/src' }
    })
  })

  afterEach(() => {
    act(() => {
      roots.splice(0).forEach((root) => root.unmount())
    })
    containers.splice(0).forEach((container) => container.remove())
    document.body.replaceChildren()
    Reflect.deleteProperty(window, 'api')
    vi.unstubAllGlobals()
  })

  it('renders the available branch and worktree in the terminal header metadata', async () => {
    terminalInfo.mockResolvedValue({
      repository: true,
      branch: 'feature/terminal',
      worktree: '/workspace/repo'
    })

    const container = renderInfo()
    await act(async () => {})

    const info = container.querySelector('[data-testid="terminal-git-info-pane-1"]')
    expect(info?.textContent).toContain('feature/terminal')
    expect(info?.textContent).toContain('/workspace/repo')
    expect(info?.getAttribute('aria-label')).toBe(
      'Git branch feature/terminal · Git worktree /workspace/repo'
    )
  })

  it('renders nothing for a non-repository or an unavailable branch', async () => {
    terminalInfo.mockResolvedValue({
      repository: false,
      branch: null,
      worktree: null
    })

    const nonRepository = renderInfo()
    await act(async () => {})
    expect(nonRepository.textContent).toBe('')

    terminalInfo.mockResolvedValue({
      repository: true,
      branch: null,
      worktree: '/workspace/repo'
    })
    const detached = renderInfo('pane-2')
    useWorkspace.setState({ statuses: { 'pane-2': 'running' } })
    await act(async () => {})

    expect(detached.textContent).toContain('/workspace/repo')
    expect(detached.textContent).not.toContain('Detached HEAD')
  })

  it('refreshes when the terminal directory changes', async () => {
    terminalInfo
      .mockResolvedValueOnce({
        repository: true,
        branch: 'main',
        worktree: '/workspace/repo'
      })
      .mockResolvedValueOnce({
        repository: true,
        branch: 'feature/live',
        worktree: '/workspace/other-repo'
      })

    const container = renderInfo()
    await act(async () => {})
    expect(container.textContent).toContain('main')

    act(() => {
      useWorkspace.getState().setTerminalDirectory({
        terminalId: 'pane-1',
        directory: '/workspace/other-repo'
      })
    })
    await act(async () => {})

    expect(container.textContent).toContain('feature/live')
    expect(container.textContent).toContain('/workspace/other-repo')
  })
})
