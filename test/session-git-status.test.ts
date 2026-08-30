// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitStatusResponse } from '../src/shared/types'
import { SessionGitStatus } from '../src/renderer/components/SessionGitStatus'
import {
  formatGitCount,
  gitStatusAccessibleLabel,
  gitStatusChangesLabel
} from '../src/renderer/lib/git'
import type { GitSessionStatus } from '../src/renderer/store/workspace'

const roots: Root[] = []
const containers: HTMLDivElement[] = []

function response(overrides: Partial<GitStatusResponse> = {}): GitStatusResponse {
  return {
    repository: true,
    branch: 'feature/sidebar',
    additions: 12,
    deletions: 3,
    commitsAhead: 2,
    ...overrides
  }
}

function status(value: Partial<GitSessionStatus> = {}): GitSessionStatus {
  return {
    response: response(),
    error: null,
    loading: false,
    ...value
  }
}

function renderStatus(value: GitSessionStatus): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)

  act(() => {
    root.render(createElement(SessionGitStatus, { status: value }))
  })

  return container
}

describe('Git status display helpers', () => {
  it('formats large values compactly while keeping small values exact', () => {
    expect(formatGitCount(0)).toBe('0')
    expect(formatGitCount(999)).toBe('999')
    expect(formatGitCount(1_600)).toBe('1.6k')
    expect(formatGitCount(12_000)).toBe('12k')
    expect(formatGitCount(1_200_000)).toBe('1.2m')
  })

  it('uses explicit clean and exact hover labels', () => {
    expect(gitStatusChangesLabel(response({ additions: 0, deletions: 0 }))).toBe('Clean')
    expect(gitStatusAccessibleLabel(response())).toBe(
      'Branch feature/sidebar · 12 additions · 3 deletions · 2 commits ahead of upstream'
    )
  })
})

describe('SessionGitStatus', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  })

  afterEach(() => {
    act(() => {
      roots.splice(0).forEach((root) => root.unmount())
    })
    containers.splice(0).forEach((container) => container.remove())
    document.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  it('shows the branch, non-zero line changes, and commits ahead', () => {
    const container = renderStatus(status({ response: response({ additions: 1_600, deletions: 1_200 }) }))
    const summary = container.querySelector('[data-testid="session-git-status"]')

    expect(summary?.textContent).toContain('feature/sidebar')
    expect(summary?.textContent).toContain('+1.6k')
    expect(summary?.textContent).toContain('−1.2k')
    expect(summary?.textContent).toContain('↑2')
    expect(summary?.getAttribute('title')).toContain('2 commits ahead of upstream')
  })

  it('hides zero-valued indicators for a clean repository', () => {
    const container = renderStatus(status({ response: response({ additions: 0, deletions: 0, commitsAhead: 0 }) }))
    const summary = container.querySelector('[data-testid="session-git-status"]')

    expect(summary?.textContent).toBe('feature/sidebar')
    expect(summary?.textContent).not.toContain('+')
    expect(summary?.textContent).not.toContain('−')
    expect(summary?.textContent).not.toContain('↑')
  })

  it('stays empty for a non-repository and shows genuine errors', () => {
    const nonRepository = renderStatus(status({
      response: response({ repository: false, branch: null, additions: 0, deletions: 0, commitsAhead: null })
    }))
    expect(nonRepository.textContent).toBe('')

    const error = renderStatus(status({ response: null, error: 'Could not read Git status.' }))
    const errorIndicator = error.querySelector('[data-testid="session-git-error"]')
    expect(errorIndicator?.textContent).toBe('Git error')
    expect(errorIndicator?.getAttribute('title')).toBe('Could not read Git status.')
  })
})
