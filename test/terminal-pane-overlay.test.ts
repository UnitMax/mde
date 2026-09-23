// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalPaneOverlay } from '../src/renderer/components/TerminalPaneOverlay'

const roots: Root[] = []
const containers: HTMLDivElement[] = []

function renderOverlay(props: {
  visible: boolean
  number: number | null
  active: boolean
  isFullscreen: boolean
}): HTMLDivElement {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)

  act(() => {
    root.render(createElement(TerminalPaneOverlay, props))
  })

  return container
}

describe('TerminalPaneOverlay', () => {
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

  it('renders nothing while hidden', () => {
    const container = renderOverlay({ visible: false, number: 1, active: true, isFullscreen: false })
    expect(container.textContent).toBe('')
  })

  it('shows the fullscreen hint only on the focused pane', () => {
    const active = renderOverlay({ visible: true, number: 2, active: true, isFullscreen: false })
    expect(active.querySelector('[data-testid="terminal-pane-overlay-number"]')?.textContent).toBe('2')
    expect(active.querySelector('[data-testid="terminal-pane-overlay-fullscreen"]')?.textContent)
      .toBe('Ctrl+Shift+F · Fullscreen')

    const inactive = renderOverlay({ visible: true, number: 3, active: false, isFullscreen: false })
    expect(inactive.querySelector('[data-testid="terminal-pane-overlay-number"]')?.textContent).toBe('3')
    expect(inactive.querySelector('[data-testid="terminal-pane-overlay-fullscreen"]')).toBeNull()
  })

  it('shows only the exit hint in fullscreen', () => {
    const container = renderOverlay({ visible: true, number: null, active: true, isFullscreen: true })
    expect(container.querySelector('[data-testid="terminal-pane-overlay-number"]')).toBeNull()
    expect(container.querySelector('[data-testid="terminal-pane-overlay-fullscreen"]')?.textContent)
      .toBe('Ctrl+Shift+F · Exit fullscreen')
  })

  it('renders nothing for an unfocused pane without a number', () => {
    const container = renderOverlay({ visible: true, number: null, active: false, isFullscreen: true })
    expect(container.querySelector('[data-testid="terminal-pane-overlay"]')).toBeNull()
  })
})
