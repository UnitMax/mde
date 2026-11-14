import type { InboxFolder, InboxThread, InboxWorktreeEntry } from '@shared/types'
import { sameInboxTarget } from '@/lib/inbox'

/** The worktrees of one project, for the worktree manager. */
export interface WorktreeGroup {
  /** The project's folder entry; absent when the project has since been removed from the Inbox. */
  project?: InboxFolder
  /** The project's name, or the last segment of the repository's directory. */
  name: string
  worktrees: InboxWorktreeEntry[]
}

/** The threads that run in a worktree, newest first. Threads kept after an earlier worktree at the same place was deleted are not among them. */
export function worktreeThreads(entry: InboxWorktreeEntry, threads: readonly InboxThread[]): InboxThread[] {
  return threads
    .filter((thread) => thread.worktreeRemovedAt === undefined && thread.worktree?.root === entry.root && sameInboxTarget(thread.target, entry.target))
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** When a worktree was made, as far as MDE knows: what it recorded, or its oldest thread. */
export function worktreeCreatedAt(entry: InboxWorktreeEntry, threads: readonly InboxThread[]): number | undefined {
  const times = threads.map((thread) => thread.createdAt)
  if (entry.createdAt !== undefined) times.push(entry.createdAt)
  return times.length > 0 ? Math.min(...times) : undefined
}

/** One key per worktree: its root, and where it is (two WSL distros can have the same path). */
export function worktreeKey(entry: Pick<InboxWorktreeEntry, 'target' | 'root'>): string {
  return `${entry.target.kind === 'wsl' ? `wsl:${entry.target.distro}` : 'native'}\0${entry.root}`
}

/**
 * The worktrees by the project they were cut from, projects by name; within one, the newest first. A project is
 * found by its directory and target, as the sidebar does for threads.
 */
export function groupWorktrees(
  entries: readonly InboxWorktreeEntry[],
  folders: readonly InboxFolder[],
  threads: readonly InboxThread[],
): WorktreeGroup[] {
  const groups = new Map<string, WorktreeGroup>()
  for (const entry of entries) {
    const project = folders.find((folder) => !folder.worktree && folder.directory === entry.repository && sameInboxTarget(folder.target, entry.target))
    const key = project?.id ?? `${entry.target.kind === 'wsl' ? entry.target.distro : ''}\0${entry.repository}`
    const group = groups.get(key) ?? {
      ...(project ? { project } : {}),
      name: project?.name ?? (entry.repository.split(/[\\/]/).filter(Boolean).at(-1) || entry.repository),
      worktrees: [],
    }
    group.worktrees.push(entry)
    groups.set(key, group)
  }
  const age = (entry: InboxWorktreeEntry): number => worktreeCreatedAt(entry, worktreeThreads(entry, threads)) ?? 0
  return [...groups.values()]
    .map((group) => ({ ...group, worktrees: [...group.worktrees].sort((a, b) => age(b) - age(a)) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** How long ago something happened, in a few words: "today", "yesterday", "5 days ago", "3 weeks ago", "4 months ago". */
export function worktreeAge(at: number, now = Date.now()): string {
  const days = Math.floor(Math.max(0, now - at) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  if (days < 730) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)} years ago`
}

/** What deleting some worktrees would do: the threads kept read-only, those still running, and what would be lost. */
export interface WorktreeDeletion {
  threads: InboxThread[]
  running: InboxThread[]
  /** Uncommitted files thrown away, over all of them. */
  changes: number
  /** Commits only their branches have, over all of them; lost only when the branches are deleted too. */
  unmerged: number
  /** Whether Git could count the unmerged commits of every one of them. */
  unmergedKnown: boolean
  /** The branches that would be deleted when asked. */
  branches: string[]
}

export function worktreeDeletion(entries: readonly InboxWorktreeEntry[], threads: readonly InboxThread[]): WorktreeDeletion {
  const kept = entries.flatMap((entry) => worktreeThreads(entry, threads))
  return {
    threads: kept,
    running: kept.filter((thread) => thread.status === 'working' || thread.status === 'attention'),
    changes: entries.reduce((sum, entry) => sum + (entry.missing ? 0 : entry.changes ?? 0), 0),
    unmerged: entries.reduce((sum, entry) => sum + (entry.unmerged ?? 0), 0),
    unmergedKnown: entries.every((entry) => !entry.branch || entry.unmerged !== null),
    branches: entries.flatMap((entry) => (entry.branch ? [entry.branch] : [])),
  }
}
