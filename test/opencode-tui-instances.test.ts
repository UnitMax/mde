import { describe, expect, it } from 'vitest'
import type { OpenCodeTuiInstanceStatus } from '../src/shared/types'
import {
  openCodeTuiInstanceLabel,
  orderOpenCodeTuiInstances
} from '../src/renderer/lib/opencode-tui-instances'
import type { SessionTerminalLayout } from '../src/renderer/terminal/layout'

const layout: SessionTerminalLayout = {
  layout: 'three',
  panes: [
    { terminalId: 'session-1:split:2', primary: false },
    { terminalId: 'session-1', primary: true },
    { terminalId: 'session-1:split:1', primary: false }
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

describe('OpenCode TUI instance sidebar helpers', () => {
  it('orders instances by the visible terminal pane order', () => {
    expect(orderOpenCodeTuiInstances(instances, layout).map((instance) => instance.terminalId)).toEqual([
      'session-1:split:2',
      'session-1',
      'session-1:split:1'
    ])
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
})
