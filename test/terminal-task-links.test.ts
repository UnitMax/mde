import { describe, expect, it } from 'vitest'
import type { Session } from '../src/shared/types'
import type { SessionTerminalLayout } from '../src/renderer/terminal/layout'
import {
  liveTerminalDescriptors,
  taskIdForTerminal,
  terminalIdForTask,
  terminalTaskBadgeModel
} from '../src/renderer/lib/terminal-task-links'

const session: Session = {
  id: 'session-1',
  projectId: 'project-1',
  name: 'App',
  kind: 'native',
  path: '/workspace/app',
  createdAt: '2026-01-01T00:00:00.000Z',
  tabs: [{
    id: 'tab-1',
    name: 'Main',
    layout: {
      layout: 'three',
      panes: [
        { id: 'pane-1', title: 'API' },
        { id: 'pane-2' },
        { id: 'pane-3' }
      ],
      sizes: { columnRatio: 0.5, rowRatio: 0.5 }
    }
  }],
  activeTabId: 'tab-1'
}

const layout: SessionTerminalLayout = {
  layout: 'three',
  panes: [
    { terminalId: 'session-1:tab:tab-1:pane:pane-1', paneId: 'pane-1', title: 'API' },
    { terminalId: 'session-1:tab:tab-1:pane:pane-2', paneId: 'pane-2' },
    { terminalId: 'session-1:tab:tab-1:pane:pane-3', paneId: 'pane-3' }
  ],
  sizes: { columnRatio: 0.5, rowRatio: 0.5 }
}

describe('runtime terminal task links', () => {
  it('indexes links in both directions', () => {
    const links = { 'terminal-1': 'task-1', 'terminal-2': 'task-2' }

    expect(taskIdForTerminal(links, 'terminal-1')).toBe('task-1')
    expect(terminalIdForTask(links, 'task-2')).toBe('terminal-2')
    expect(terminalIdForTask(links, 'missing')).toBeNull()
  })

  it('returns only running panes and derives custom terminal labels', () => {
    const terminals = liveTerminalDescriptors({
      sessions: [session],
      terminalLayouts: { [session.id]: { 'tab-1': layout } },
      statuses: {
        'session-1:tab:tab-1:pane:pane-1': 'running',
        'session-1:tab:tab-1:pane:pane-2': 'exited',
        'session-1:tab:tab-1:pane:pane-3': 'none'
      },
      opencodeTuiInstances: {}
    })

    expect(terminals.map((terminal) => terminal.label)).toEqual(['API'])
    expect(terminals[0]).toMatchObject({
      sessionId: 'session-1',
      tabId: 'tab-1',
      status: 'running'
    })
  })

  it('uses status-only OpenCode badges and marks working as animated', () => {
    const terminal = liveTerminalDescriptors({
      sessions: [session],
      terminalLayouts: { [session.id]: { 'tab-1': layout } },
      statuses: { 'session-1:tab:tab-1:pane:pane-1': 'running' },
      opencodeTuiInstances: {
        [session.id]: [{
          terminalId: 'session-1:tab:tab-1:pane:pane-1',
          status: 'working',
          title: 'Checkout flow',
          revision: 1
        }]
      }
    })[0]!

    expect(terminalTaskBadgeModel(terminal)).toMatchObject({
      label: 'working',
      status: 'working',
      description: 'OpenCode is working',
      working: true
    })
  })

  it('uses the regular terminal label when OpenCode reporting is absent', () => {
    const terminal = liveTerminalDescriptors({
      sessions: [session],
      terminalLayouts: { [session.id]: { 'tab-1': layout } },
      statuses: { 'session-1:tab:tab-1:pane:pane-1': 'running' },
      opencodeTuiInstances: {}
    })[0]!

    expect(terminalTaskBadgeModel(terminal)).toEqual({
      label: 'API',
      description: 'API terminal',
      working: false
    })
  })
})
