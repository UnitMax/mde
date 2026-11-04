import { create } from 'zustand'
import {
  getInboxDraftsCollapsed,
  getInboxWorkingCollapsed,
  getInboxWorkingSection,
  saveInboxDraftsCollapsed,
  saveInboxWorkingCollapsed,
  saveInboxWorkingSection,
} from '@/lib/inbox-settings'

interface Store {
  /** List the working threads in a section under the thread list (a preference, off by default). */
  workingSection: boolean
  setWorkingSection: (on: boolean) => void
  /** That section is folded up, leaving only its header. */
  workingCollapsed: boolean
  setWorkingCollapsed: (collapsed: boolean) => void
  /** The Drafts section is folded up, leaving only its header. */
  draftsCollapsed: boolean
  setDraftsCollapsed: (collapsed: boolean) => void
}

/** How the Inbox sidebar is laid out, as the user last left it. */
export const useInboxView = create<Store>((set) => ({
  workingSection: getInboxWorkingSection(),
  setWorkingSection: (on) => {
    saveInboxWorkingSection(on)
    set({ workingSection: on })
  },
  workingCollapsed: getInboxWorkingCollapsed(),
  setWorkingCollapsed: (collapsed) => {
    saveInboxWorkingCollapsed(collapsed)
    set({ workingCollapsed: collapsed })
  },
  draftsCollapsed: getInboxDraftsCollapsed(),
  setDraftsCollapsed: (collapsed) => {
    saveInboxDraftsCollapsed(collapsed)
    set({ draftsCollapsed: collapsed })
  },
}))
