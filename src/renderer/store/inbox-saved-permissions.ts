import { create } from 'zustand'
import type { ChatSavedPermission } from '@shared/types'
import { ipcErrorMessage } from '@/lib/ipc-error'

export interface SavedPermissionsEntry {
  /** False until the first answer; the list is kept when a later read fails. */
  loaded: boolean
  permissions: ChatSavedPermission[]
  error: string | null
  /** Approvals being forgotten right now. */
  removing: Record<string, true>
}

interface SavedPermissionsStore {
  /** Per thread: the approvals OpenCode saved for the project it works in. */
  entries: Record<string, SavedPermissionsEntry>
  load: (threadId: string) => Promise<void>
  remove: (threadId: string, id: string) => Promise<void>
  /** Keeps a thread's list fresh while it is open (and when the window comes back into focus). */
  watch: (threadId: string) => () => void
}

const EMPTY: SavedPermissionsEntry = { loaded: false, permissions: [], error: null, removing: {} }
const inflight = new Map<string, Promise<void>>()
/** Bumped by each removal, so a read that began before cannot bring a forgotten approval back on screen. */
const revisions = new Map<string, number>()
const watched = new Map<string, number>()
let focusAttached = false

export const useInboxSavedPermissions = create<SavedPermissionsStore>((set, get) => {
  const patch = (threadId: string, change: (entry: SavedPermissionsEntry) => Partial<SavedPermissionsEntry>): void =>
    set((state) => {
      const entry = state.entries[threadId] ?? EMPTY
      return { entries: { ...state.entries, [threadId]: { ...entry, ...change(entry) } } }
    })

  return {
    entries: {},

    load: (threadId) => {
      const running = inflight.get(threadId)
      if (running) return running
      const revision = revisions.get(threadId) ?? 0
      let again = false
      const reading = (async () => {
        try {
          const { permissions } = await window.api.chat.savedPermissions({ threadId })
          if ((revisions.get(threadId) ?? 0) !== revision) {
            again = true
            return
          }
          patch(threadId, (entry) => ({
            loaded: true,
            error: null,
            permissions: permissions.filter((item) => !entry.removing[item.id]),
          }))
        } catch (reason) {
          patch(threadId, () => ({ loaded: true, error: ipcErrorMessage(reason, 'Could not read the saved permissions.') }))
        }
      })().finally(() => {
        if (inflight.get(threadId) === reading) inflight.delete(threadId)
        // A removal ran while this was read; its answer may still hold the removed approval, so read once more.
        if (again) void get().load(threadId)
      })
      inflight.set(threadId, reading)
      return reading
    },

    remove: async (threadId, id) => {
      revisions.set(threadId, (revisions.get(threadId) ?? 0) + 1)
      patch(threadId, (entry) => ({ removing: { ...entry.removing, [id]: true }, error: null }))
      try {
        await window.api.chat.removeSavedPermission({ threadId, id })
        patch(threadId, (entry) => ({ permissions: entry.permissions.filter((item) => item.id !== id) }))
      } catch (reason) {
        patch(threadId, () => ({ error: ipcErrorMessage(reason, 'Could not remove the saved permission.') }))
      } finally {
        patch(threadId, (entry) => {
          const { [id]: _done, ...removing } = entry.removing
          return { removing }
        })
        revisions.set(threadId, (revisions.get(threadId) ?? 0) + 1)
      }
    },

    watch: (threadId) => {
      watched.set(threadId, (watched.get(threadId) ?? 0) + 1)
      if (!focusAttached) {
        focusAttached = true
        // An OpenCode terminal on the same project can save approvals while MDE is in the background.
        window.addEventListener('focus', () => {
          for (const id of watched.keys()) void get().load(id)
        })
      }
      void get().load(threadId)
      return () => {
        const count = (watched.get(threadId) ?? 1) - 1
        if (count > 0) watched.set(threadId, count)
        else watched.delete(threadId)
      }
    },
  }
})

/** How many approvals a thread's project has saved; 0 until they are read. */
export function useSavedPermissionCount(threadId: string | undefined): number {
  return useInboxSavedPermissions((state) => (threadId ? state.entries[threadId]?.permissions.length ?? 0 : 0))
}
