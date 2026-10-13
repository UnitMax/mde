// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/renderer/terminal/sessions', () => ({ disposeSession: vi.fn() }))

import { TerminalPaneHighlight } from '../src/renderer/components/TerminalPaneHighlight'
import { TERMINAL_HIGHLIGHT_MS } from '../src/renderer/lib/terminal-highlight'
import { useWorkspace } from '../src/renderer/store/workspace'

const roots: Root[] = []
const containers: HTMLDivElement[] = []

function renderHighlight(terminalId: string): HTMLDivElement {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)

  act(() => {
    root.render(createElement(TerminalPaneHighlight, { terminalId }))
  })
  return container
}

function highlight(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-testid="terminal-pane-highlight"]')
}

describe('TerminalPaneHighlight', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    useWorkspace.setState({ terminalHighlights: {} })
  })

  afterEach(() => {
    act(() => {
      roots.splice(0).forEach((root) => root.unmount())
    })
    containers.splice(0).forEach((container) => container.remove())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('renders nothing while the pane has no flash', () => {
    const container = renderHighlight('s:1')

    expect(highlight(container)).toBeNull()
  })

  it('draws a decorative overlay in the flash tone', () => {
    useWorkspace.getState().flashTerminal('s:1', 'done')
    const container = renderHighlight('s:1')
    const overlay = highlight(container)

    expect(overlay).not.toBeNull()
    expect(overlay?.dataset.tone).toBe('done')
    expect(overlay?.getAttribute('aria-hidden')).toBe('true')
    expect(overlay?.className).toContain('terminal-pane-highlight')
  })

  it('only draws the pane it was asked for', () => {
    useWorkspace.getState().flashTerminal('s:2', 'error')
    const container = renderHighlight('s:1')

    expect(highlight(container)).toBeNull()
  })

  it('clears the flash once the animation is over', () => {
    useWorkspace.getState().flashTerminal('s:1', 'attention')
    const container = renderHighlight('s:1')
    expect(highlight(container)).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(TERMINAL_HIGHLIGHT_MS + 200)
    })

    expect(highlight(container)).toBeNull()
    expect(useWorkspace.getState().terminalHighlights).toEqual({})
  })

  it('restarts the animation for a repeat flash without the first timer cancelling it', () => {
    useWorkspace.getState().flashTerminal('s:1', 'attention')
    const container = renderHighlight('s:1')
    const first = highlight(container)

    act(() => {
      vi.advanceTimersByTime(1000)
      useWorkspace.getState().flashTerminal('s:1', 'done')
    })
    const second = highlight(container)
    expect(second).not.toBe(first)
    expect(second?.dataset.tone).toBe('done')

    act(() => {
      vi.advanceTimersByTime(TERMINAL_HIGHLIGHT_MS - 500)
    })
    expect(highlight(container)).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(700)
    })
    expect(highlight(container)).toBeNull()
  })

  it('drops a flash left behind by an unmounted pane instead of replaying it', () => {
    useWorkspace.getState().flashTerminal('s:1', 'done')
    vi.advanceTimersByTime(TERMINAL_HIGHLIGHT_MS + 500)

    const container = renderHighlight('s:1')
    expect(highlight(container)).toBeNull()

    act(() => {
      vi.advanceTimersByTime(10)
    })
    expect(useWorkspace.getState().terminalHighlights).toEqual({})
  })
})
