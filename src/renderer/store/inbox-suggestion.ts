import { create } from 'zustand'

/**
 * The next message suggested for a thread: a guess, made once per finished turn, shown as ghost text in the empty
 * message box. Kept in memory only; a new turn makes it stale.
 */
export interface ThreadSuggestion {
  /** The turn (the agent's last step) it was guessed after. */
  turn: string
  status: 'loading' | 'done'
  /** The suggested message; null while it is guessed, or when there was nothing to suggest or the guess failed. */
  text: string | null
  /** Put away with Escape; it stays away for this turn. */
  dismissed: boolean
}

interface InboxSuggestionStore {
  threads: Record<string, ThreadSuggestion>
  /**
   * Guesses the next message after a turn, unless that turn already has a guess (made, being made or failed). It
   * never rejects: a failure only means no suggestion for the turn, since nobody asked for it.
   */
  request: (threadId: string, turn: string) => Promise<void>
  /** Puts the thread's suggestion away for the rest of its turn. */
  dismiss: (threadId: string) => void
}

export const useInboxSuggestion = create<InboxSuggestionStore>((set, get) => ({
  threads: {},
  request: async (threadId, turn) => {
    if (get().threads[threadId]?.turn === turn) return
    set((state) => ({ threads: { ...state.threads, [threadId]: { turn, status: 'loading', text: null, dismissed: false } } }))
    let text: string | null = null
    try {
      text = (await window.api.chat.suggest({ threadId })).text
    } catch {
      text = null
    }
    set((state) => {
      const current = state.threads[threadId]
      // A newer turn asked for its own suggestion meanwhile; this one is too late.
      if (current?.turn !== turn) return state
      return { threads: { ...state.threads, [threadId]: { ...current, status: 'done', text } } }
    })
  },
  dismiss: (threadId) => set((state) => {
    const current = state.threads[threadId]
    if (!current || current.dismissed) return state
    return { threads: { ...state.threads, [threadId]: { ...current, dismissed: true } } }
  }),
}))

/** The text to show for a thread's turn, or null when there is none to show. */
export function shownSuggestion(entry: ThreadSuggestion | undefined, turn: string | null): string | null {
  if (!entry || !turn || entry.turn !== turn || entry.dismissed || entry.status !== 'done') return null
  return entry.text
}
