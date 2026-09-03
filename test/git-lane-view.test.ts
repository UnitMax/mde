// @vitest-environment happy-dom

import { act, createElement, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitRepositorySnapshot, GitWorktreeSnapshot } from '../src/shared/types'
import { GitLaneView, type GitSessionDefaults } from '../src/renderer/components/GitLaneView'
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

function linkedWorktree(path: string, branch: string): GitWorktreeSnapshot {
  return {
    path,
    branch,
    head: '2222222',
    primary: false,
    prunable: false,
    status: {
      repository: true,
      branch,
      additions: 204,
      deletions: 39,
      commitsAhead: 2,
      commitsBehind: 3
    },
    error: null
  }
}

const repositoryWithWorktrees: GitRepositorySnapshot = {
  ...repository,
  worktrees: [
    ...repository.worktrees,
    linkedWorktree('/home/me/dev/mde-feature', 'feature/sidebar'),
    linkedWorktree('/home/me/dev/mde-fix', 'fix/session')
  ]
}

const repositoryWithManyWorktrees: GitRepositorySnapshot = {
  ...repositoryWithWorktrees,
  worktrees: [
    ...repositoryWithWorktrees.worktrees,
    linkedWorktree('/home/me/dev/mde-docs', 'docs/readme'),
    linkedWorktree('/home/me/dev/mde-test', 'test/lane')
  ]
}

function renderView(onCreateSession?: (defaults: GitSessionDefaults) => void): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  act(() => root.render(createElement(
    GitLaneView as ComponentType<{ onCreateSession?: (defaults: GitSessionDefaults) => void }>,
    { onCreateSession }
  )))
  return container
}

describe('Git lane view', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    useWorkspace.setState({
      projects: [],
      sessions: [],
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
    expect(buttons).toHaveLength(10)
    expect(buttons.filter((button) => button.textContent === 'Check out here')).toHaveLength(4)
    expect(buttons.filter((button) => button.textContent === '+ Worktree')).toHaveLength(4)
    expect(buttons.filter((button) => button.textContent === 'Session')).toHaveLength(1)
    expect(buttons.filter((button) => button.textContent === 'Pull')).toHaveLength(1)
    expect(buttons.filter((button) => button.textContent === 'Pull').every((button) => button.disabled)).toBe(true)
    expect(buttons.filter((button) => button.textContent === 'Session').every((button) => !button.disabled)).toBe(true)
  })

  it('falls back to an empty first lane when no repository is available', () => {
    useWorkspace.setState({ gitRepositories: [], selectedGitRepositoryId: null })
    const container = renderView()

    expect(container.querySelector('[data-testid="git-lane-1"]')?.textContent)
      .toContain('Add a Git repository from the sidebar.')
    expect(container.querySelectorAll('[data-testid="git-lane-placeholder"]')).toHaveLength(3)
  })

  it('renders linked worktrees as cards without change, sync, or size metadata', () => {
    useWorkspace.setState({ gitRepositories: [repositoryWithWorktrees] })
    const container = renderView()

    const worktreeLanes = container.querySelectorAll('[data-testid="git-worktree-lane"]')
    expect(worktreeLanes).toHaveLength(2)
    expect(container.querySelectorAll('[data-testid="git-lane-placeholder"]')).toHaveLength(1)
    expect(container.textContent).toContain('feature/sidebar')
    expect(container.textContent).toContain('fix/session')
    expect(container.textContent).toContain('~/dev/mde-feature')
    expect(container.textContent).toContain('~/dev/mde-fix')
    expect(container.textContent).toContain('Session')
    expect(container.textContent).toContain('Pull')
    expect(container.textContent).not.toContain('↑2 ↓3')
    expect(container.textContent).not.toContain('204')
    expect(container.textContent).not.toContain('39')

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-testid="git-worktree-lane"] button')
    )
    expect(buttons).toHaveLength(4)
    expect(buttons.filter((button) => button.textContent === 'Pull').every((button) => button.disabled)).toBe(true)
    expect(buttons.filter((button) => button.textContent === 'Session').every((button) => !button.disabled)).toBe(true)
    expect(buttons.filter((button) => button.textContent === 'Session')).toHaveLength(2)
    expect(buttons.filter((button) => button.textContent === 'Pull')).toHaveLength(2)
  })

  it('renders all linked worktrees in additional horizontally scrollable lanes', () => {
    useWorkspace.setState({ gitRepositories: [repositoryWithManyWorktrees] })
    const container = renderView()

    expect(container.querySelectorAll('[data-testid="git-worktree-lane"]')).toHaveLength(4)
    expect(container.querySelectorAll('[data-testid="git-lane-placeholder"]')).toHaveLength(0)
    expect(container.textContent).toContain('feature/sidebar')
    expect(container.textContent).toContain('fix/session')
    expect(container.textContent).toContain('docs/readme')
    expect(container.textContent).toContain('test/lane')

    const grid = container.querySelector<HTMLElement>('[data-testid="git-lane-grid"]')
    expect(grid?.style.gridTemplateColumns).toContain('repeat(5')
    expect(grid?.style.minWidth).toContain('max(100%')
  })

  it('passes primary worktree defaults to the session creation callback', () => {
    const onCreateSession = vi.fn()
    useWorkspace.setState({
      projects: [{ id: 'project-1', name: 'Workspace', createdAt: '2026-01-01T00:00:00.000Z' }]
    })

    const container = renderView(onCreateSession)
    const sessionButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="git-lane-1"] [data-testid="git-session-control"]'
    )
    act(() => sessionButton?.click())

    expect(onCreateSession).toHaveBeenCalledWith({
      projectId: 'project-1',
      kind: 'wsl',
      distro: repository.distro,
      path: repository.worktrees[0]!.path,
      name: 'master'
    })
  })
})
