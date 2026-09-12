import type {
  CodexTuiInstanceStatus,
  OpenCodeTuiInstanceStatus,
  OpenCodeTuiStatus,
  PtyStatus,
  Session
} from '@shared/types'
import type { SessionTerminalLayout, TerminalPaneState } from '@/terminal/layout'
import {
  agentTuiStatusLabel,
  agentTuiStatusShortLabel,
  agentTuiVisualStatus,
  type AgentTuiInstanceStatus
} from '@/lib/agent-tui'
import { sessionTabs } from '@/terminal/tabs'
import { terminalPaneLabel } from '@/lib/terminal-instances'

export type TerminalTaskLinks = Record<string, string>

export interface LiveTerminalDescriptor {
  terminalId: string
  sessionId: string
  tabId: string
  sessionName: string
  tabName: string
  pane: TerminalPaneState
  label: string
  status: 'running'
  openCodeInstance?: OpenCodeTuiInstanceStatus
  agentInstance?: AgentTuiInstanceStatus
}

export interface LiveTerminalCatalogInput {
  sessions: readonly Session[]
  terminalLayouts: Record<string, Record<string, SessionTerminalLayout>>
  statuses: Record<string, PtyStatus>
  opencodeTuiInstances: Record<string, readonly OpenCodeTuiInstanceStatus[]>
  codexTuiInstances?: Record<string, readonly CodexTuiInstanceStatus[]>
}

export interface TerminalTaskBadgeModel {
  label: string
  status?: OpenCodeTuiStatus
  description: string
  working: boolean
}

export function terminalIdForTask(
  links: TerminalTaskLinks,
  taskId: string
): string | null {
  return Object.entries(links).find(([, linkedTaskId]) => linkedTaskId === taskId)?.[0] ?? null
}

export function taskIdForTerminal(
  links: TerminalTaskLinks,
  terminalId: string
): string | null {
  return links[terminalId] ?? null
}

export function liveTerminalDescriptors({
  sessions,
  terminalLayouts,
  statuses,
  opencodeTuiInstances,
  codexTuiInstances = {}
}: LiveTerminalCatalogInput): LiveTerminalDescriptor[] {
  return sessions.flatMap((session) =>
    sessionTabs(session).flatMap((tab) => {
      const layout = terminalLayouts[session.id]?.[tab.id]
      if (!layout) return []

      return layout.panes.flatMap((pane): LiveTerminalDescriptor[] => {
        if (statuses[pane.terminalId] !== 'running') return []
        const openCodeInstance = opencodeTuiInstances[session.id]?.find(
          (instance) => instance.terminalId === pane.terminalId
        )
        const codexInstance = codexTuiInstances[session.id]?.find(
          (instance) => instance.terminalId === pane.terminalId
        )
        return [{
          terminalId: pane.terminalId,
          sessionId: session.id,
          tabId: tab.id,
          sessionName: session.name,
          tabName: tab.name,
          pane,
          label: pane.title?.trim() || terminalPaneLabel(pane, layout),
          status: 'running',
          ...(openCodeInstance ? { openCodeInstance, agentInstance: { provider: 'opencode' as const, ...openCodeInstance } } : {}),
          ...(codexInstance ? { agentInstance: { provider: 'codex' as const, ...codexInstance } } : {})
        }]
      })
    })
  )
}

export function terminalTaskBadgeModel(
  terminal: LiveTerminalDescriptor
): TerminalTaskBadgeModel {
  const instance = terminal.agentInstance ?? (
    terminal.openCodeInstance
      ? { provider: 'opencode' as const, ...terminal.openCodeInstance }
      : undefined
  )
  if (!instance) {
    return {
      label: terminal.label,
      description: `${terminal.label} terminal`,
      working: false
    }
  }

  return {
    label: agentTuiStatusShortLabel(instance.status),
    status: agentTuiVisualStatus(instance.provider, instance.status),
    description: agentTuiStatusLabel(instance.provider, instance.status, instance.attentionReason),
    working: instance.status === 'working'
  }
}
