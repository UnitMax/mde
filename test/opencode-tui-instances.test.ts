import { describe, expect, it } from 'vitest'
import type { OpenCodeTuiInstanceStatus, Session } from '../src/shared/types'
import {
  collectOpenCodeTuiOverviewEntries,
  openCodeTuiInstanceLabel,
  orderOpenCodeTuiInstances,
  terminalPaneTitle
} from '../src/renderer/lib/opencode-tui-instances'
import type { SessionTerminalLayout } from '../src/renderer/terminal/layout'

const layout: SessionTerminalLayout = {
  layout: 'three',
  panes: [
    { terminalId: 'session-1:split:2' },
    { terminalId: 'session-1' },
    { terminalId: 'session-1:split:1' }
  ],
  sizes: { columnRatio: 0.5, rowRatio: 0.5 }
}

const instances: OpenCodeTuiInstanceStatus[] = [
  { terminalId: 'session-1', status: 'completed', revision: 2 },
  {
    terminalId: 'session-1:split:1',
    status: 'working',
    title: 'Validate tax rules',
    revision: 3
  },
  { terminalId: 'session-1:split:2', status: 'idle', revision: 0 }
]

function overviewSession(id: string, name: string, tabId: string, tabName: string): Session {
  return {
    id,
    projectId: 'project-1',
    name,
    kind: 'native',
    path: `/workspace/${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    tabs: [{
      id: tabId,
      name: tabName,
      layout: {
        layout: 'columns',
        panes: [{ id: 'pane-1' }, { id: 'pane-2' }],
        sizes: { columnRatio: 0.5, rowRatio: 0.5 }
      }
    }],
    activeTabId: tabId
  }
}

function overviewLayout(sessionId: string, tabId: string): SessionTerminalLayout {
  return {
    layout: 'columns',
    panes: [
      { terminalId: `${sessionId}:tab:${tabId}:pane:pane-2` },
      { terminalId: `${sessionId}:tab:${tabId}:pane:pane-1` }
    ],
    sizes: { columnRatio: 0.5, rowRatio: 0.5 }
  }
}

describe('OpenCode TUI instance sidebar helpers', () => {
  it('orders instances by the visible terminal pane order', () => {
    expect(orderOpenCodeTuiInstances(instances, layout).map((instance) => instance.terminalId)).toEqual([
      'session-1:split:2',
      'session-1',
      'session-1:split:1'
    ])
  })

  it('combines instances across sessions while retaining their origin and pane order', () => {
    const first = overviewSession('session-1', 'App', 'tab-1', 'Main')
    const second = overviewSession('session-2', 'Docs', 'tab-2', 'Research')
    const firstPaneOne = 'session-1:tab:tab-1:pane:pane-1'
    const firstPaneTwo = 'session-1:tab:tab-1:pane:pane-2'
    const secondPaneOne = 'session-2:tab:tab-2:pane:pane-1'

    const entries = collectOpenCodeTuiOverviewEntries(
      [second, first],
      {
        'session-1': [
          { terminalId: firstPaneOne, status: 'idle', revision: 1 },
          { terminalId: firstPaneTwo, status: 'working', revision: 2 }
        ],
        'session-2': [{ terminalId: secondPaneOne, status: 'completed', revision: 3 }],
        'missing-session': [{ terminalId: 'orphan', status: 'working', revision: 4 }]
      },
      {
        'session-1': { 'tab-1': overviewLayout('session-1', 'tab-1') },
        'session-2': { 'tab-2': overviewLayout('session-2', 'tab-2') }
      }
    )

    expect(entries.map((entry) => entry.instance.terminalId)).toEqual([
      secondPaneOne,
      firstPaneTwo,
      firstPaneOne
    ])
    expect(entries[0]).toMatchObject({
      sessionId: 'session-2',
      sessionName: 'Docs',
      tabId: 'tab-2',
      tabName: 'Research',
      orderedIndex: 0
    })
  })

  it('numbers labels by pane position and uses titles only when selected and available', () => {
    const split = instances[1]!
    expect(openCodeTuiInstanceLabel(split, 0, 'numbered', layout)).toBe('OpenCode 3')
    expect(openCodeTuiInstanceLabel(split, 0, 'title', layout)).toBe('Validate tax rules')
    expect(openCodeTuiInstanceLabel(instances[0]!, 1, 'title', layout)).toBe('OpenCode 2')
  })

  it('falls back to active-list order without layout metadata', () => {
    expect(openCodeTuiInstanceLabel(instances[0]!, 0, 'numbered')).toBe('OpenCode 1')
  })

  it('uses terminal for ordinary panes and prefers conversation titles for OpenCode panes', () => {
    expect(terminalPaneTitle(undefined, layout)).toBe('terminal')
    expect(terminalPaneTitle(instances[1], layout)).toBe('Validate tax rules')
    expect(terminalPaneTitle(instances[0], layout)).toBe('OpenCode 2')
    expect(terminalPaneTitle(undefined, layout, 'API')).toBe('API')
    expect(terminalPaneTitle(instances[1], layout, 'Agent task')).toBe('Agent task')
    expect(terminalPaneTitle(instances[1], layout, '   ')).toBe('Validate tax rules')
  })
})
