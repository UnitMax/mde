import type { InboxFolder, InboxThread } from '@shared/types'
import { inboxFolderLabel, inboxThreadHome } from '@/lib/inbox'

export interface MiniInboxGroup {
  folderId: string
  name: string
  directory: string
  threads: InboxThread[]
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

/** Groups the displayed threads by their Inbox folder, retaining their list order. */
export function groupThreadsByFolder(
  threads: readonly InboxThread[],
  folders: readonly InboxFolder[]
): MiniInboxGroup[] {
  const groups = new Map<string, MiniInboxGroup>()
  for (const thread of threads) {
    let group = groups.get(thread.folderId)
    if (!group) {
      const folder = folders.find((item) => item.id === thread.folderId)
      const directory = folder?.directory ?? inboxThreadHome(thread)
      group = {
        folderId: thread.folderId,
        name: folder?.name ?? inboxFolderLabel(directory),
        directory,
        threads: [],
      }
      groups.set(thread.folderId, group)
    }
    group.threads.push(thread)
  }
  return [...groups.values()]
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
