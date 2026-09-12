import { describe, expect, it } from 'vitest'
import {
  agentTuiStatusLabel,
  agentTuiVisualStatus,
  combinedAgentTuiStatus,
  countAgentTuiNotifications
} from '../src/renderer/lib/agent-tui'

describe('shared agent status presentation', () => {
  it('keeps Codex permission and interruption labels provider-specific', () => {
    expect(agentTuiStatusLabel('codex', 'permission')).toBe('Codex is waiting for permission')
    expect(agentTuiStatusLabel('codex', 'interrupted')).toBe('Codex was interrupted')
    expect(agentTuiVisualStatus('codex', 'permission')).toBe('attention')
    expect(agentTuiVisualStatus('codex', 'interrupted')).toBe('completed')
  })

  it('lets an active permission state outrank a completed provider state', () => {
    expect(combinedAgentTuiStatus(
      { provider: 'opencode', status: 'completed', revision: 4, unread: true },
      { provider: 'codex', status: 'permission', revision: 2, unread: false }
    )).toMatchObject({ provider: 'codex', status: 'permission', unread: true })
  })

  it('counts Codex permission and unread interruption notifications', () => {
    expect(countAgentTuiNotifications(
      [],
      [
        { terminalId: 'codex:permission', status: 'permission', revision: 1 },
        { terminalId: 'codex:interrupted', status: 'interrupted', revision: 2 }
      ],
      {},
      { 'codex:interrupted': 1 }
    )).toBe(2)
  })
})
