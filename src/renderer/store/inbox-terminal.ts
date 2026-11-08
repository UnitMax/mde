import { terminalPaneIds } from '@shared/terminal-layouts'
import { create } from 'zustand'
import type { PtyExitInfo, Session } from '@shared/types'
import { INBOX_TERMINAL_SESSION_ID } from '@shared/inbox-terminal'
import { getInboxTerminalDistro, getInboxTerminalLayout, saveInboxTerminalDistro, saveInboxTerminalLayout } from '@/lib/inbox-settings'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useWorkspace } from '@/store/workspace'
import { disposeRuntimeTerminal } from '@/terminal/dispose'
import { disposeSession } from '@/terminal/sessions'
import { focusTerminalWhenReady } from '@/terminal/focus'
import {
  layoutReordered,
  layoutResized,
  layoutTitled
} from '@/terminal/layout-edits'
import {
  removeTerminalPane,
  terminalFocusTargetAfterRemoval,
  type SessionTerminalLayout,
  type TerminalSplitSide,
} from '@/terminal/layout'
import { splitRuntimePane, createRuntimeLayout, defaultSessionTab } from '@/terminal/tabs'

/** The Inbox terminal is one tab of one session, so it has one tab and nothing to choose between. */
export const INBOX_TERMINAL_TAB = defaultSessionTab(INBOX_TERMINAL_SESSION_ID)

const RESIZE_SAVE_DELAY_MS = 180

/** One pane, or the arrangement the user last left, with its dividers where they were. */
function startingLayout(): SessionTerminalLayout {
  const single = createRuntimeLayout(INBOX_TERMINAL_SESSION_ID, INBOX_TERMINAL_TAB)
  const stored = getInboxTerminalLayout()
  return stored ? createRuntimeLayout(INBOX_TERMINAL_SESSION_ID, {
    ...INBOX_TERMINAL_TAB,
    layout: { tree: stored.tree, panes: terminalPaneIds(stored.tree).map((id) => ({ id })) },
  }) : single
}

interface Store {
  distro: string | null
  session: Session | null | undefined
  configuring: boolean
  error: string | null
  configureDistro: (distro: string | null) => Promise<boolean>
  /** What the terminal looks like: its arrangement and panes. Their shells run in the main process. */
  layout: SessionTerminalLayout
  splitPane: (terminalId: string, side: TerminalSplitSide) => void
  resize: (splitId: string, ratio: number) => void
  reorder: (terminalIds: readonly string[]) => void
  titlePane: (terminalId: string, title: string | null) => void
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
 * they keep running while the sidebar shows something else. The arrangement and preferred WSL distro are
 * remembered between runs, not the shells.
 */
export const useInboxTerminal = create<Store>((set, get) => {
  const commit = (next: SessionTerminalLayout, settle = true): void => {
    set({ layout: next })
    window.clearTimeout(saveTimer)
    const save = (): void => saveInboxTerminalLayout({ tree: next.tree })
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
    distro: getInboxTerminalDistro(),
    session: undefined,
    configuring: false,
    error: null,

    configureDistro: async (distro) => {
      if (get().configuring) return false
      set({ configuring: true, error: null })
      try {
        const { session, changed } = await window.api.pty.configureInbox({ distro })
        if (changed) {
          const workspace = useWorkspace.getState()
          for (const pane of get().layout.panes) {
            disposeSession(pane.terminalId)
            workspace.clearExit(pane.terminalId)
            workspace.setStatus(pane.terminalId, 'none')
            workspace.setTerminalDirectory({ terminalId: pane.terminalId, directory: null })
          }
          focused = null
          set({ layout: { ...get().layout, panes: get().layout.panes.map(({ exited: _exited, ...pane }) => pane) } })
        }
        saveInboxTerminalDistro(distro)
        set({ distro, session, configuring: false })
        return true
      } catch (error) {
        set({ configuring: false, error: ipcErrorMessage(error, 'Could not change the sidebar terminal distribution.') })
        return false
      }
    },

    layout: startingLayout(),

    splitPane: (terminalId, side) => {
      const previous = get().layout
      const next = splitRuntimePane(INBOX_TERMINAL_SESSION_ID, INBOX_TERMINAL_TAB.id, previous, terminalId, side)
      if (!next) return
      commit(next)
      const added = next.panes.find((pane) => !previous.panes.includes(pane))
      if (added) focusTerminalWhenReady(added.terminalId)
    },

    resize: (splitId, ratio) => commit(layoutResized(get().layout, splitId, ratio), false),

    reorder: (terminalIds) => {
      const next = layoutReordered(get().layout, terminalIds)
      if (next) commit(next)
    },

    titlePane: (terminalId, title) => {
      const next = layoutTitled(get().layout, terminalId, title)
      if (next) commit(next)
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
