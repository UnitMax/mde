import { create } from 'zustand'
import {
  clampInboxSidebarWidth,
  getInboxCompactChat,
  getInboxDraftsCollapsed,
  getInboxModelQuickSwitch,
  getInboxProjectFilter,
  getInboxSidebarWidth,
  getInboxSnoozedOpen,
  getInboxTitleIcons,
  getInboxWorkingCollapsed,
  getInboxWorkingSection,
  saveInboxCompactChat,
  saveInboxDraftsCollapsed,
  saveInboxModelQuickSwitch,
  saveInboxProjectFilter,
  saveInboxSidebarWidth,
  saveInboxSnoozedOpen,
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
  /**
   * Compact mode: chat conversations fold each stretch of activity (thinking, commands, reads, searches) into one line and start
   * file changes shut (a preference, off by default).
   */
  compactChat: boolean
  setCompactChat: (on: boolean) => void
  /** Offer the favorite models as buttons above the message box (a preference, on by default). */
  modelQuickSwitch: boolean
  setModelQuickSwitch: (on: boolean) => void
  /**
   * The project the thread list, the Working section and the drafts are narrowed to: its folder ID, or null for
   * all of them. Kept between runs. An ID with no project behind it (removed since) narrows nothing.
   */
  projectFilter: string | null
  setProjectFilter: (projectId: string | null) => void
  /** That section is folded up, leaving only its header. */
  workingCollapsed: boolean
  setWorkingCollapsed: (collapsed: boolean) => void
  /** The Drafts section is folded up, leaving only its header. */
  draftsCollapsed: boolean
  setDraftsCollapsed: (collapsed: boolean) => void
  /** The Snoozed section is open; it starts folded up to its header. */
  snoozedOpen: boolean
  setSnoozedOpen: (open: boolean) => void
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
  modelQuickSwitch: getInboxModelQuickSwitch(),
  setModelQuickSwitch: (on) => {
    saveInboxModelQuickSwitch(on)
    set({ modelQuickSwitch: on })
  },
  projectFilter: getInboxProjectFilter(),
  setProjectFilter: (projectId) => {
    saveInboxProjectFilter(projectId)
    set({ projectFilter: projectId })
  },
  compactChat: getInboxCompactChat(),
  setCompactChat: (on) => {
    saveInboxCompactChat(on)
    set({ compactChat: on })
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
  snoozedOpen: getInboxSnoozedOpen(),
  setSnoozedOpen: (open) => {
    saveInboxSnoozedOpen(open)
    set({ snoozedOpen: open })
  },
  sidebarWidth: getInboxSidebarWidth(),
  setSidebarWidth: (width, keep = true) => {
    const next = clampInboxSidebarWidth(width)
    if (keep) saveInboxSidebarWidth(next)
    set({ sidebarWidth: next })
  },
}))
