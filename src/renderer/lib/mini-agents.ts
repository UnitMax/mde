import type { Session, SessionColor } from '@shared/types'
import type { OpenCodeTuiOverviewEntry } from '@/lib/opencode-tui-instances'

export interface MiniAgentGroup {
  sessionId: string
  sessionName: string
  color?: SessionColor
  entries: OpenCodeTuiOverviewEntry[]
}

export interface MiniAgentSummary {
  working: number
  attention: number
  completed: number
  error: number
}

export type MiniAgentChipTone = 'accent' | 'ok' | 'danger'

export interface MiniAgentChip {
  key: keyof MiniAgentSummary
  label: string
  tone: MiniAgentChipTone
}

/**
 * Groups overview entries under their session. The entries arrive in workspace
 * order, so groups and rows keep the sidebar's order and never jump with status.
 */
export function groupAgentsBySession(
  entries: readonly OpenCodeTuiOverviewEntry[],
  sessions: readonly Session[]
): MiniAgentGroup[] {
  const groups = new Map<string, MiniAgentGroup>()
  entries.forEach((entry) => {
    let group = groups.get(entry.sessionId)
    if (!group) {
      const color = sessions.find((session) => session.id === entry.sessionId)?.color
      group = {
        sessionId: entry.sessionId,
        sessionName: entry.sessionName,
        ...(color ? { color } : {}),
        entries: []
      }
      groups.set(entry.sessionId, group)
    }
    group.entries.push(entry)
  })
  return [...groups.values()]
}

export function summarizeAgents(
  entries: readonly OpenCodeTuiOverviewEntry[]
): MiniAgentSummary {
  const summary: MiniAgentSummary = { working: 0, attention: 0, completed: 0, error: 0 }
  entries.forEach(({ instance }) => {
    if (instance.status !== 'idle') summary[instance.status] += 1
  })
  return summary
}

/** Chips for the non-zero counts, most urgent first. Idle agents get no chip. */
export function miniAgentChips(summary: MiniAgentSummary): MiniAgentChip[] {
  const chips: MiniAgentChip[] = [
    { key: 'attention', label: `${summary.attention} needs input`, tone: 'accent' },
    { key: 'working', label: `${summary.working} working`, tone: 'accent' },
    { key: 'completed', label: `${summary.completed} done`, tone: 'ok' },
    { key: 'error', label: `${summary.error} failed`, tone: 'danger' }
  ]
  return chips.filter((chip) => summary[chip.key] > 0)
}
