import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  aggregateTuiStatuses,
  classifyTuiPluginSource,
  collectTuiInstanceStatuses,
  OpenCodeTuiStatusManager,
  parseLinuxProcessStartTicks,
  parseTuiPluginVersion,
  parseTuiStatusSnapshot,
  TUI_STATUS_HEARTBEAT_MS,
  TUI_STATUS_LIVENESS_PROBE_MS,
  TUI_STATUS_PLUGIN_MARKER,
  TUI_STATUS_PLUGIN_SOURCE,
  TUI_STATUS_PLUGIN_VERSION,
  TUI_STATUS_POLL_MS,
  TUI_STATUS_PROTOCOL,
  TUI_STATUS_STALE_MS,
  TUI_STATUS_TITLE_MAX_LENGTH,
  tuiProcessProbeCommand
} from '../src/main/opencode/tui-status'
import {
  openCodeOverviewStatusLabel,
  openCodeStatusLabel,
  openCodeStatusShortLabel
} from '../src/renderer/lib/opencode-tui-status'

function managerInternals(manager: OpenCodeTuiStatusManager): {
  runtimes: Map<string, Record<string, unknown>>
  poll(terminalId: string): Promise<void>
} {
  return manager as unknown as {
    runtimes: Map<string, Record<string, unknown>>
    poll(terminalId: string): Promise<void>
  }
}

function installRuntime(manager: OpenCodeTuiStatusManager): void {
  managerInternals(manager).runtimes.set('terminal-1', {
    sessionId: 'session-1',
    terminalId: 'terminal-1',
    distro: 'Ubuntu',
    wslPath: '/tmp/mde-opencode/status.json',
    windowsPath: '\\\\wsl.localhost\\Ubuntu\\tmp\\mde-opencode\\status.json',
    timer: undefined,
    snapshot: null,
    lastHeartbeatAt: null,
    lastProbeAt: null,
    pollInFlight: false,
    probeInFlight: false
  })
}

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
        1_000 + TUI_STATUS_STALE_MS + 1
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

  it('ships a lower-rate heartbeat with explicit process lifecycle metadata', () => {
    expect(TUI_STATUS_HEARTBEAT_MS).toBe(5_000)
    expect(TUI_STATUS_POLL_MS).toBe(1_000)
    expect(TUI_STATUS_STALE_MS).toBe(20_000)
    expect(TUI_STATUS_LIVENESS_PROBE_MS).toBe(10_000)
    expect(TUI_STATUS_PLUGIN_SOURCE).toContain('processStartTicks')
    expect(TUI_STATUS_PLUGIN_SOURCE).toContain('dispose: async')
    expect(TUI_STATUS_PLUGIN_SOURCE).toContain('await write(true)')
  })

  it('accepts an explicit close record even after its heartbeat has expired', () => {
    expect(
      parseTuiStatusSnapshot(
        {
          protocol: 1,
          status: 'completed',
          revision: 3,
          updatedAt: 1_000,
          processId: 42,
          processStartTicks: 88,
          closed: true
        },
        1_000 + TUI_STATUS_STALE_MS + 1
      )
    ).toMatchObject({ closed: true, processId: 42, processStartTicks: 88 })
  })

  it('parses the Linux process start tick without trusting the process name', () => {
    expect(
      parseLinuxProcessStartTicks('42 (opencode worker) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 12345')
    ).toBe(12345)
    expect(parseLinuxProcessStartTicks('42 (broken')).toBeNull()
  })

  it('builds a process probe with a validated direct argument', () => {
    expect(tuiProcessProbeCommand(42)).toEqual([
      '/bin/sh',
      '-c',
      expect.stringContaining('/proc/$1/stat'),
      'mde-opencode-tui',
      '42'
    ])
    expect(tuiProcessProbeCommand(0)).toBeNull()
    expect(tuiProcessProbeCommand(Number.NaN)).toBeNull()
  })

  it('keeps a working agent visible through multi-minute heartbeat-only periods', async () => {
    let now = 100_000
    const onInstances = vi.fn()
    const onStatus = vi.fn()
    const readStatusFile = vi.fn(async () => JSON.stringify({
      protocol: 1,
      status: 'working',
      revision: 1,
      updatedAt: now,
      processId: 42,
      processStartTicks: 88
    }))
    const probeProcess = vi.fn(async () => 'alive' as const)
    const manager = new OpenCodeTuiStatusManager(
      { onInstances, onStatus },
      {
        now: () => now,
        readStatusFile,
        probeProcess,
        unlinkStatusFile: vi.fn(async () => {})
      }
    )
    installRuntime(manager)

    await managerInternals(manager).poll('terminal-1')
    for (let index = 0; index < 60; index += 1) {
      now += TUI_STATUS_HEARTBEAT_MS
      await managerInternals(manager).poll('terminal-1')
    }

    expect(onInstances).toHaveBeenCalledTimes(1)
    expect(onInstances).toHaveBeenLastCalledWith({
      sessionId: 'session-1',
      instances: [{ terminalId: 'terminal-1', status: 'working', revision: 1 }]
    })
    expect(probeProcess).not.toHaveBeenCalled()
  })

  it('retains a working agent when the status read fails or the process probe confirms it is alive', async () => {
    let now = 100_000
    let failRead = false
    const onInstances = vi.fn()
    const probeProcess = vi.fn(async () => 'alive' as const)
    const manager = new OpenCodeTuiStatusManager(
      { onInstances, onStatus: vi.fn() },
      {
        now: () => now,
        readStatusFile: async () => {
          if (failRead) throw new Error('UNC bridge unavailable')
          return JSON.stringify({
            protocol: 1,
            status: 'working',
            revision: 1,
            updatedAt: 100_000,
            processId: 42,
            processStartTicks: 88
          })
        },
        probeProcess,
        unlinkStatusFile: vi.fn(async () => {})
      }
    )
    installRuntime(manager)

    await managerInternals(manager).poll('terminal-1')
    failRead = true
    now += TUI_STATUS_STALE_MS
    await managerInternals(manager).poll('terminal-1')

    expect(onInstances).toHaveBeenCalledTimes(1)
    expect(probeProcess).toHaveBeenCalledWith('Ubuntu', 42, 88)
  })

  it('serializes polling while a UNC read is still pending', async () => {
    let now = 100_000
    let resolveRead: ((value: string) => void) | undefined
    const readStatusFile = vi.fn(() => new Promise<string>((resolve) => {
      resolveRead = resolve
    }))
    const manager = new OpenCodeTuiStatusManager(
      { onInstances: vi.fn(), onStatus: vi.fn() },
      {
        now: () => now,
        readStatusFile,
        probeProcess: vi.fn(async () => 'alive' as const),
        unlinkStatusFile: vi.fn(async () => {})
      }
    )
    installRuntime(manager)

    const first = managerInternals(manager).poll('terminal-1')
    await Promise.resolve()
    const second = managerInternals(manager).poll('terminal-1')
    expect(readStatusFile).toHaveBeenCalledTimes(1)

    resolveRead?.(JSON.stringify({
      protocol: 1,
      status: 'working',
      revision: 1,
      updatedAt: now,
      processId: 42,
      processStartTicks: 88
    }))
    await Promise.all([first, second])
  })

  it('removes a crashed process but keeps legacy snapshots conservatively', async () => {
    let now = 100_000
    let heartbeat = true
    const onInstances = vi.fn()
    const probeProcess = vi.fn(async () => 'absent' as const)
    const manager = new OpenCodeTuiStatusManager(
      { onInstances, onStatus: vi.fn() },
      {
        now: () => now,
        readStatusFile: async () => JSON.stringify({
          protocol: 1,
          status: 'working',
          revision: 1,
          updatedAt: heartbeat ? now : 100_000,
          processId: 42,
          processStartTicks: 88
        }),
        probeProcess,
        unlinkStatusFile: vi.fn(async () => {})
      }
    )
    installRuntime(manager)

    await managerInternals(manager).poll('terminal-1')
    heartbeat = false
    now += TUI_STATUS_STALE_MS
    await managerInternals(manager).poll('terminal-1')
    expect(onInstances).toHaveBeenLastCalledWith({ sessionId: 'session-1', instances: [] })

    const legacyInstances = vi.fn()
    const legacyManager = new OpenCodeTuiStatusManager(
      { onInstances: legacyInstances, onStatus: vi.fn() },
      {
        now: () => now,
        readStatusFile: async () => JSON.stringify({
          protocol: 1,
          status: 'working',
          revision: 1,
          updatedAt: heartbeat ? now : 100_000
        }),
        probeProcess,
        unlinkStatusFile: vi.fn(async () => {})
      }
    )
    installRuntime(legacyManager)
    heartbeat = true
    await managerInternals(legacyManager).poll('terminal-1')
    heartbeat = false
    now += TUI_STATUS_STALE_MS
    await managerInternals(legacyManager).poll('terminal-1')
    expect(probeProcess).toHaveBeenCalledTimes(1)
    expect(legacyInstances).toHaveBeenCalledTimes(1)
  })

  it('removes an explicit close record without waiting for a process probe', async () => {
    let now = 100_000
    let closed = false
    const onInstances = vi.fn()
    const probeProcess = vi.fn(async () => 'alive' as const)
    const manager = new OpenCodeTuiStatusManager(
      { onInstances, onStatus: vi.fn() },
      {
        now: () => now,
        readStatusFile: async () => JSON.stringify({
          protocol: 1,
          status: 'completed',
          revision: 2,
          updatedAt: closed ? now - TUI_STATUS_STALE_MS - 1 : now,
          processId: 42,
          processStartTicks: 88,
          ...(closed ? { closed: true } : {})
        }),
        probeProcess,
        unlinkStatusFile: vi.fn(async () => {})
      }
    )
    installRuntime(manager)

    await managerInternals(manager).poll('terminal-1')
    closed = true
    now += TUI_STATUS_POLL_MS
    await managerInternals(manager).poll('terminal-1')

    expect(onInstances).toHaveBeenLastCalledWith({ sessionId: 'session-1', instances: [] })
    expect(probeProcess).not.toHaveBeenCalled()
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

  it('provides the readable status labels used by the agent overview', () => {
    expect(openCodeOverviewStatusLabel('working')).toBe('Working')
    expect(openCodeOverviewStatusLabel('attention', 'permission')).toBe('Needs input')
    expect(openCodeOverviewStatusLabel('attention', 'question')).toBe('Waiting for an answer')
    expect(openCodeOverviewStatusLabel('completed')).toBe('Done')
    expect(openCodeOverviewStatusLabel('idle')).toBe('Idle')
    expect(openCodeOverviewStatusLabel('error')).toBe('Failed')
  })
})
