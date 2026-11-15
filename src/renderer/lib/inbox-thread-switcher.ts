import type { InboxFolder, InboxThread } from '@shared/types'
import { matchSubsequence, queryTokens } from '@/lib/fuzzy-search'
import { inboxFolderLabel, inboxThreadFolder, inboxThreadHome, inboxThreadListed, visibleInboxThreads } from '@/lib/inbox'

export type ThreadSearchField = 'title' | 'project' | 'branch'

export interface ThreadSwitcherRow {
  thread: InboxThread
  title: string
  project: string
  folder: InboxFolder | undefined
  /** Where each field matched the query, for highlighting. */
  matches: Partial<Record<ThreadSearchField, number[]>>
}

const WEIGHTS: Record<ThreadSearchField, number> = { title: 100, project: 40, branch: 30 }
/** An archived or snoozed thread is only found by typing, and comes after the listed threads that match as well. */
const PARKED_PENALTY = 60

function row(thread: InboxThread, folders: readonly InboxFolder[]): ThreadSwitcherRow {
  const folder = inboxThreadFolder(thread, folders)
  return {
    thread,
    title: thread.customTitle ?? thread.title,
    project: folder?.name ?? inboxFolderLabel(inboxThreadHome(thread)),
    folder,
    matches: {},
  }
}

/**
 * The threads Ctrl+O offers in the Inbox. With nothing typed, the threads of the sidebar list in its order (pinned
 * first, then the newest activity). Typed words search the title, the project and the branch of every thread,
 * archived and snoozed ones too, best match first.
 */
export function searchInboxThreads(threads: readonly InboxThread[], folders: readonly InboxFolder[], query: string): ThreadSwitcherRow[] {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return visibleInboxThreads(threads, 'all', '').map((thread) => row(thread, folders))

  const order = new Map(visibleInboxThreads(threads, 'all', '').map((thread, index) => [thread.id, index]))
  return threads
    .flatMap((thread) => {
      const found = row(thread, folders)
      const fields: { key: ThreadSearchField; value: string }[] = [
        { key: 'title', value: found.title },
        { key: 'project', value: found.project },
        { key: 'branch', value: thread.branch ?? '' },
      ]
      let score = inboxThreadListed(thread) ? 0 : -PARKED_PENALTY
      for (const token of tokens) {
        const best = fields
          .flatMap((field) => {
            const match = matchSubsequence(token, field.value)
            return match ? [{ field, match, score: match.score + WEIGHTS[field.key] }] : []
          })
          .sort((left, right) => right.score - left.score)[0]
        if (!best) return []
        score += best.score
        found.matches[best.field.key] = [...(found.matches[best.field.key] ?? []), ...best.match.positions]
      }
      return [{ found, score }]
    })
    .sort((left, right) =>
      right.score - left.score ||
      (order.get(left.found.thread.id) ?? Infinity) - (order.get(right.found.thread.id) ?? Infinity) ||
      right.found.thread.lastActivityAt - left.found.thread.lastActivityAt)
    .map(({ found }) => found)
}
