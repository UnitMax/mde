import { create } from 'zustand'
import type { ChatDraftSummary } from '@shared/types'
import { newDraftId } from '@/lib/inbox-drafts'
import { useInboxChat } from '@/store/inbox-chat'
import { useWorkspace } from '@/store/workspace'

/** The draft the new-thread page edits. `opened` when it was taken from the list, and so stays in it. */
export interface PageDraft {
  id: string
  opened: boolean
}

interface InboxDraftsStore {
  /** The new threads that were started and not sent, newest change first. */
  drafts: ChatDraftSummary[]
  page: PageDraft
  /** Reads the list from the main process; one that was asked for earlier but answers later is dropped. */
  load: () => Promise<void>
  /** Opens a draft on the new-thread page to carry on with it. */
  open: (draft: ChatDraftSummary) => void
  /** The new-thread page was left: what was typed on it is a draft now, and the next visit starts blank. */
  leave: () => void
  /** New thread was chosen while its page is open: what is typed there is set aside, and the page starts blank. */
  startFresh: () => Promise<void>
  /** Deletes a draft and the files saved with it. A refusal leaves it where it is. */
  remove: (id: string) => Promise<void>
}

const fresh = (): PageDraft => ({ id: newDraftId(), opened: false })
let loads = 0

export const useInboxDrafts = create<InboxDraftsStore>((set, get) => ({
  drafts: [],
  page: fresh(),

  load: async () => {
    const turn = ++loads
    try {
      const drafts = await window.api.chat.drafts()
      if (turn === loads && Array.isArray(drafts)) set({ drafts })
    } catch {
      // The list on screen stays; the next change reads it again.
    }
  },

  open: (draft) => {
    const chat = useInboxChat.getState()
    // Back in the folder it was written for, unless that is gone; the page then names the one it shows.
    if (chat.folders.some((folder) => folder.id === draft.folderId)) chat.setComposer({ folderId: draft.folderId })
    set({ page: { id: draft.id, opened: true } })
    useWorkspace.getState().selectInboxThread(null)
    // The page that was open may have held something typed a moment ago.
    void get().load()
  },

  leave: () => {
    set({ page: fresh() })
    void get().load()
  },

  startFresh: async () => {
    const { page } = get()
    await get().load()
    // A blank page that was never taken from the list has nothing to set aside.
    if (!page.opened && !get().drafts.some((draft) => draft.id === page.id)) return
    if (get().page.id !== page.id) return
    set({ page: fresh() })
  },

  remove: async (id) => {
    await window.api.chat.draft({ key: `draft:${id}`, action: 'clear' })
    if (get().page.id === id) set({ page: fresh() })
    await get().load()
  },
}))
