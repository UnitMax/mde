import type { InboxThread, OpenCodeModelRef } from '@shared/types'
import { matchSubsequence, queryTokens } from '@/lib/fuzzy-search'

export type InboxFilter = 'all' | 'unread' | 'attention' | 'archived'

export const INBOX_FILTERS: ReadonlyArray<{ id: InboxFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'attention', label: 'Needs input' },
  { id: 'archived', label: 'Archived' }
]

/** Relative times in the list are refreshed this often. */
export const INBOX_CLOCK_MS = 30_000

export function isInboxThreadUnread(thread: InboxThread): boolean {
  return thread.lastActivityAt > thread.readAt
}

/** Unread threads outside the archive, for the tab badge. */
export function countUnreadInboxThreads(threads: readonly InboxThread[]): number {
  return threads.filter((thread) => !thread.archived && isInboxThreadUnread(thread)).length
}

export function inboxModelLabel(model: OpenCodeModelRef | undefined): string | null {
  if (!model) return null
  return model.variant ? `${model.id} (${model.variant})` : model.id
}

/** The last path segment, for both POSIX and Windows paths. */
export function inboxFolderLabel(directory: string): string {
  const trimmed = directory.replace(/[\\/]+$/, '')
  const segment = trimmed.split(/[\\/]/).pop()
  return segment || directory
}

export interface InboxStatusChip {
  label: string
  tone: 'accent' | 'ok' | 'danger' | 'muted'
}

export function inboxStatusChip(thread: InboxThread): InboxStatusChip | null {
  switch (thread.status) {
    case 'attention':
      return {
        label: thread.attentionReason === 'permission' ? 'Needs permission' : 'Needs input',
        tone: 'accent'
      }
    case 'working':
      return { label: 'Working', tone: 'muted' }
    case 'completed':
      return { label: 'Done', tone: 'ok' }
    case 'error':
      return { label: 'Failed', tone: 'danger' }
    default:
      return null
  }
}

function matchesFilter(thread: InboxThread, filter: InboxFilter): boolean {
  if (filter === 'archived') return thread.archived
  if (thread.archived) return false
  if (filter === 'unread') return isInboxThreadUnread(thread)
  if (filter === 'attention') return thread.status === 'attention'
  return true
}

function searchFields(thread: InboxThread): string[] {
  const model = thread.model ? `${thread.model.providerId}/${thread.model.id}` : ''
  return [thread.title, thread.directory, thread.branch ?? '', model]
}

/** Filters, then searches title, folder, branch and model; newest activity first. */
export function visibleInboxThreads(
  threads: readonly InboxThread[],
  filter: InboxFilter,
  query: string
): InboxThread[] {
  const tokens = queryTokens(query)
  return threads
    .filter((thread) => matchesFilter(thread, filter))
    .filter((thread) => {
      const fields = searchFields(thread)
      return tokens.every((token) => fields.some((field) => matchSubsequence(token, field)))
    })
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}

export type InboxLockReason = 'unsupported' | 'disabled'

/**
 * The Inbox is filled by the OpenCode status plugin, which runs on macOS and in
 * WSL on Windows, and only while global status reporting is on.
 */
export function inboxLockReason(
  platform: { platform: string; isWindows: boolean } | null,
  wslAvailable: boolean,
  reportingEnabled: boolean
): InboxLockReason | null {
  const supported = platform?.platform === 'darwin' || (platform?.isWindows === true && wslAvailable)
  if (!supported) return 'unsupported'
  return reportingEnabled ? null : 'disabled'
}
