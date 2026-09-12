import type {
  CodexTuiInstanceStatus,
  CodexTuiStatus,
  OpenCodeTuiAttentionReason,
  OpenCodeTuiInstanceLabelMode,
  OpenCodeTuiInstanceStatus,
  OpenCodeTuiStatus,
  Session
} from '@shared/types'
import type { SessionTerminalLayout } from '@/terminal/layout'
import { sessionTabs } from '@/terminal/tabs'

export type AgentProvider = 'opencode' | 'codex'
export type AgentTuiStatus = OpenCodeTuiStatus | CodexTuiStatus

export interface AgentTuiInstanceStatus {
  provider: AgentProvider
  terminalId: string
  status: AgentTuiStatus
  attentionReason?: OpenCodeTuiAttentionReason
  title?: string
  revision: number
}

export interface AgentTuiStatusState {
  provider: AgentProvider
  status: AgentTuiStatus
  attentionReason?: OpenCodeTuiAttentionReason
  revision: number
  unread: boolean
}

export interface AgentTuiOverviewEntry {
  sessionId: string
  sessionName: string
  tabId: string
  tabName: string
  instance: AgentTuiInstanceStatus
  layout: SessionTerminalLayout
  orderedIndex: number
}

export function agentProviderLabel(provider: AgentProvider): string {
  return provider === 'codex' ? 'Codex' : 'OpenCode'
}

export function asOpenCodeAgentInstances(
  instances: readonly OpenCodeTuiInstanceStatus[]
): AgentTuiInstanceStatus[] {
  return instances.map((instance) => ({ provider: 'opencode', ...instance }))
}

export function asCodexAgentInstances(
  instances: readonly CodexTuiInstanceStatus[]
): AgentTuiInstanceStatus[] {
  return instances.map((instance) => ({ provider: 'codex', ...instance }))
}

export function combinedAgentTuiInstances(
  opencodeInstances: readonly OpenCodeTuiInstanceStatus[] = [],
  codexInstances: readonly CodexTuiInstanceStatus[] = []
): AgentTuiInstanceStatus[] {
  return [
    ...asOpenCodeAgentInstances(opencodeInstances),
    ...asCodexAgentInstances(codexInstances)
  ]
}

function statusPriority(status: AgentTuiStatus): number {
  switch (status) {
    case 'attention':
    case 'permission':
      return 5
    case 'working':
      return 4
    case 'interrupted':
    case 'error':
      return 3
    case 'completed':
      return 2
    case 'idle':
      return 1
    case 'closed':
      return 0
  }
}

export function combinedAgentTuiStatus(
  opencodeStatus: AgentTuiStatusState | undefined,
  codexStatus: AgentTuiStatusState | undefined
): AgentTuiStatusState | undefined {
  const candidates = [opencodeStatus, codexStatus].filter(
    (status): status is AgentTuiStatusState => status !== undefined
  )
  const selected = candidates.reduce<AgentTuiStatusState | undefined>((best, candidate) => {
    if (!best) return candidate
    if (statusPriority(candidate.status) > statusPriority(best.status)) return candidate
    if (candidate.revision > best.revision) return candidate
    return best
  }, undefined)
  if (!selected) return undefined

  const unread = candidates.some((candidate) => candidate.unread)
  if ((selected.status === 'completed' || selected.status === 'error' || selected.status === 'interrupted') && !unread) {
    return { ...selected, status: 'idle', unread: false }
  }
  return { ...selected, unread }
}

function orderAgentTuiInstances(
  instances: readonly AgentTuiInstanceStatus[],
  layout?: SessionTerminalLayout
): AgentTuiInstanceStatus[] {
  const positions = new Map(
    layout?.panes.map((pane, index) => [pane.terminalId, index]) ?? []
  )
  return [...instances].sort((a, b) => {
    const aPosition = positions.get(a.terminalId) ?? Number.MAX_SAFE_INTEGER
    const bPosition = positions.get(b.terminalId) ?? Number.MAX_SAFE_INTEGER
    if (aPosition !== bPosition) return aPosition - bPosition
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
    return a.terminalId.localeCompare(b.terminalId)
  })
}

export function collectAgentTuiOverviewEntries(
  sessions: readonly Session[],
  opencodeInstancesBySession: Readonly<Record<string, readonly OpenCodeTuiInstanceStatus[]>>,
  codexInstancesBySession: Readonly<Record<string, readonly CodexTuiInstanceStatus[]>>,
  terminalLayouts: Readonly<Record<string, Readonly<Record<string, SessionTerminalLayout>>>>
): AgentTuiOverviewEntry[] {
  return sessions.flatMap((session) => {
    const instances = combinedAgentTuiInstances(
      opencodeInstancesBySession[session.id] ?? [],
      codexInstancesBySession[session.id] ?? []
    )
    return sessionTabs(session).flatMap((tab) => {
      const layout = terminalLayouts[session.id]?.[tab.id]
      if (!layout) return []

      const tabInstances = instances.filter((instance) =>
        layout.panes.some((pane) => pane.terminalId === instance.terminalId)
      )
      return orderAgentTuiInstances(tabInstances, layout).map((instance, orderedIndex) => ({
        sessionId: session.id,
        sessionName: session.name,
        tabId: tab.id,
        tabName: tab.name,
        instance,
        layout,
        orderedIndex
      }))
    })
  })
}

export function agentTuiInstanceLabel(
  instance: AgentTuiInstanceStatus,
  orderedIndex: number,
  mode: OpenCodeTuiInstanceLabelMode,
  layout?: SessionTerminalLayout
): string {
  const paneIndex = layout?.panes.findIndex((pane) => pane.terminalId === instance.terminalId) ?? -1
  const fallback = `${agentProviderLabel(instance.provider)} ${paneIndex >= 0 ? paneIndex + 1 : orderedIndex + 1}`
  return mode === 'title' && instance.title?.trim() ? instance.title.trim() : fallback
}

export function agentTuiStatusLabel(
  provider: AgentProvider,
  status: AgentTuiStatus,
  attentionReason?: OpenCodeTuiAttentionReason
): string {
  const name = agentProviderLabel(provider)
  if (provider === 'codex') {
    if (status === 'permission') return `${name} is waiting for permission`
    if (status === 'interrupted') return `${name} was interrupted`
    if (status === 'closed') return `${name} closed`
  }
  if (status === 'attention') {
    return attentionReason === 'question'
      ? `${name} is asking a question`
      : `${name} is waiting for permission`
  }
  if (status === 'working') return `${name} is working`
  if (status === 'completed') return `${name} finished`
  if (status === 'error') return `${name} request failed`
  return `${name} idle`
}

export function agentTuiStatusShortLabel(status: AgentTuiStatus): string {
  if (status === 'working') return 'working'
  if (status === 'attention') return 'needs input'
  if (status === 'completed') return 'done'
  if (status === 'error') return 'failed'
  if (status === 'permission') return 'permission'
  if (status === 'interrupted') return 'interrupted'
  if (status === 'closed') return 'closed'
  return 'idle'
}

export function agentTuiOverviewStatusLabel(
  status: AgentTuiStatus,
  attentionReason?: OpenCodeTuiAttentionReason
): string {
  if (status === 'working') return 'Working'
  if (status === 'attention') {
    return attentionReason === 'question' ? 'Waiting for an answer' : 'Needs input'
  }
  if (status === 'completed') return 'Done'
  if (status === 'error') return 'Failed'
  if (status === 'permission') return 'Needs permission'
  if (status === 'interrupted') return 'Interrupted'
  if (status === 'closed') return 'Closed'
  return 'Idle'
}

export function agentTuiVisualStatus(
  provider: AgentProvider,
  status: AgentTuiStatus
): OpenCodeTuiStatus {
  if (provider === 'codex') {
    if (status === 'permission') return 'attention'
    if (status === 'interrupted') return 'completed'
    if (status === 'closed') return 'idle'
  }
  return status as OpenCodeTuiStatus
}

export function countAgentTuiNotifications(
  opencodeInstances: readonly OpenCodeTuiInstanceStatus[] = [],
  codexInstances: readonly CodexTuiInstanceStatus[] = [],
  opencodeReadRevisions: Readonly<Record<string, number>> = {},
  codexReadRevisions: Readonly<Record<string, number>> = {}
): number {
  const count = (instances: readonly (OpenCodeTuiInstanceStatus | CodexTuiInstanceStatus)[], readRevisions: Readonly<Record<string, number>>): number =>
    instances.reduce((total, instance) => {
      if (instance.status === 'attention' || instance.status === 'permission') return total + 1
      if (
        (instance.status === 'completed' || instance.status === 'interrupted') &&
        readRevisions[instance.terminalId] !== instance.revision
      ) {
        return total + 1
      }
      return total
    }, 0)

  return count(opencodeInstances, opencodeReadRevisions) + count(codexInstances, codexReadRevisions)
}

export function agentTerminalIds(
  opencodeInstances: readonly OpenCodeTuiInstanceStatus[] = [],
  codexInstances: readonly CodexTuiInstanceStatus[] = []
): Set<string> {
  return new Set(combinedAgentTuiInstances(opencodeInstances, codexInstances).map((instance) => instance.terminalId))
}
