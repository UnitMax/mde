import type { InboxFolder, InboxGitInfo, InboxThread, InboxWorktree, OpenCodeModelRef, OpenCodeTarget, DirectoryContext } from '@shared/types'
import { matchSubsequence, queryTokens } from '@/lib/fuzzy-search'

export type InboxFilter = 'all' | 'unread' | 'attention' | 'archived'

export const INBOX_FILTERS: ReadonlyArray<{ id: InboxFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'attention', label: 'Needs input' },
  { id: 'archived', label: 'Parked' }
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

/** Unread threads that are not parked, for the tab badge. */
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

function sameInboxTarget(a: OpenCodeTarget, b: OpenCodeTarget): boolean {
  return a.kind === b.kind && (a.kind === 'native' || (b.kind === 'wsl' && a.distro === b.distro))
}

/**
 * The project a thread belongs to, for its name and icon. A thread in a worktree belongs to the project the
 * worktree was cut from, found by its directory; the worktree has an entry of its own that is not a project.
 * Undefined once the project has been removed from the Inbox.
 */
export function inboxThreadFolder(
  thread: Pick<InboxThread, 'folderId' | 'worktree' | 'target'>,
  folders: readonly InboxFolder[]
): InboxFolder | undefined {
  const worktree = thread.worktree
  if (!worktree) return folders.find((folder) => folder.id === thread.folderId)
  return folders.find((folder) =>
    !folder.worktree && folder.directory === worktree.repository && sameInboxTarget(folder.target, thread.target))
}

/** Whether a thread's worktree is still used by another thread, such as a fork of it. */
export function inboxWorktreeShared(thread: InboxThread, threads: readonly InboxThread[]): boolean {
  const worktree = thread.worktree
  if (!worktree) return false
  return threads.some((other) =>
    other.id !== thread.id && other.worktree?.root === worktree.root && sameInboxTarget(other.target, thread.target))
}

/**
 * The name of the Inbox folder a worktree was cut from, for labels. It is looked up by the
 * repository's directory, and falls back to that directory's last segment when the folder has since
 * been removed from the Inbox.
 */
export function inboxWorktreeSource(worktree: InboxWorktree, target: OpenCodeTarget, folders: readonly InboxFolder[]): string {
  const source = folders.find((folder) => !folder.worktree && folder.directory === worktree.repository && sameInboxTarget(folder.target, target))
  return source?.name ?? inboxFolderLabel(worktree.repository)
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

/**
 * Whether a thread is working and not parked. A thread that is
 * done, failed, waiting for an answer or a permission, or not started is not working.
 */
export function inboxThreadWorking(thread: InboxThread): boolean {
  return thread.status === 'working' && !thread.archived
}

function matchesFilter(thread: InboxThread, filter: InboxFilter, workingElsewhere: boolean): boolean {
  if (filter === 'archived') return thread.archived
  if (thread.archived) return false
  if (workingElsewhere && !thread.pinned && inboxThreadWorking(thread)) return false
  if (filter === 'unread') return isInboxThreadUnread(thread)
  if (filter === 'attention') return thread.status === 'attention'
  return true
}

function searchFields(thread: InboxThread): string[] {
  const model = thread.model ? `${thread.model.providerId}/${thread.model.id}` : ''
  return [thread.customTitle ?? '', thread.title, thread.directory, thread.branch ?? '', model]
}

function matchesQuery(thread: InboxThread, tokens: readonly string[]): boolean {
  const fields = searchFields(thread)
  return tokens.every((token) => fields.some((field) => matchSubsequence(token, field)))
}

/**
 * Filters, then searches title, folder, branch and model; pinned threads first, then newest activity
 * within each group. With `workingElsewhere` unpinned working threads are left out, because the
 * Working section shows them instead; a parked one stays under Parked.
 */
export function visibleInboxThreads(
  threads: readonly InboxThread[],
  filter: InboxFilter,
  query: string,
  workingElsewhere = false
): InboxThread[] {
  const tokens = queryTokens(query)
  return threads
    .filter((thread) => matchesFilter(thread, filter, workingElsewhere))
    .filter((thread) => matchesQuery(thread, tokens))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
      b.lastActivityAt - a.lastActivityAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}

/**
 * Unpinned threads that are working right now, for the Working section: the newest run first. The
 * section ignores the filter tabs but not the search. Pinned threads stay in the main list.
 */
export function workingInboxThreads(threads: readonly InboxThread[], query = ''): InboxThread[] {
  const started = (thread: InboxThread): number => thread.workingSince ?? thread.lastActivityAt
  const tokens = queryTokens(query)
  return threads
    .filter((thread) => !thread.pinned && inboxThreadWorking(thread) && matchesQuery(thread, tokens))
    .sort((a, b) => started(b) - started(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
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
  source: { id: string; directory: string; target: OpenCodeTarget; worktree?: { repository: string } } & { name?: string }
): DirectoryContext {
  return {
    id: source.id,
    name: source.name ?? inboxFolderLabel(source.worktree?.repository ?? source.directory),
    kind: source.target.kind,
    ...(source.target.kind === 'wsl' ? { distro: source.target.distro } : {}),
    path: source.directory,
    createdAt: ''
  }
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
