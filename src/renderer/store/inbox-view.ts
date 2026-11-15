import { create } from 'zustand'
import {
  clampInboxSidebarWidth,
  getInboxCommandNames,
  getInboxCompactChat,
  getInboxCompactText,
  getInboxDraftsCollapsed,
  getInboxModelQuickSwitch,
  getInboxNextSuggestion,
  getInboxProjectFilter,
  getInboxSidebarFloating,
  getInboxToolTurns,
  getInboxSidebarWidth,
  getInboxSnoozedOpen,
  getInboxTitleIcons,
  getInboxTurnChanges,
  getInboxWorkingCollapsed,
  getInboxWorkingSection,
  saveInboxCommandNames,
  saveInboxCompactChat,
  saveInboxCompactText,
  saveInboxDraftsCollapsed,
  saveInboxModelQuickSwitch,
  saveInboxNextSuggestion,
  saveInboxProjectFilter,
  saveInboxSidebarFloating,
  saveInboxToolTurns,
  saveInboxSidebarWidth,
  saveInboxSnoozedOpen,
  saveInboxTitleIcons,
  saveInboxTurnChanges,
  saveInboxWorkingCollapsed,
  saveInboxWorkingSection,
} from '@/lib/inbox-settings'

/** What the floating card can open out in place: the files, the thread's Git changes or its tool calls. */
export type FloatingSection = 'files' | 'changes' | 'tools'

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
  /**
   * In compact mode, the text the agent writes between its steps is drawn as it is instead of folded into the line;
   * thoughts and tool calls still fold (a preference, off by default).
   */
  compactText: boolean
  setCompactText: (on: boolean) => void
  /**
   * In compact mode, a panel at the end of each turn lists the files the turn changed, with its diffs a click away
   * (a preference, on by default).
   */
  turnChanges: boolean
  setTurnChanges: (on: boolean) => void
  /** A folded line of steps names the commands it ran after its summary (a preference, on by default). */
  commandNames: boolean
  setCommandNames: (on: boolean) => void
  /** Offer the favorite models as buttons above the message box (a preference, on by default). */
  modelQuickSwitch: boolean
  setModelQuickSwitch: (on: boolean) => void
  /**
   * After a turn, the thread's model guesses the next message and the message box shows it as ghost text that Tab
   * takes (a preference, on by default). Each guess is one more call to the model.
   */
  nextSuggestion: boolean
  setNextSuggestion: (on: boolean) => void
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
  /**
   * The sidebar floats over the conversation as a menu card, which opens into a panel, instead of standing beside it
   * (a preference, off by default).
   */
  sidebarFloating: boolean
  setSidebarFloating: (on: boolean) => void
  /** The Tools tab shows a header for each message of the person's above the calls answering it (a preference, off by default). */
  toolTurns: boolean
  setToolTurns: (on: boolean) => void
  /** With the sidebar floating: the section of the card that is opened out below its row, or null. Not kept between runs. */
  floatingSection: FloatingSection | null
  setFloatingSection: (section: FloatingSection | null) => void
  /**
   * How wide the floating card (or the button it hides to) is on screen, in pixels; 0 when there is none. The
   * conversation makes way for it where there is room (`floatingReserve`).
   */
  floatingCardWidth: number
  setFloatingCardWidth: (width: number) => void
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
  nextSuggestion: getInboxNextSuggestion(),
  setNextSuggestion: (on) => {
    saveInboxNextSuggestion(on)
    set({ nextSuggestion: on })
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
  compactText: getInboxCompactText(),
  setCompactText: (on) => {
    saveInboxCompactText(on)
    set({ compactText: on })
  },
  turnChanges: getInboxTurnChanges(),
  setTurnChanges: (on) => {
    saveInboxTurnChanges(on)
    set({ turnChanges: on })
  },
  commandNames: getInboxCommandNames(),
  setCommandNames: (on) => {
    saveInboxCommandNames(on)
    set({ commandNames: on })
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
  sidebarFloating: getInboxSidebarFloating(),
  setSidebarFloating: (on) => {
    saveInboxSidebarFloating(on)
    set({ sidebarFloating: on, floatingSection: null })
  },
  toolTurns: getInboxToolTurns(),
  setToolTurns: (on) => {
    saveInboxToolTurns(on)
    set({ toolTurns: on })
  },
  floatingSection: null,
  setFloatingSection: (section) => set({ floatingSection: section }),
  floatingCardWidth: 0,
  setFloatingCardWidth: (width) => set((state) => (state.floatingCardWidth === width ? state : { floatingCardWidth: width })),
}))
