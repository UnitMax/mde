import { create } from 'zustand'
import type { PtyExitInfo } from '@shared/types'
import { INBOX_TERMINAL_SESSION_ID } from '@shared/inbox-terminal'
import { getInboxTerminalLayout, saveInboxTerminalLayout } from '@/lib/inbox-settings'
import { disposeRuntimeTerminal } from '@/terminal/dispose'
import { focusTerminalWhenReady } from '@/terminal/focus'
import {
  layoutReduced,
  layoutReordered,
  layoutResized,
  layoutSwitched,
  layoutTitled
} from '@/terminal/layout-edits'
import {
  removeTerminalPane,
  terminalFocusTargetAfterRemoval,
  type RuntimeTerminalLaunch,
  type SessionTerminalLayout,
  type TerminalColumnIndex,
  type TerminalLayout,
  type TerminalResizeAxis,
  type TerminalRowIndex
} from '@/terminal/layout'
import { appendRuntimePane, createRuntimeLayout, defaultSessionTab } from '@/terminal/tabs'

/** The Inbox terminal is one tab of one session, so it has one tab and nothing to choose between. */
export const INBOX_TERMINAL_TAB = defaultSessionTab(INBOX_TERMINAL_SESSION_ID)

const RESIZE_SAVE_DELAY_MS = 180

/** One pane, or the arrangement the user last left, with its dividers where they were. */
function startingLayout(): SessionTerminalLayout {
  const single = createRuntimeLayout(INBOX_TERMINAL_SESSION_ID, INBOX_TERMINAL_TAB)
  const stored = getInboxTerminalLayout()
  const grown = stored && layoutSwitched(single, stored.layout, INBOX_TERMINAL_SESSION_ID, INBOX_TERMINAL_TAB.id)
  return stored && grown ? { ...grown, sizes: stored.sizes } : single
}

interface Store {
  /** What the terminal looks like: its arrangement and panes. Their shells run in the main process. */
  layout: SessionTerminalLayout
  switchLayout: (layout: TerminalLayout) => void
  reduceLayout: (layout: TerminalLayout, terminalIds: string[]) => void
  resize: (axis: TerminalResizeAxis, ratio: number, index?: TerminalColumnIndex | TerminalRowIndex) => void
  reorder: (terminalIds: readonly string[]) => void
  titlePane: (terminalId: string, title: string | null) => void
  addPane: (sourceTerminalId: string, launch: RuntimeTerminalLaunch) => void
  closePane: (terminalId: string) => void
  /** Which pane has the keyboard, so closing it can hand the keyboard on. */
  paneFocused: (terminalId: string) => void
  paneExited: (info: PtyExitInfo) => void
  /** Starts listening for shells that end. Returns the function that stops. */
  init: () => () => void
}

let focused: string | null = null
let saveTimer: number | undefined

/**
 * The Inbox's one terminal. It belongs to no thread: whichever thread is open, the same shells are there, and
 * they keep running while the sidebar shows something else. Only the arrangement is remembered between runs,
 * not the shells.
 */
export const useInboxTerminal = create<Store>((set, get) => {
  const commit = (next: SessionTerminalLayout, settle = true): void => {
    set({ layout: next })
    window.clearTimeout(saveTimer)
    const save = (): void => saveInboxTerminalLayout({ layout: next.layout, sizes: next.sizes })
    if (settle) save()
    else saveTimer = window.setTimeout(save, RESIZE_SAVE_DELAY_MS)
  }

  /** Hands the keyboard to the pane next to one that went. */
  const focusAfterRemoval = (previous: SessionTerminalLayout, removed: string[], next: SessionTerminalLayout): void => {
    const target = terminalFocusTargetAfterRemoval(previous.panes, removed, focused)
    if (!target || !next.panes.some((pane) => pane.terminalId === target)) return
    focused = target
    focusTerminalWhenReady(target)
  }

  return {
    layout: startingLayout(),

    switchLayout: (layout) => {
      const next = layoutSwitched(get().layout, layout, INBOX_TERMINAL_SESSION_ID, INBOX_TERMINAL_TAB.id)
      if (next) commit(next)
    },

    reduceLayout: (layout, terminalIds) => {
      const previous = get().layout
      terminalIds.forEach(disposeRuntimeTerminal)
      const next = layoutReduced(previous, layout, terminalIds)
      commit(next)
      focusAfterRemoval(previous, terminalIds, next)
    },

    resize: (axis, ratio, index) => commit(layoutResized(get().layout, axis, ratio, index), false),

    reorder: (terminalIds) => {
      const next = layoutReordered(get().layout, terminalIds)
      if (next) commit(next)
    },

    titlePane: (terminalId, title) => {
      const next = layoutTitled(get().layout, terminalId, title)
      if (next) commit(next)
    },

    addPane: (sourceTerminalId, launch) => {
      const existing = get().layout
      if (!existing.panes.some((pane) => pane.terminalId === sourceTerminalId)) return
      const next = appendRuntimePane(INBOX_TERMINAL_SESSION_ID, INBOX_TERMINAL_TAB.id, existing, launch)
      if (!next) return
      commit(next)
      const added = next.panes[next.panes.length - 1]
      if (added) focusTerminalWhenReady(added.terminalId)
    },

    closePane: (terminalId) => {
      const previous = get().layout
      const next = removeTerminalPane(previous, terminalId)
      if (!next) return
      disposeRuntimeTerminal(terminalId)
      commit(next)
      focusAfterRemoval(previous, [terminalId], next)
    },

    paneFocused: (terminalId) => { focused = terminalId },

    paneExited: (info) => {
      if (info.sessionId !== INBOX_TERMINAL_SESSION_ID) return
      const previous = get().layout
      if (!previous.panes.some((pane) => pane.terminalId === info.terminalId)) return
      // The last shell stays, showing that it ended, so there is something to restart.
      if (previous.panes.length === 1) {
        commit({ ...previous, panes: previous.panes.map((pane) => ({ ...pane, exited: true })) })
        return
      }
      const next = removeTerminalPane(previous, info.terminalId)
      if (!next) return
      disposeRuntimeTerminal(info.terminalId)
      commit(next)
      focusAfterRemoval(previous, [info.terminalId], next)
    },

    init: () => window.api.pty.onExit((info) => get().paneExited(info)),
  }
})
