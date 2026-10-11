import { describe, expect, it } from 'vitest'
import type { OpenCodeTuiInstanceStatus, Session } from '../src/shared/types'
import { collectOpenCodeTuiOverviewEntries } from '../src/renderer/lib/opencode-tui-instances'
import {
  groupAgentsBySession,
  miniAgentChips,
  summarizeAgents
} from '../src/renderer/lib/mini-agents'
import type { SessionTerminalLayout } from '../src/renderer/terminal/layout'

function session(id: string, name: string, color?: Session['color']): Session {
  return {
    id,
    projectId: 'project-1',
    name,
    ...(color ? { color } : {}),
    kind: 'native',
    path: `/workspace/${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    tabs: [{
      id: `${id}-tab`,
      name: 'Main',
      layout: {
        layout: 'columns',
        panes: [{ id: 'pane-1' }, { id: 'pane-2' }],
        sizes: { columnRatio: 0.5, rowRatio: 0.5 }
      }
    }],
    activeTabId: `${id}-tab`
  }
}

function layout(id: string): Record<string, SessionTerminalLayout> {
  return {
    [`${id}-tab`]: {
      layout: 'columns',
      panes: [{ terminalId: id }, { terminalId: `${id}:split:1` }],
      sizes: { columnRatio: 0.5, rowRatio: 0.5 }
    }
  }
}

const sessions = [session('s1', 'API', 'blue'), session('s2', 'Web'), session('s3', 'Docs')]
const layouts = { s1: layout('s1'), s2: layout('s2'), s3: layout('s3') }

const instances: Record<string, OpenCodeTuiInstanceStatus[]> = {
  s1: [
    { terminalId: 's1:split:1', status: 'attention', attentionReason: 'question', revision: 4 },
    { terminalId: 's1', status: 'working', revision: 3 }
  ],
  s2: [{ terminalId: 's2', status: 'completed', revision: 2 }],
  s3: []
}

const entries = collectOpenCodeTuiOverviewEntries(sessions, instances, layouts)

describe('groupAgentsBySession', () => {
  it('groups agents under their session in workspace order, skipping sessions without agents', () => {
    const groups = groupAgentsBySession(entries, sessions)

    expect(groups.map((group) => group.sessionId)).toEqual(['s1', 's2'])
    expect(groups.map((group) => group.sessionName)).toEqual(['API', 'Web'])
  })

  it('keeps pane order inside a group rather than sorting by status', () => {
    const [first] = groupAgentsBySession(entries, sessions)

    expect(first?.entries.map((entry) => entry.instance.terminalId)).toEqual(['s1', 's1:split:1'])
    expect(first?.entries.map((entry) => entry.instance.status)).toEqual(['working', 'attention'])
  })

  it('carries a custom session color and omits the default one', () => {
    const [api, web] = groupAgentsBySession(entries, sessions)

    expect(api?.color).toBe('blue')
    expect(web).not.toHaveProperty('color')
  })

  it('returns no groups when nothing is reported', () => {
    expect(groupAgentsBySession([], sessions)).toEqual([])
  })
})

describe('summarizeAgents', () => {
  it('counts each non-idle status', () => {
    expect(summarizeAgents(entries)).toEqual({ working: 1, attention: 1, completed: 1, error: 0 })
  })

  it('does not count idle agents', () => {
    const idle = collectOpenCodeTuiOverviewEntries(
      sessions,
      { s1: [{ terminalId: 's1', status: 'idle', revision: 0 }] },
      layouts
    )

    expect(summarizeAgents(idle)).toEqual({ working: 0, attention: 0, completed: 0, error: 0 })
    expect(miniAgentChips(summarizeAgents(idle))).toEqual([])
  })
})

describe('miniAgentChips', () => {
  it('lists non-zero counts with the most urgent first', () => {
    expect(miniAgentChips({ working: 2, attention: 1, completed: 3, error: 1 })).toEqual([
      { key: 'attention', label: '1 needs input', tone: 'accent' },
      { key: 'working', label: '2 working', tone: 'accent' },
      { key: 'completed', label: '3 done', tone: 'ok' },
      { key: 'error', label: '1 failed', tone: 'danger' }
    ])
  })

  it('omits zero counts', () => {
    expect(miniAgentChips({ working: 0, attention: 0, completed: 2, error: 0 })).toEqual([
      { key: 'completed', label: '2 done', tone: 'ok' }
    ])
  })
})
