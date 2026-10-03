import type { OpenCodeSessionSummary } from '@shared/types'
import { matchSubsequence, queryTokens } from '@/lib/fuzzy-search'
import type { TerminalLauncherShortcutInput } from '@/lib/terminal-launcher'

export function isOpenCodeSessionsShortcut(input: TerminalLauncherShortcutInput): boolean {
  return (
    (input.type === undefined || input.type === 'keydown') &&
    input.key.toLowerCase() === 'o' &&
    input.ctrlKey && !input.metaKey && !input.altKey && input.shiftKey && !input.isComposing
  )
}

export interface OpenCodeSessionGroup {
  directory: string
  sessions: OpenCodeSessionSummary[]
}

export function groupOpenCodeSessions(
  sessions: readonly OpenCodeSessionSummary[],
  query: string,
  currentDirectory?: string
): OpenCodeSessionGroup[] {
  const tokens = queryTokens(query)
  const groups = new Map<string, OpenCodeSessionSummary[]>()
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id))
  for (const session of sorted) {
    const fields = [session.title, session.directory, session.id, session.agent ?? '',
      session.model ? `${session.model.providerId}/${session.model.id}` : '']
    if (!tokens.every((token) => fields.some((field) => matchSubsequence(token, field)))) continue
    const group = groups.get(session.directory) ?? []
    group.push(session)
    groups.set(session.directory, group)
  }
  const result = Array.from(groups, ([directory, items]) => ({ directory, sessions: items }))
  const current = result.findIndex((group) => isCurrentSessionDirectory(group.directory, currentDirectory))
  if (current > 0) result.unshift(...result.splice(current, 1))
  return result
}

export function isCurrentSessionDirectory(directory: string, currentDirectory: string | undefined): boolean {
  return currentDirectory !== undefined && directory.replace(/\/+$/, '') === currentDirectory.replace(/\/+$/, '')
}

export function sessionAge(value: number, now = Date.now()): string {
  if (!Number.isFinite(new Date(value).getTime())) return 'Unknown'
  const minutes = Math.max(0, Math.floor((now - value) / 60_000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 365) return `${days}d ago`
  return `${Math.floor(days / 365)}y ago`
}

export function sessionDate(value: number): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}
