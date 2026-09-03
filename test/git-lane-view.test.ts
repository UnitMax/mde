// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitRepositorySnapshot } from '../src/shared/types'
import { GitLaneView } from '../src/renderer/components/GitLaneView'
import { useWorkspace } from '../src/renderer/store/workspace'

const roots: Root[] = []
const containers: HTMLDivElement[] = []

const repository: GitRepositorySnapshot = {
  id: 'repo-1',
  name: 'mde',
  rootPath: '/home/me/dev/mde',
  distro: 'Ubuntu-24.04',
  localBranches: [
    { name: 'feat/todo-panel', upstream: 'origin/feat/todo-panel' },
    { name: 'spike/pty-resize', upstream: null },
    { name: 'master', upstream: 'origin/master' }
  ],
  remoteBranches: [{ remote: 'origin', name: 'origin/hotfix/sign' }],
  error: null,
  worktrees: [
    {
      path: '/home/me/dev/mde',
      branch: 'master',
      head: '1111111',
      primary: true,
      prunable: false,
      status: {
        repository: true,
        branch: 'master',
        additions: 0,
        deletions: 0,
        commitsAhead: null,
        commitsBehind: null
      },
      error: null
    }
  ]
}

function renderView(): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  act(() => root.render(createElement(GitLaneView)))
  return container
}

describe('Git lane view', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    useWorkspace.setState({
      gitRepositories: [repository],
      gitRepositoriesLoading: false,
      gitRepositoriesError: null,
      selectedGitRepositoryId: 'repo-1'
    })
  })

  afterEach(() => {
    act(() => roots.splice(0).forEach((root) => root.unmount()))
    containers.splice(0).forEach((container) => container.remove())
    document.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  it('renders the selected repository in the first lane and leaves three placeholders', () => {
    const container = renderView()

    expect(container.querySelectorAll('[data-testid="git-lane-placeholder"]')).toHaveLength(3)
    expect(container.querySelector('[data-testid="git-primary-branch"]')?.textContent)
      .toContain('master')
    expect(container.querySelector('[data-testid="git-primary-path"]')?.textContent)
      .toBe('~/dev/mde')
    expect(container.textContent).toContain('Branches')
    expect(container.textContent).not.toContain('Branches without a worktree')
    expect(container.textContent).toContain('feat/todo-panel')
    expect(container.textContent).toContain('origin/feat/todo-panel')
    expect(container.textContent).toContain('no upstream')
    expect(container.textContent).toContain('origin/hotfix/sign')
    expect(container.textContent).toContain('LOCAL on this machine3')
    expect(container.querySelectorAll('[data-testid="git-local-branch-row"]')).toHaveLength(3)
    expect(container.querySelectorAll('[data-testid="git-local-branch-row"]')[2]?.textContent)
      .toContain('PRIMARY')
    expect(container.textContent).toContain('REMOTE · ORIGIN · no local branch yet1')

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    expect(buttons).toHaveLength(8)
    expect(buttons.every((button) => button.disabled)).toBe(true)
    expect(buttons.filter((button) => button.textContent === 'Check out here')).toHaveLength(4)
    expect(buttons.filter((button) => button.textContent === '+ Worktree')).toHaveLength(4)
  })

  it('falls back to an empty first lane when no repository is available', () => {
    useWorkspace.setState({ gitRepositories: [], selectedGitRepositoryId: null })
    const container = renderView()

    expect(container.querySelector('[data-testid="git-lane-1"]')?.textContent)
      .toContain('Add a Git repository from the sidebar.')
    expect(container.querySelectorAll('[data-testid="git-lane-placeholder"]')).toHaveLength(3)
  })
})
