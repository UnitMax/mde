// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  OpenCodeTuiInstanceLabelMode,
  OpenCodeTuiInstanceStatus,
  Session
} from '../src/shared/types'
import { MiniAgentWindow } from '../src/renderer/components/MiniAgentWindow'
import type { SessionTerminalLayout } from '../src/renderer/terminal/layout'

const roots: Root[] = []
const containers: HTMLDivElement[] = []

function session(id: string, name: string): Session {
  return {
    id,
    projectId: 'project-1',
    name,
    kind: 'native',
    path: `/workspace/${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    tabs: [{
      id: `${id}-tab`,
      name: `${name} tab`,
      layout: {
        layout: 'columns',
        panes: [{ id: 'pane-1' }, { id: 'pane-2' }],
        sizes: { columnRatio: 0.5, rowRatio: 0.5 }
      }
    }],
    activeTabId: `${id}-tab`
  }
}

function layouts(...ids: string[]): Record<string, Record<string, SessionTerminalLayout>> {
  return Object.fromEntries(ids.map((id) => [id, {
    [`${id}-tab`]: {
      layout: 'columns',
      panes: [{ terminalId: id }, { terminalId: `${id}:split:1` }],
      sizes: { columnRatio: 0.5, rowRatio: 0.5 }
    }
  }]))
}

const sessions = [session('s1', 'API'), session('s2', 'Web')]
const instances: Record<string, OpenCodeTuiInstanceStatus[]> = {
  s1: [
    { terminalId: 's1', status: 'working', title: 'Fix login', revision: 1 },
    { terminalId: 's1:split:1', status: 'attention', attentionReason: 'question', revision: 2 }
  ],
  s2: [{ terminalId: 's2', status: 'error', revision: 3 }]
}

function renderWindow(options: {
  instances?: Record<string, OpenCodeTuiInstanceStatus[]>
  labelMode?: OpenCodeTuiInstanceLabelMode
  onRestore?: () => void
  onFocusAgent?: (sessionId: string, tabId: string, terminalId: string) => void
} = {}): HTMLElement {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)

  act(() => {
    root.render(createElement(MiniAgentWindow, {
      sessions,
      opencodeTuiInstances: options.instances ?? instances,
      terminalLayouts: layouts('s1', 's2'),
      labelMode: options.labelMode ?? 'numbered',
      onRestore: options.onRestore ?? vi.fn(),
      onFocusAgent: options.onFocusAgent ?? vi.fn()
    }))
  })

  return container
}

const text = (element: Element | null | undefined): string => element?.textContent?.trim() ?? ''

describe('MiniAgentWindow', () => {
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

  it('lists agents grouped under their session with tab and status', () => {
    const container = renderWindow()
    const groups = Array.from(container.querySelectorAll('[data-testid="mini-agent-group"]'))

    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['API', 'Web'])
    const rows = Array.from(container.querySelectorAll('[data-testid="mini-agent-row"]'))
    expect(rows.map((row) => row.getAttribute('data-status'))).toEqual(['working', 'attention', 'error'])
    expect(text(rows[0])).toContain('OpenCode 1')
    expect(text(rows[0])).toContain('API tab')
    expect(text(rows[0])).toContain('Working')
    expect(text(rows[1])).toContain('Waiting for an answer')
    expect(text(rows[2])).toContain('Failed')
    expect(text(container.querySelector('[data-testid="mini-agent-count"]'))).toBe('3')
  })

  it('labels agents by their OpenCode title when that mode is chosen', () => {
    const container = renderWindow({ labelMode: 'title' })
    const first = container.querySelector('[data-testid="mini-agent-row"]')

    expect(text(first)).toContain('Fix login')
  })

  it('summarizes the urgent counts in chips', () => {
    const container = renderWindow()

    expect(text(container.querySelector('[data-testid="mini-agent-chip-attention"]'))).toBe('1 needs input')
    expect(text(container.querySelector('[data-testid="mini-agent-chip-working"]'))).toBe('1 working')
    expect(text(container.querySelector('[data-testid="mini-agent-chip-error"]'))).toBe('1 failed')
    expect(container.querySelector('[data-testid="mini-agent-chip-completed"]')).toBeNull()
  })

  it('tints rows that need the reader but not working ones', () => {
    const container = renderWindow()
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="mini-agent-row"]'))

    expect(rows[0]?.className).not.toMatch(/bg-(accent|ok|danger)\/10/)
    expect(rows[1]?.className).toContain('bg-accent/10')
    expect(rows[2]?.className).toContain('bg-danger/10')
  })

  it('shows an empty state with no chips when nothing is reported', () => {
    const container = renderWindow({ instances: {} })

    expect(container.querySelector('[data-testid="mini-agent-empty"]')).not.toBeNull()
    expect(text(container.querySelector('[data-testid="mini-agent-empty"]'))).toContain('No agents reported')
    expect(container.querySelector('[data-testid="mini-agent-row"]')).toBeNull()
    expect(container.querySelector('[data-testid="mini-agent-summary"]')).toBeNull()
    expect(text(container.querySelector('[data-testid="mini-agent-count"]'))).toBe('0')
  })

  it('reports the clicked agent so the caller can restore and focus it', () => {
    const onFocusAgent = vi.fn()
    const container = renderWindow({ onFocusAgent })
    const rows = container.querySelectorAll<HTMLElement>('[data-testid="mini-agent-row"]')

    act(() => rows[1]?.click())

    expect(onFocusAgent).toHaveBeenCalledOnce()
    expect(onFocusAgent).toHaveBeenCalledWith('s1', 's1-tab', 's1:split:1')
  })

  it('offers a restore button that names the shortcut', () => {
    const onRestore = vi.fn()
    const container = renderWindow({ onRestore })
    const button = container.querySelector<HTMLElement>('[data-testid="mini-agent-restore"]')

    expect(button?.getAttribute('title')).toContain('F12')
    act(() => button?.click())

    expect(onRestore).toHaveBeenCalledOnce()
  })
})
