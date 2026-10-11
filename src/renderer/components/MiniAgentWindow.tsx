import { Bot, Maximize2 } from 'lucide-react'
import type {
  OpenCodeTuiInstanceLabelMode,
  OpenCodeTuiInstanceStatus,
  OpenCodeTuiStatus,
  Session
} from '@shared/types'
import { sessionColorHex } from '@shared/session-colors'
import { OpenCodeStatusIcon } from '@/components/OpenCodeStatusIcon'
import { cn } from '@/lib/utils'
import {
  collectOpenCodeTuiOverviewEntries,
  openCodeTuiInstanceLabel
} from '@/lib/opencode-tui-instances'
import {
  groupAgentsBySession,
  miniAgentChips,
  summarizeAgents,
  type MiniAgentChipTone
} from '@/lib/mini-agents'
import { openCodeOverviewStatusLabel, openCodeStatusLabel } from '@/lib/opencode-tui-status'
import type { SessionTerminalLayout } from '@/terminal/layout'

const ROW_TINT: Partial<Record<OpenCodeTuiStatus, string>> = {
  attention: 'bg-accent/10',
  completed: 'bg-ok/10',
  error: 'bg-danger/10'
}

const CHIP_TONE: Record<MiniAgentChipTone, string> = {
  accent: 'bg-accent/15 text-accent',
  ok: 'bg-ok/15 text-ok',
  danger: 'bg-danger/15 text-danger'
}

export function MiniAgentWindow({
  sessions,
  opencodeTuiInstances,
  terminalLayouts,
  labelMode,
  onRestore,
  onFocusAgent
}: {
  sessions: readonly Session[]
  opencodeTuiInstances: Readonly<Record<string, readonly OpenCodeTuiInstanceStatus[]>>
  terminalLayouts: Readonly<Record<string, Readonly<Record<string, SessionTerminalLayout>>>>
  labelMode: OpenCodeTuiInstanceLabelMode
  onRestore: () => void
  onFocusAgent: (sessionId: string, tabId: string, terminalId: string) => void
}): JSX.Element {
  const entries = collectOpenCodeTuiOverviewEntries(sessions, opencodeTuiInstances, terminalLayouts)
  const groups = groupAgentsBySession(entries, sessions)
  const chips = miniAgentChips(summarizeAgents(entries))

  return (
    <div
      data-testid="mini-agent-window"
      className="flex h-full w-full flex-col overflow-hidden bg-bg text-fg"
    >
      <header className="shrink-0 border-b border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <Bot className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
          <h1 className="min-w-0 flex-1 truncate text-[12px] font-medium">Agents</h1>
          <span className="text-[11px] text-fg-subtle" data-testid="mini-agent-count">
            {entries.length}
          </span>
          <button
            type="button"
            data-testid="mini-agent-restore"
            onClick={onRestore}
            title="Restore the full window (F12)"
            aria-label="Restore the full window"
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-fg-muted hover:bg-hover hover:text-fg"
          >
            <Maximize2 className="h-3 w-3" />
            <span className="text-[10px] leading-none">F12</span>
          </button>
        </div>
        {chips.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1" data-testid="mini-agent-summary">
            {chips.map((chip) => (
              <span
                key={chip.key}
                data-testid={`mini-agent-chip-${chip.key}`}
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-medium leading-none',
                  CHIP_TONE[chip.tone]
                )}
              >
                {chip.label}
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {groups.length === 0 ? (
          <div
            data-testid="mini-agent-empty"
            className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center"
          >
            <Bot className="h-5 w-5 text-fg-subtle" />
            <p className="text-[12px] text-fg-muted">No agents reported</p>
            <p className="text-[11px] text-fg-subtle">
              Enable OpenCode status reporting in Terminal settings to see agents here.
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <section
              key={group.sessionId}
              data-testid="mini-agent-group"
              aria-label={group.sessionName}
              className="px-1.5 pb-1"
            >
              <div className="flex items-center gap-1.5 px-1.5 pb-0.5 pt-1.5">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-sm border border-line-strong"
                  style={{ backgroundColor: sessionColorHex(group.color) }}
                />
                <h2 className="min-w-0 flex-1 truncate text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                  {group.sessionName}
                </h2>
              </div>
              <div className="space-y-0.5">
                {group.entries.map((entry) => {
                  const { instance } = entry
                  const label = openCodeTuiInstanceLabel(
                    instance,
                    entry.orderedIndex,
                    labelMode,
                    entry.layout
                  )
                  const statusLabel = openCodeOverviewStatusLabel(
                    instance.status,
                    instance.attentionReason
                  )
                  return (
                    <button
                      key={instance.terminalId}
                      type="button"
                      data-testid="mini-agent-row"
                      data-status={instance.status}
                      title={`${label} · ${entry.sessionName} · ${entry.tabName} · ${openCodeStatusLabel(
                        instance.status,
                        instance.attentionReason
                      )}`}
                      onClick={() => onFocusAgent(entry.sessionId, entry.tabId, instance.terminalId)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-fg-muted hover:bg-hover hover:text-fg',
                        ROW_TINT[instance.status]
                      )}
                    >
                      <OpenCodeStatusIcon
                        status={instance.status}
                        attentionReason={instance.attentionReason}
                        testId="mini-agent-status"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-fg">{label}</div>
                        <div className="truncate text-[10px] text-fg-subtle">{entry.tabName}</div>
                      </div>
                      <span className="shrink-0 text-[10px] text-fg-subtle">{statusLabel}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  )
}
