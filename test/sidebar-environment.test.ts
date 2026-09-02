// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../src/shared/types'
import { SessionEnvironmentPanel } from '../src/renderer/components/SessionEnvironmentPanel'
import type { GitSessionStatus } from '../src/renderer/store/workspace'

const roots: Root[] = []
const containers: HTMLDivElement[] = []

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    projectId: 'project-1',
    name: 'Frontend',
    kind: 'native',
    path: '/workspace/frontend',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function renderPanel(value: Session, gitStatus?: GitSessionStatus): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)

  act(() => {
    root.render(
      createElement(
        SessionEnvironmentPanel,
        {
          session: value,
          gitStatus,
          children: createElement(
            'button',
            { type: 'button', 'data-testid': 'session-trigger' },
            value.name
          )
        }
      )
    )
  })

  return container
}

function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="session-environment-panel"]')
}

describe('SessionEnvironmentPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
  })

  afterEach(() => {
    act(() => {
      roots.splice(0).forEach((root) => root.unmount())
    })
    containers.splice(0).forEach((container) => container.remove())
    document.body.replaceChildren()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps WSL distribution out of the closed session content', () => {
    const value = session({ kind: 'wsl', distro: 'Ubuntu-24.04' })
    const container = renderPanel(value)

    expect(container.textContent).toContain(value.name)
    expect(container.textContent).not.toContain(value.distro)
    expect(panel()).toBeNull()
  })

  it('shows runtime, distribution, and full directory on WSL hover', () => {
    const value = session({ kind: 'wsl', distro: 'Ubuntu-24.04' })
    const container = renderPanel(value)
    const trigger = container.querySelector<HTMLElement>('[data-testid="session-trigger"]')
    if (!trigger) throw new Error('Session trigger was not rendered')

    act(() => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    expect(panel()).toBeNull()
    act(() => {
      vi.advanceTimersByTime(180)
    })

    const environmentPanel = panel()
    expect(environmentPanel).not.toBeNull()
    expect(environmentPanel?.getAttribute('role')).toBe('tooltip')
    expect(environmentPanel?.textContent).toContain('WSL')
    expect(environmentPanel?.textContent).toContain('Ubuntu-24.04')
    expect(environmentPanel?.textContent).toContain('/workspace/frontend')
    expect(trigger.getAttribute('aria-describedby')).toBe(environmentPanel?.id)
    expect(environmentPanel?.getAttribute('title')).toBeNull()
  })

  it('shows native runtime without a distribution field', () => {
    const value = session()
    const container = renderPanel(value)
    const trigger = container.querySelector<HTMLElement>('[data-testid="session-trigger"]')
    if (!trigger) throw new Error('Session trigger was not rendered')

    act(() => {
      trigger.focus()
    })

    const environmentPanel = panel()
    expect(environmentPanel?.textContent).toContain('Native')
    expect(environmentPanel?.textContent).not.toContain('Distribution')
    expect(environmentPanel?.textContent).toContain(value.path)
  })

  it('shows Git details in the environment hover for repositories', () => {
    const container = renderPanel(session(), {
      response: {
        repository: true,
        branch: 'feature/sidebar',
        additions: 12,
        deletions: 3,
        commitsAhead: 2,
        commitsBehind: null
      },
      error: null,
      loading: false
    })
    const trigger = container.querySelector<HTMLElement>('[data-testid="session-trigger"]')
    if (!trigger) throw new Error('Session trigger was not rendered')

    act(() => trigger.focus())

    const environmentPanel = panel()
    expect(environmentPanel?.textContent).toContain('feature/sidebar')
    expect(environmentPanel?.textContent).toContain('+12 −3')
    expect(environmentPanel?.textContent).toContain('2 commits')
  })

  it('closes after the focused trigger loses focus', () => {
    const container = renderPanel(session())
    const trigger = container.querySelector<HTMLElement>('[data-testid="session-trigger"]')
    if (!trigger) throw new Error('Session trigger was not rendered')

    act(() => {
      trigger.focus()
    })
    expect(panel()).not.toBeNull()

    act(() => {
      trigger.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }))
      vi.advanceTimersByTime(120)
    })

    expect(panel()).toBeNull()
  })
})
