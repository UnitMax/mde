import { describe, expect, it } from 'vitest'
import type { OpenCodeTuiInstanceStatus } from '../src/shared/types'
import { countOpenCodeTuiNotifications } from '../src/renderer/lib/opencode-tui-notifications'

function instance(
  status: OpenCodeTuiInstanceStatus['status'],
  terminalId: string,
  revision = 1
): OpenCodeTuiInstanceStatus {
  return { terminalId, status, revision }
}

describe('OpenCode TUI notification counts', () => {
  it('counts attention agents and unread completions, not general live agents', () => {
    expect(
      countOpenCodeTuiNotifications(
        [
          instance('working', 'working'),
          instance('idle', 'idle'),
          instance('error', 'error'),
          instance('attention', 'question'),
          instance('attention', 'permission'),
          instance('completed', 'done')
        ],
        {}
      )
    ).toBe(3)
  })

  it('marks only the exact completed revision as read', () => {
    const completed = instance('completed', 'agent', 4)

    expect(countOpenCodeTuiNotifications([completed], { agent: 4 })).toBe(0)
    expect(countOpenCodeTuiNotifications([completed], { agent: 3 })).toBe(1)
    expect(countOpenCodeTuiNotifications([instance('completed', 'agent', 5)], { agent: 4 })).toBe(1)
  })

  it('counts each agent once even when multiple agents need attention', () => {
    expect(
      countOpenCodeTuiNotifications(
        [instance('attention', 'agent-1'), instance('attention', 'agent-2')],
        {}
      )
    ).toBe(2)
  })
})
