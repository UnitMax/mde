import type { InboxFolder, InboxGitInfo, InboxThread, InboxWorktree, OpenCodeModelRef, OpenCodePluginTarget, Session } from '@shared/types'
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

function sameInboxTarget(a: OpenCodePluginTarget, b: OpenCodePluginTarget): boolean {
  return a.kind === b.kind && (a.kind === 'native' || (b.kind === 'wsl' && a.distro === b.distro))
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
export function inboxWorktreeSource(worktree: InboxWorktree, target: OpenCodePluginTarget, folders: readonly InboxFolder[]): string {
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
 * Whether a thread belongs in the Working section: it is working and not parked. A thread that is
 * done, failed, waiting for an answer or a permission, or not started is not working.
 */
export function inboxThreadWorking(thread: InboxThread): boolean {
  return thread.status === 'working' && !thread.archived
}

function matchesFilter(thread: InboxThread, filter: InboxFilter, workingElsewhere: boolean): boolean {
  if (filter === 'archived') return thread.archived
  if (thread.archived) return false
  if (workingElsewhere && inboxThreadWorking(thread)) return false
  if (filter === 'unread') return isInboxThreadUnread(thread)
  if (filter === 'attention') return thread.status === 'attention'
  return true
}

function searchFields(thread: InboxThread): string[] {
  const model = thread.model ? `${thread.model.providerId}/${thread.model.id}` : ''
  return [thread.title, thread.directory, thread.branch ?? '', model]
}

function matchesQuery(thread: InboxThread, tokens: readonly string[]): boolean {
  const fields = searchFields(thread)
  return tokens.every((token) => fields.some((field) => matchSubsequence(token, field)))
}

/**
 * Filters, then searches title, folder, branch and model; newest activity first. With
 * `workingElsewhere` the threads that are working are left out, because the Working section shows
 * them instead; a parked one is not working and stays under Parked.
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
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}

/**
 * The threads that are working right now, for the Working section: the newest run first. The
 * section ignores the filter tabs but not the search, since a working thread is nowhere else in
 * the Inbox to be searched for.
 */
export function workingInboxThreads(threads: readonly InboxThread[], query = ''): InboxThread[] {
  const started = (thread: InboxThread): number => thread.workingSince ?? thread.lastActivityAt
  const tokens = queryTokens(query)
  return threads
    .filter((thread) => inboxThreadWorking(thread) && matchesQuery(thread, tokens))
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
