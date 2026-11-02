import type { InboxGitInfo, InboxThread, OpenCodeModelRef, OpenCodePluginTarget, Session } from '@shared/types'
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

/** How long the cue for new activity on the open thread lasts; its animations take about this long. */
export const INBOX_CUE_MS = 2200

/** Whether a cue started at `at` (a time from `Date.now()`) is still showing. */
export function inboxCueActive(at: number | undefined, now = Date.now()): boolean {
  return at !== undefined && now - at < INBOX_CUE_MS
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

/**
 * The folder a thread belongs to, for labels: the one it was started in, even when it runs in a
 * worktree whose own directory is only a random id.
 */
export function inboxThreadHome(thread: Pick<InboxThread, 'directory' | 'worktree'>): string {
  return thread.worktree?.repository ?? thread.directory
}

/** Whether a thread's worktree is still used by another thread, such as a fork of it. */
export function inboxWorktreeShared(thread: InboxThread, threads: readonly InboxThread[]): boolean {
  const worktree = thread.worktree
  if (!worktree) return false
  return threads.some((other) =>
    other.id !== thread.id &&
    other.worktree?.root === worktree.root &&
    other.target.kind === thread.target.kind &&
    (other.target.kind === 'native' || (thread.target.kind === 'wsl' && other.target.distro === thread.target.distro)))
}

/**
 * The branch a new worktree starts from until one is picked: the folder's current branch, else
 * `main` or `master`, else the first local branch, else whatever branch there is.
 */
export function defaultWorktreeBase(info: InboxGitInfo): string | null {
  const local = info.branches.filter((branch) => !branch.remote).map((branch) => branch.name)
  const names = info.branches.map((branch) => branch.name)
  if (info.branch && local.includes(info.branch)) return info.branch
  return ['main', 'master'].find((name) => local.includes(name)) ?? local[0] ?? names[0] ?? null
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

/**
 * The Inbox talks to OpenCode's background service, which MDE reaches on macOS and, on Windows,
 * inside WSL. Everywhere else it is locked.
 */
export function inboxLocked(
  platform: { platform: string; isWindows: boolean } | null,
  wslAvailable: boolean
): boolean {
  return !(platform?.platform === 'darwin' || (platform?.isWindows === true && wslAvailable))
}

/**
 * The folder of an Inbox thread or new-thread folder, shaped like a session so the file tree and
 * viewer can show it. The ID is the thread's or folder's own; the main process resolves it.
 */
export function inboxFileRoot(
  source: { id: string; directory: string; target: OpenCodePluginTarget; worktree?: { repository: string } } & { name?: string }
): Session {
  return {
    id: source.id,
    projectId: '',
    name: source.name ?? inboxFolderLabel(source.worktree?.repository ?? source.directory),
    kind: source.target.kind,
    ...(source.target.kind === 'wsl' ? { distro: source.target.distro } : {}),
    path: source.directory,
    createdAt: ''
  }
}
