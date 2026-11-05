import { create } from 'zustand'
import {
  clampInboxSidebarWidth,
  getInboxDraftsCollapsed,
  getInboxSidebarWidth,
  getInboxTitleIcons,
  getInboxWorkingCollapsed,
  getInboxWorkingSection,
  saveInboxDraftsCollapsed,
  saveInboxSidebarWidth,
  saveInboxTitleIcons,
  saveInboxWorkingCollapsed,
  saveInboxWorkingSection,
} from '@/lib/inbox-settings'

interface Store {
  /** List the working threads in a section under the thread list (a preference, off by default). */
  workingSection: boolean
  setWorkingSection: (on: boolean) => void
  /**
   * Show each row's project icon in front of its title, instead of beside the project's name on the line
   * below (a preference, off by default).
   */
  titleIcons: boolean
  setTitleIcons: (on: boolean) => void
  /** That section is folded up, leaving only its header. */
  workingCollapsed: boolean
  setWorkingCollapsed: (collapsed: boolean) => void
  /** The Drafts section is folded up, leaving only its header. */
  draftsCollapsed: boolean
  setDraftsCollapsed: (collapsed: boolean) => void
  /** How wide the right-hand sidebar (files, changes, terminal) is, in pixels. */
  sidebarWidth: number
  /** Dragging sets the width without keeping it; `keep` is for the last step, so storage is written once. */
  setSidebarWidth: (width: number, keep?: boolean) => void
}

/** How the Inbox sidebar is laid out, as the user last left it. */
export const useInboxView = create<Store>((set) => ({
  workingSection: getInboxWorkingSection(),
  setWorkingSection: (on) => {
    saveInboxWorkingSection(on)
    set({ workingSection: on })
  },
  titleIcons: getInboxTitleIcons(),
  setTitleIcons: (on) => {
    saveInboxTitleIcons(on)
    set({ titleIcons: on })
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
  sidebarWidth: getInboxSidebarWidth(),
  setSidebarWidth: (width, keep = true) => {
    const next = clampInboxSidebarWidth(width)
    if (keep) saveInboxSidebarWidth(next)
    set({ sidebarWidth: next })
  },
}))
