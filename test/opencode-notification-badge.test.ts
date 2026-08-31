// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenCodeNotificationBadge } from '../src/renderer/components/OpenCodeNotificationBadge'

const roots: Root[] = []
const containers: HTMLDivElement[] = []

function renderBadge(count: number): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)

  act(() => {
    root.render(createElement(OpenCodeNotificationBadge, { count }))
  })

  return container
}

describe('OpenCodeNotificationBadge', () => {
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

  it('renders no badge for an empty count', () => {
    expect(renderBadge(0).querySelector('[data-testid="opencode-notification-count"]')).toBeNull()
  })

  it('renders the exact count as an accessible round badge', () => {
    const badge = renderBadge(12).querySelector<HTMLElement>('[data-testid="opencode-notification-count"]')

    expect(badge?.textContent).toBe('12')
    expect(badge?.getAttribute('aria-label')).toBe('12 OpenCode agents finished or need attention')
    expect(badge?.className).toContain('rounded-full')
  })
})
