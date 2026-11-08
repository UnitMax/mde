import { create } from 'zustand'

/** A request to open the search bar of a thread's conversation, from a result of the search over all threads. */
export interface InboxFindRequest {
  threadId: string
  query: string
  /** The message the result is in; the search starts at its first match. */
  messageId: string
}

interface InboxFindState {
  request: InboxFindRequest | null
  ask: (request: InboxFindRequest) => void
  /** The thread's view calls this when it has taken the request, so that it is not taken twice. */
  clear: () => void
}

export const useInboxFind = create<InboxFindState>((set) => ({
  request: null,
  ask: (request) => set({ request }),
  clear: () => set({ request: null }),
}))
