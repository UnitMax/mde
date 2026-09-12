// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalFullscreenIndicator } from '../src/renderer/components/TerminalFullscreenIndicator'

const roots: Root[] = []
const containers: HTMLDivElement[] = []

function renderIndicator(isFullscreen: boolean): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)

  act(() => {
    root.render(createElement(TerminalFullscreenIndicator, { isFullscreen }))
  })

  return { container, root }
}

describe('TerminalFullscreenIndicator', () => {
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

  it('renders an accessible status badge in fullscreen', () => {
    const { container } = renderIndicator(true)
    const indicator = container.querySelector<HTMLElement>('[data-testid="terminal-fullscreen-indicator"]')

    expect(indicator?.textContent).toBe('Fullscreen')
    expect(indicator?.getAttribute('role')).toBe('status')
    expect(indicator?.getAttribute('aria-label')).toBe('Terminal is in fullscreen')
    expect(indicator?.getAttribute('title')).toBe('Terminal is in fullscreen')
  })

  it('renders nothing outside fullscreen and removes the badge when fullscreen ends', () => {
    const { container, root } = renderIndicator(false)
    expect(container.querySelector('[data-testid="terminal-fullscreen-indicator"]')).toBeNull()
    expect(container.textContent).toBe('')

    act(() => {
      root.render(createElement(TerminalFullscreenIndicator, { isFullscreen: true }))
    })
    expect(container.querySelector('[data-testid="terminal-fullscreen-indicator"]')).not.toBeNull()

    act(() => {
      root.render(createElement(TerminalFullscreenIndicator, { isFullscreen: false }))
    })
    expect(container.querySelector('[data-testid="terminal-fullscreen-indicator"]')).toBeNull()
    expect(container.textContent).toBe('')
  })
})
