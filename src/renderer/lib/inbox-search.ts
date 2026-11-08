import type { ChatSearchHit, ChatSearchResponse, InboxFolder, InboxThread } from '@shared/types'

interface ShortcutInput {
  type?: string
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  isComposing?: boolean
}

/** Ctrl+Shift+F (Cmd+Shift+F on a Mac): search the text of all threads. */
export function isInboxSearchShortcut(input: ShortcutInput): boolean {
  return (
    (input.type === undefined || input.type === 'keydown') &&
    input.key.toLocaleLowerCase() === 'f' &&
    (input.ctrlKey || input.metaKey) &&
    input.shiftKey &&
    !input.altKey &&
    !input.isComposing
  )
}

/** One message found, with the thread it is in. The overlay lists these and moves between them. */
export interface InboxSearchRow {
  thread: InboxThread
  folder: InboxFolder | undefined
  hit: ChatSearchHit
  /** The first row of its thread, which has the thread's heading over it. */
  first: boolean
  /** Messages of the thread that are not listed; shown under its last row. */
  more: number
}

/** The answer as rows, in the order it is given; a thread that is no longer in the workspace is left out. */
export function searchRows(answer: ChatSearchResponse | null, threads: readonly InboxThread[], folders: readonly InboxFolder[]): InboxSearchRow[] {
  if (!answer) return []
  const byId = new Map(threads.map((thread) => [thread.id, thread]))
  const rows: InboxSearchRow[] = []
  for (const result of answer.results) {
    const thread = byId.get(result.threadId)
    if (!thread) continue
    const folder = folders.find((item) => item.id === thread.folderId)
    result.hits.forEach((hit, index) => {
      rows.push({ thread, folder, hit, first: index === 0, more: index === result.hits.length - 1 ? result.hitCount - result.hits.length : 0 })
    })
  }
  return rows
}
