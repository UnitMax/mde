import { testLayout } from './helpers/terminal-layout'
import { describe, expect, it } from 'vitest'
import type { OpenCodeTuiInstanceStatus } from '../src/shared/types'
import {
  terminalPaneTitle
} from '../src/renderer/lib/opencode-tui-instances'
import type { SessionTerminalLayout } from '../src/renderer/terminal/layout'

const layout: SessionTerminalLayout = testLayout([
  { terminalId: 'session-1:split:2' },
  { terminalId: 'session-1' },
  { terminalId: 'session-1:split:1' }
])

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

describe('OpenCode TUI instance helpers', () => {
  it('uses terminal for ordinary panes and prefers conversation titles for OpenCode panes', () => {
    expect(terminalPaneTitle(undefined, layout)).toBe('terminal')
    expect(terminalPaneTitle(instances[1], layout)).toBe('Validate tax rules')
    expect(terminalPaneTitle(instances[0], layout)).toBe('OpenCode 2')
    expect(terminalPaneTitle(undefined, layout, 'API')).toBe('API')
    expect(terminalPaneTitle(instances[1], layout, 'Agent task')).toBe('Agent task')
    expect(terminalPaneTitle(instances[1], layout, '   ')).toBe('Validate tax rules')
  })

  it('names a plain shell after its folder, behind a custom title and OpenCode labels', () => {
    expect(terminalPaneTitle(undefined, layout, undefined, '/home/me/app')).toBe('app')
    expect(terminalPaneTitle(undefined, layout, '', '/home/me/app/')).toBe('app')
    expect(terminalPaneTitle(undefined, layout, undefined, null)).toBe('terminal')
    expect(terminalPaneTitle(undefined, layout, 'API', '/home/me/app')).toBe('API')
    expect(terminalPaneTitle(instances[1], layout, undefined, '/home/me/app')).toBe('Validate tax rules')
    expect(terminalPaneTitle(instances[0], layout, undefined, '/home/me/app')).toBe('OpenCode 2')
  })
})
