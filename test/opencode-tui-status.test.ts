import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  aggregateTuiStatuses,
  classifyTuiPluginSource,
  collectTuiInstanceStatuses,
  OpenCodeTuiStatusManager,
  parseTuiPluginVersion,
  parseTuiStatusSnapshot,
  TUI_STATUS_PLUGIN_MARKER,
  TUI_STATUS_PLUGIN_SOURCE,
  TUI_STATUS_PLUGIN_VERSION,
  TUI_STATUS_PROTOCOL,
  TUI_STATUS_TITLE_MAX_LENGTH
} from '../src/main/opencode/tui-status'
import {
  openCodeStatusLabel,
  openCodeStatusShortLabel
} from '../src/renderer/lib/opencode-tui-status'

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

  it('normalizes and bounds optional session titles', () => {
    const title = `  Checkout\n${'x'.repeat(TUI_STATUS_TITLE_MAX_LENGTH * 2)}  `
    expect(
      parseTuiStatusSnapshot(
        { protocol: 1, status: 'working', title, revision: 2, updatedAt: 10_000 },
        10_000
      )
    ).toMatchObject({
      title: `Checkout ${'x'.repeat(TUI_STATUS_TITLE_MAX_LENGTH - 'Checkout '.length)}`
    })
    expect(
      parseTuiStatusSnapshot(
        { protocol: 1, status: 'working', title: { unsafe: true }, revision: 2, updatedAt: 10_000 },
        10_000
      )
    ).toBeNull()
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

  it('keeps live split-pane instances separate from the aggregate status', () => {
    expect(
      collectTuiInstanceStatuses(
        [
          {
            sessionId: 'session-1',
            terminalId: 'session-1',
            snapshot: {
              protocol: 1,
              status: 'working',
              title: 'Checkout flow',
              revision: 2,
              updatedAt: 10
            }
          },
          {
            sessionId: 'session-1',
            terminalId: 'session-1:split:1',
            snapshot: { protocol: 1, status: 'completed', revision: 4, updatedAt: 10 }
          },
          {
            sessionId: 'session-2',
            terminalId: 'session-2',
            snapshot: { protocol: 1, status: 'idle', revision: 0, updatedAt: 10 }
          }
        ],
        'session-1'
      )
    ).toEqual([
      {
        terminalId: 'session-1',
        status: 'working',
        title: 'Checkout flow',
        revision: 2
      },
      {
        terminalId: 'session-1:split:1',
        status: 'completed',
        revision: 4
      }
    ])
  })

  it('ships an inert, dependency-free plugin with the expected event vocabulary', () => {
    expect(TUI_STATUS_PLUGIN_SOURCE).toContain(TUI_STATUS_PLUGIN_MARKER)
    expect(TUI_STATUS_PLUGIN_SOURCE).toContain(
      `mde-opencode-tui-status-plugin-version: ${TUI_STATUS_PLUGIN_VERSION}`
    )
    expect(TUI_STATUS_PLUGIN_SOURCE).toContain("!file.startsWith('/tmp/mde-opencode/')")
    expect(TUI_STATUS_PLUGIN_SOURCE).toContain("event?.type === 'permission.asked'")
    expect(TUI_STATUS_PLUGIN_SOURCE).toContain("event?.type === 'question.asked'")
    expect(TUI_STATUS_PLUGIN_SOURCE).toContain("event?.type === 'session.created'")
    expect(TUI_STATUS_PLUGIN_SOURCE).toContain('info.parentID')
    expect(TUI_STATUS_PLUGIN_SOURCE).toContain('title')
    expect(TUI_STATUS_PLUGIN_SOURCE).toContain("value.replace(/\\s+/g, ' ')")
    expect(TUI_STATUS_PLUGIN_SOURCE).not.toContain('prompt')
  })

  it('classifies owned plugin versions without claiming unrelated files', () => {
    expect(parseTuiPluginVersion(TUI_STATUS_PLUGIN_SOURCE)).toBe(TUI_STATUS_PLUGIN_VERSION)
    expect(classifyTuiPluginSource(null)).toBe('not-installed')
    expect(classifyTuiPluginSource('export const SomeoneElsesPlugin = async () => ({})')).toBe('conflict')
    expect(classifyTuiPluginSource(`// ${TUI_STATUS_PLUGIN_MARKER}`)).toBe('outdated')
    expect(classifyTuiPluginSource(TUI_STATUS_PLUGIN_SOURCE)).toBe('installed')
  })

  it('defaults global reporting off and persists the enable choice', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'mde-opencode-tui-'))
    try {
      const first = new OpenCodeTuiStatusManager({ onStatus: vi.fn(), onInstances: vi.fn() })
      await first.configure(directory)
      expect(first.settings()).toMatchObject({
        enabled: false,
        instanceLabelMode: 'numbered'
      })

      await first.setEnabled(true)
      await first.setInstanceLabelMode('title')
      const second = new OpenCodeTuiStatusManager({ onStatus: vi.fn(), onInstances: vi.fn() })
      await second.configure(directory)
      expect(second.settings()).toMatchObject({
        enabled: true,
        currentPluginVersion: TUI_STATUS_PLUGIN_VERSION,
        instanceLabelMode: 'title'
      })
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('provides the accessible status description for each state', () => {
    expect(openCodeStatusLabel('idle')).toBe('OpenCode idle')
    expect(openCodeStatusLabel('working')).toBe('OpenCode is working')
    expect(openCodeStatusLabel('attention', 'permission')).toBe('OpenCode is waiting for permission')
    expect(openCodeStatusLabel('attention', 'question')).toBe('OpenCode is asking a question')
    expect(openCodeStatusLabel('completed')).toBe('OpenCode finished')
    expect(openCodeStatusLabel('error')).toBe('OpenCode request failed')
  })

  it('provides the compact status label used by the sidebar', () => {
    expect(openCodeStatusShortLabel('idle')).toBe('idle')
    expect(openCodeStatusShortLabel('working')).toBe('working')
    expect(openCodeStatusShortLabel('attention')).toBe('needs input')
    expect(openCodeStatusShortLabel('completed')).toBe('done')
    expect(openCodeStatusShortLabel('error')).toBe('failed')
  })
})
