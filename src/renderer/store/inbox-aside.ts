import { create } from 'zustand'
import type { ChatAsideEntry } from '@shared/types'
import { ipcErrorMessage } from '@/lib/ipc-error'

/**
 * A side question as its card shows it (`/btw`): the question, and then the answer or why there is none.
 * It is not part of the conversation. Answered ones are kept in the thread's history by the main process.
 */
export interface ChatAside {
  /** Tells one question from the next: a number while it is being asked, the kept entry's ID once answered. */
  id: number | string
  question: string
  status: 'loading' | 'done' | 'error'
  /** The answer, in Markdown; empty until there is one. */
  answer: string
  error: string | null
  /** When the answer arrived; only an answered question has it. */
  askedAt?: number
}

/** How many answered side questions a thread keeps, as the main process does. */
export const ASIDE_HISTORY_LIMIT = 20

export interface ThreadAsides {
  /** The answered questions, oldest first. */
  history: ChatAsideEntry[]
  /** The question being asked, or the one that failed; it comes after the history. */
  pending: ChatAside | null
  /** Which one the card shows, counted through the history and then the pending one; null while the card is closed. */
  at: number | null
}

const EMPTY: ThreadAsides = { history: [], pending: null, at: null }

/** How many side questions a thread has to look at. */
export function asideCount(thread: ThreadAsides | undefined): number {
  return thread ? thread.history.length + (thread.pending ? 1 : 0) : 0
}

/** The side question a thread's card shows, or null while the card is closed. */
export function shownAside(thread: ThreadAsides | undefined): ChatAside | null {
  if (!thread || thread.at === null) return null
  const entry = thread.history[thread.at]
  if (entry) return { id: entry.id, question: entry.question, status: 'done', answer: entry.answer, error: null, askedAt: entry.askedAt }
  return thread.at === thread.history.length ? thread.pending : null
}

interface InboxAsideStore {
  /** The side questions of each thread that has any, by thread ID. */
  threads: Record<string, ThreadAsides>
  /** Reads a thread's kept history, once; later calls do nothing. */
  load: (threadId: string) => Promise<void>
  /**
   * Asks a side question about a thread and shows it. It never rejects: a failure is the question's
   * `error` state, so that the person can retry it where it is shown.
   */
  ask: (threadId: string, question: string) => Promise<void>
  /** Closes the card. The history stays; a question still being answered joins it when the answer arrives. */
  dismiss: (threadId: string) => void
  /** Opens the card on the newest side question, if the thread has any. */
  open: (threadId: string) => void
  /** Shows the question before (-1) or after (1) the one shown. */
  step: (threadId: string, by: number) => void
}

let counter = 0
const loaded = new Set<string>()

/** For tests: forgets which threads have had their history read. */
export function resetAsideLoads(): void {
  loaded.clear()
}

export const useInboxAside = create<InboxAsideStore>((set, get) => {
  const patch = (threadId: string, change: (thread: ThreadAsides) => ThreadAsides): void => {
    set((state) => ({ threads: { ...state.threads, [threadId]: change(state.threads[threadId] ?? EMPTY) } }))
  }
  /** Puts `history` in place of the thread's, keeping the card on what it shows. */
  const withHistory = (thread: ThreadAsides, history: ChatAsideEntry[]): ThreadAsides => {
    const shown = shownAside(thread)
    let at: number | null = null
    if (shown) {
      const found = history.findIndex((entry) => entry.id === shown.id)
      at = found >= 0 ? found : thread.pending && shown.id === thread.pending.id ? history.length : history.length > 0 ? history.length - 1 : null
    }
    return { ...thread, history, at }
  }
  const keep = (thread: ThreadAsides, entry: ChatAsideEntry): ChatAsideEntry[] =>
    [...thread.history.filter((kept) => kept.id !== entry.id), entry].slice(-ASIDE_HISTORY_LIMIT)

  return {
    threads: {},

    load: async (threadId) => {
      if (loaded.has(threadId)) return
      loaded.add(threadId)
      try {
        const kept = await window.api.chat.asideHistory({ threadId })
        patch(threadId, (thread) => {
          // Anything answered while the read was on its way is newer than what was read.
          const known = new Set(kept.map((entry) => entry.id))
          return withHistory(thread, [...kept, ...thread.history.filter((entry) => !known.has(entry.id))].slice(-ASIDE_HISTORY_LIMIT))
        })
      } catch {
        // No history is not worth a message; the next start of the app reads it again.
        loaded.delete(threadId)
      }
    },

    ask: async (threadId, question) => {
      const asked = question.trim()
      if (!asked) return
      counter += 1
      const id = counter
      patch(threadId, (thread) => ({
        ...thread,
        pending: { id, question: asked, status: 'loading', answer: '', error: null },
        at: thread.history.length,
      }))
      try {
        const { entry } = await window.api.chat.aside({ threadId, question: asked })
        patch(threadId, (thread) => {
          const mine = thread.pending?.id === id
          const watching = mine && thread.at === thread.history.length
          const next = withHistory(mine ? { ...thread, pending: null, at: watching ? null : thread.at } : thread, keep(thread, entry))
          // The card that showed the question being asked now shows its answer.
          return watching ? { ...next, at: next.history.length - 1 } : next
        })
      } catch (error) {
        // Replaced since it was asked, or closed: this failure is no one's now.
        patch(threadId, (thread) => thread.pending?.id !== id ? thread
          : thread.at === null ? { ...thread, pending: null }
            : { ...thread, pending: { ...thread.pending, status: 'error', error: ipcErrorMessage(error, 'Could not answer the question.') } })
      }
    },

    dismiss: (threadId) => {
      const thread = get().threads[threadId]
      if (!thread || thread.at === null) return
      // A failed question has nothing to come back to.
      patch(threadId, (current) => ({ ...current, at: null, pending: current.pending?.status === 'error' ? null : current.pending }))
    },

    open: (threadId) => {
      patch(threadId, (thread) => {
        const count = asideCount(thread)
        return count > 0 ? { ...thread, at: count - 1 } : thread
      })
    },

    step: (threadId, by) => {
      patch(threadId, (thread) => {
        if (thread.at === null) return thread
        const at = Math.min(asideCount(thread) - 1, Math.max(0, thread.at + by))
        return at === thread.at ? thread : { ...thread, at }
      })
    },
  }
})
