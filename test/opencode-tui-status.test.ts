import { describe, expect, it } from 'vitest'
import {
  aggregateTuiStatuses,
  parseTuiStatusSnapshot,
  TUI_STATUS_PLUGIN_MARKER,
  TUI_STATUS_PLUGIN_SOURCE,
  TUI_STATUS_PROTOCOL
} from '../src/main/opencode/tui-status'

describe('OpenCode TUI status protocol', () => {
  it('accepts fresh privacy-safe snapshots', () => {
    expect(
      parseTuiStatusSnapshot(
        {
          protocol: TUI_STATUS_PROTOCOL,
          status: 'attention',
          attentionReason: 'question',
          revision: 4,
          updatedAt: 10_000
        },
        10_500
      )
    ).toEqual({
      protocol: 1,
      status: 'attention',
      attentionReason: 'question',
      revision: 4,
      updatedAt: 10_000
    })
  })

  it('rejects stale, malformed, and incomplete snapshots', () => {
    expect(
      parseTuiStatusSnapshot(
        { protocol: 1, status: 'working', revision: 1, updatedAt: 1_000 },
        10_000
      )
    ).toBeNull()
    expect(parseTuiStatusSnapshot({ protocol: 1, status: 'attention', revision: 1, updatedAt: 10_000 }, 10_000)).toBeNull()
    expect(parseTuiStatusSnapshot({ protocol: 2, status: 'idle', revision: 1, updatedAt: 10_000 }, 10_000)).toBeNull()
  })

  it('prioritizes attention and activity across split panes', () => {
    expect(
      aggregateTuiStatuses([
        { protocol: 1, status: 'completed', revision: 5, updatedAt: 10 },
        { protocol: 1, status: 'working', revision: 2, updatedAt: 10 },
        {
          protocol: 1,
          status: 'attention',
          attentionReason: 'permission',
          revision: 3,
          updatedAt: 10
        }
      ])
    ).toEqual({ status: 'attention', attentionReason: 'permission', revision: 3 })
  })

  it('ships an inert, dependency-free plugin with the expected event vocabulary', () => {
    expect(TUI_STATUS_PLUGIN_SOURCE).toContain(TUI_STATUS_PLUGIN_MARKER)
    expect(TUI_STATUS_PLUGIN_SOURCE).toContain("!file.startsWith('/tmp/mde-opencode/')")
    expect(TUI_STATUS_PLUGIN_SOURCE).toContain("event?.type === 'permission.asked'")
    expect(TUI_STATUS_PLUGIN_SOURCE).toContain("event?.type === 'question.asked'")
    expect(TUI_STATUS_PLUGIN_SOURCE).not.toContain('prompt')
  })
})
