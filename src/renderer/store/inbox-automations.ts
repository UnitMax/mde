import { create } from 'zustand'
import type { AutomationSaveRequest, InboxAutomation } from '@shared/automations'

interface InboxAutomationsStore {
  automations: InboxAutomation[]
  loaded: boolean
  /** The manager dialog: shut, showing the list, or showing one automation. */
  manager: { open: boolean; editId?: string }
  /** Reads the list, and from then on follows what the main process says about it. */
  load: () => Promise<void>
  save: (request: AutomationSaveRequest) => Promise<InboxAutomation>
  remove: (id: string) => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  /** Starts a thread now. The automation comes back with what happened: the thread, or why there is none. */
  run: (id: string) => Promise<InboxAutomation | null>
  openManager: (editId?: string) => void
  closeManager: () => void
}

let following = false

export const useInboxAutomations = create<InboxAutomationsStore>((set, get) => {
  const put = (automation: InboxAutomation | null): void => {
    if (!automation) return
    const list = get().automations
    set({ automations: list.some((item) => item.id === automation.id) ? list.map((item) => (item.id === automation.id ? automation : item)) : [...list, automation] })
  }
  return {
    automations: [],
    loaded: false,
    manager: { open: false },

    load: async () => {
      // A window without the Inbox's bridge (the mini window, a test page) has none to show.
      if (!window.api?.automations) return
      if (!following) {
        following = true
        // Everything that changes them (a run, another save) arrives here with the whole list.
        window.api.automations.onChanged?.((automations) => {
          if (Array.isArray(automations)) set({ automations, loaded: true })
        })
      }
      try {
        const automations = await window.api.automations.list()
        if (Array.isArray(automations)) set({ automations, loaded: true })
      } catch {
        // The list on screen stays; the next change brings it.
      }
    },

    save: async (request) => {
      const saved = await window.api.automations.save(request)
      put(saved)
      return saved
    },

    remove: async (id) => {
      await window.api.automations.remove({ id })
      set({ automations: get().automations.filter((item) => item.id !== id) })
    },

    setEnabled: async (id, enabled) => {
      put(await window.api.automations.setEnabled({ id, enabled }))
    },

    run: async (id) => {
      const after = await window.api.automations.run({ id })
      put(after)
      return after
    },

    openManager: (editId) => {
      set({ manager: { open: true, ...(editId ? { editId } : {}) } })
      void get().load()
    },
    closeManager: () => set({ manager: { open: false } }),
  }
})

/** For tests: the next `load` subscribes again. */
export function resetInboxAutomationsFollowing(): void {
  following = false
}
