import { create } from 'zustand'
import { ipcErrorMessage } from '@/lib/ipc-error'

/**
 * The side question a thread shows (`/btw`): the question, and then the answer or why there is none.
 * It lives here, not in the conversation: nothing about it is stored, and it is gone when the app is.
 */
export interface ChatAside {
  /** Tells one question from the next, so that a late answer to an old one is not shown as the new one's. */
  id: number
  question: string
  status: 'loading' | 'done' | 'error'
  /** The answer, in Markdown; empty until there is one. */
  answer: string
  error: string | null
}

interface InboxAsideStore {
  /** The side question of each thread that has one, by thread ID. A thread shows at most one. */
  asides: Record<string, ChatAside>
  /**
   * Asks a side question about a thread. It replaces the one the thread shows, and never rejects: a failure
   * is the question's `error` state, so that the person can retry it where it is shown.
   */
  ask: (threadId: string, question: string) => Promise<void>
  /** Closes a thread's side question. An answer still on its way is dropped when it arrives. */
  dismiss: (threadId: string) => void
}

let counter = 0

export const useInboxAside = create<InboxAsideStore>((set, get) => {
  const settle = (threadId: string, id: number, patch: Partial<ChatAside>): void => {
    // Dismissed or replaced since it was asked: this answer is no one's now.
    if (get().asides[threadId]?.id !== id) return
    set((state) => ({ asides: { ...state.asides, [threadId]: { ...state.asides[threadId]!, ...patch } } }))
  }

  return {
    asides: {},

    ask: async (threadId, question) => {
      const asked = question.trim()
      if (!asked) return
      counter += 1
      const id = counter
      set((state) => ({ asides: { ...state.asides, [threadId]: { id, question: asked, status: 'loading', answer: '', error: null } } }))
      try {
        const { text } = await window.api.chat.aside({ threadId, question: asked })
        settle(threadId, id, { status: 'done', answer: text })
      } catch (error) {
        settle(threadId, id, { status: 'error', error: ipcErrorMessage(error, 'Could not answer the question.') })
      }
    },

    dismiss: (threadId) => {
      set((state) => {
        if (!(threadId in state.asides)) return {}
        const { [threadId]: _closed, ...rest } = state.asides
        return { asides: rest }
      })
    },
  }
})
