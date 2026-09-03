// @vitest-environment happy-dom

import { act, createElement, Fragment } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitRepositorySnapshot } from '../src/shared/types'
import { GitLaneView } from '../src/renderer/components/GitLaneView'
import { Sidebar } from '../src/renderer/components/Sidebar'
import { useWorkspace } from '../src/renderer/store/workspace'

const roots: Root[] = []
const containers: HTMLDivElement[] = []

const repository: GitRepositorySnapshot = {
  id: 'repo-1',
  name: 'mde',
  rootPath: '/home/me/src/mde',
  distro: 'Ubuntu-24.04',
  error: null,
  localBranches: [],
  remoteBranches: [],
  worktrees: [
    {
      path: '/home/me/src/mde',
      branch: 'main',
      head: '1111111',
      primary: true,
      prunable: false,
      status: {
        repository: true,
        branch: 'main',
        additions: 0,
        deletions: 0,
        commitsAhead: null,
        commitsBehind: null
      },
      error: null
    },
    {
      path: '/home/me/src/mde-feature',
      branch: 'feature/sidebar',
      head: '2222222',
      primary: false,
      prunable: false,
      status: {
        repository: true,
        branch: 'feature/sidebar',
        additions: 2,
        deletions: 1,
        commitsAhead: 1,
        commitsBehind: 2
      },
      error: null
    }
  ]
}

const secondRepository: GitRepositorySnapshot = {
  id: 'repo-2',
  name: 'api',
  rootPath: '/home/me/src/api',
  distro: 'Ubuntu-24.04',
  error: null,
  localBranches: [{ name: 'develop', upstream: null }],
  remoteBranches: [],
  worktrees: [
    {
      path: '/home/me/src/api',
      branch: 'develop',
      head: '3333333',
      primary: true,
      prunable: false,
      status: {
        repository: true,
        branch: 'develop',
        additions: 0,
        deletions: 0,
        commitsAhead: null,
        commitsBehind: null
      },
      error: null
    }
  ]
}

const api = {
  git: {
    repositories: {
      list: vi.fn(async () => [repository, secondRepository]),
      add: vi.fn(),
      remove: vi.fn()
    }
  }
}

function resetWorkspace(): void {
  useWorkspace.setState({
    projects: [],
    todoProjects: [],
    todoTasks: [],
    sessions: [],
    selectedSessionId: null,
    selectedTodoProjectId: null,
    selectedGitRepositoryId: null,
    activeWorkspaceView: 'projects',
    gitStatuses: {},
    gitRepositories: [],
    gitRepositoriesLoading: false,
    gitRepositoriesError: null,
    statuses: {},
    terminalDirectories: {},
    exits: {},
    terminalTaskLinks: {},
    opencodeTuiStatuses: {},
    opencodeTuiInstances: {},
    opencodeTuiReadRevisions: {},
    opencodeTuiInstanceLabelMode: 'numbered',
    wslAvailable: true,
    distros: [{ name: 'Ubuntu-24.04', state: 'Running', version: 2, isDefault: true }],
    sidebarCollapsed: false,
    ready: true
  })
}

function renderSidebar(withLane = false): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  act(() => {
    root.render(createElement(
      Fragment,
      null,
      createElement(Sidebar, {
        onNewProject: vi.fn(),
        onNewTodoProject: vi.fn(),
        onNewTodoTask: vi.fn(),
        onNewSession: vi.fn(),
        onOpenGit: vi.fn(),
        terminalLayouts: {},
        onFocusTerminal: vi.fn()
      }),
      withLane ? createElement(GitLaneView) : null
    ))
  })
  return container
}

describe('Git repository sidebar', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    Object.defineProperty(window, 'api', { configurable: true, value: api })
    api.git.repositories.list.mockClear()
    resetWorkspace()
  })

  afterEach(() => {
    act(() => roots.splice(0).forEach((root) => root.unmount()))
    containers.splice(0).forEach((container) => container.remove())
    document.body.replaceChildren()
    delete (window as unknown as { api?: unknown }).api
    vi.unstubAllGlobals()
  })

  it('adds the Git section and displays its primary and linked worktrees', async () => {
    const container = renderSidebar()
    const gitTab = container.querySelector<HTMLButtonElement>('#sidebar-section-tab-git')
    expect(gitTab?.textContent).toBe('Git')

    await act(async () => {
      gitTab?.click()
      await Promise.resolve()
    })

    expect(api.git.repositories.list).toHaveBeenCalled()
    expect(container.querySelector('[data-testid="git-repository-group"]')?.textContent)
      .toContain('mde')
    expect(container.textContent).toContain('main')
    expect(container.textContent).toContain('Primary')
    expect(container.textContent).toContain('feature/sidebar')
    expect(container.textContent).toContain('Worktree')
    expect(container.textContent).toContain('↑1 ↓2')
    expect(useWorkspace.getState().selectedGitRepositoryId).toBe('repo-1')

    const repositoryHeader = container.querySelector<HTMLElement>(
      '[data-testid="git-repository-select"]'
    )
    await act(async () => {
      repositoryHeader?.click()
      await Promise.resolve()
    })
    expect(useWorkspace.getState().selectedGitRepositoryId).toBe('repo-1')
  })

  it('selects another repository from its header or worktree row and updates lane one', async () => {
    const container = renderSidebar(true)
    const gitTab = container.querySelector<HTMLButtonElement>('#sidebar-section-tab-git')

    await act(async () => {
      gitTab?.click()
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="git-primary-branch"]')?.textContent)
      .toContain('main')

    const repositoryHeaders = container.querySelectorAll<HTMLElement>(
      '[data-testid="git-repository-select"]'
    )
    await act(async () => {
      repositoryHeaders[1]?.click()
      await Promise.resolve()
    })

    expect(useWorkspace.getState().selectedGitRepositoryId).toBe('repo-2')
    expect(container.querySelector('[data-testid="git-primary-branch"]')?.textContent)
      .toContain('develop')
    expect(container.querySelector('[data-testid="git-local-branch-row"]')?.textContent)
      .toContain('PRIMARY')

    const repositoryGroups = container.querySelectorAll<HTMLElement>(
      '[data-testid="git-repository-group"]'
    )
    const firstRepositoryWorktree = repositoryGroups[0]?.querySelector<HTMLElement>(
      '[data-testid="git-worktree-row"]'
    )
    await act(async () => {
      firstRepositoryWorktree?.click()
      await Promise.resolve()
    })

    expect(useWorkspace.getState().selectedGitRepositoryId).toBe('repo-1')
    expect(container.querySelector('[data-testid="git-primary-branch"]')?.textContent)
      .toContain('main')
  })
})
