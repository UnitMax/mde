import type { InboxFolder, InboxFolderIcon, InboxThread } from '@shared/types'
import { inboxFolderLabel, inboxThreadFolder, inboxThreadHome } from '@/lib/inbox'

/** The project a thread belongs to, for the line under its title. */
export interface MiniInboxProject {
  name: string
  directory: string
  /** The project's icon, when it has one. */
  icon?: InboxFolderIcon
}

export interface MiniInboxSummary {
  working: number
  attention: number
  completed: number
  error: number
}

export type MiniInboxChipTone = 'accent' | 'ok' | 'danger'

export interface MiniInboxChip {
  key: keyof MiniInboxSummary
  label: string
  tone: MiniInboxChipTone
}

/**
 * The name and icon of the project a thread belongs to. A thread whose folder was removed from the Inbox is
 * labelled by the directory's name, and a worktree by the repository it was cut from.
 */
export function miniInboxProject(thread: InboxThread, folders: readonly InboxFolder[]): MiniInboxProject {
  const folder = folders.find((item) => item.id === thread.folderId)
  const directory = folder?.directory ?? inboxThreadHome(thread)
  // A worktree's own entry has no icon; its project does.
  const icon = (inboxThreadFolder(thread, folders) ?? folder)?.icon
  return {
    name: folder?.name ?? inboxFolderLabel(directory),
    directory,
    ...(icon ? { icon } : {}),
  }
}

export function summarizeThreads(threads: readonly InboxThread[]): MiniInboxSummary {
  const summary: MiniInboxSummary = { working: 0, attention: 0, completed: 0, error: 0 }
  for (const thread of threads) {
    if (thread.status !== 'idle') summary[thread.status] += 1
  }
  return summary
}

/** Chips for non-zero counts, most urgent first. Idle threads get no chip. */
export function miniInboxChips(summary: MiniInboxSummary): MiniInboxChip[] {
  const chips: MiniInboxChip[] = [
    { key: 'attention', label: `${summary.attention} needs input`, tone: 'accent' },
    { key: 'working', label: `${summary.working} working`, tone: 'accent' },
    { key: 'completed', label: `${summary.completed} done`, tone: 'ok' },
    { key: 'error', label: `${summary.error} failed`, tone: 'danger' },
  ]
  return chips.filter((chip) => summary[chip.key] > 0)
}
