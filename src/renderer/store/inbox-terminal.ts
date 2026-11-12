import { terminalPaneIds } from '@shared/terminal-layouts'
import { create } from 'zustand'
import type { PtyExitInfo, Session } from '@shared/types'
import type { FilesListRequest } from '@shared/ipc'
import { MDE_MCP_TERMINAL_PANE_LIMIT, type AgentTerminalDecisionKind, type AgentTerminalOpenRequest } from '@shared/mde-mcp'
import { INBOX_TERMINAL_SESSION_ID, inboxTerminalSession } from '@shared/inbox-terminal'
import { getInboxTerminalDistro, getInboxTerminalLayout, saveInboxTerminalDistro, saveInboxTerminalLayout } from '@/lib/inbox-settings'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useInboxFloatingTerminal } from '@/store/inbox-floating-terminal'
import { useWorkspace } from '@/store/workspace'
import { getTerminalSettings } from '@/terminal/terminal-settings'
import { getTerminalPalette } from '@/theme/themes'
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
  /**
   * Adds a pane whose shell starts in a folder of the Files tree, beside the pane last used. The folder must be
   * where the terminal runs (the same WSL distro, or the host); a folder elsewhere is refused with a reason.
   */
  openInFolder: (folder: FilesListRequest, where: Pick<Session, 'kind' | 'distro'>, side: TerminalSplitSide) => Promise<void>
  /**
   * A pane an agent asked for through the MDE MCP. Main starts its shell (in the background, so it runs while the
   * terminal is hidden); the pane never takes the keyboard and the terminal is not brought into view.
   */
  openForAgent: (request: AgentTerminalOpenRequest) => Promise<void>
  /** Commands agents asked to run, waiting for the person's approval, by terminal ID. */
  agentCommands: Record<string, { command: string; from: string | null }>
  /** Answers a waiting command's approval bar. */
  decideAgentCommand: (terminalId: string, decision: AgentTerminalDecisionKind) => void
  /** Counts panes agents opened, so the hidden-terminal reminder can play its animation for each. */
  agentArrivals: number
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

  const dropAgentCommand = (terminalId: string): void => {
    if (!(terminalId in get().agentCommands)) return
    const { [terminalId]: _dropped, ...rest } = get().agentCommands
    set({ agentCommands: rest })
  }

  /** The Inbox terminal's session, configuring the WSL distro first if the terminal has not been shown yet. */
  const readySession = async (): Promise<Session> => {
    const platform = useWorkspace.getState().platform
    let session = platform?.isWindows ? get().session : inboxTerminalSession(platform?.platform ?? '', [])
    if (platform?.isWindows && session === undefined) {
      await get().configureDistro(get().distro)
      session = get().session
    }
    if (!session) throw new Error(get().error ?? 'The terminal needs a WSL distribution, and none was found.')
    return session
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
          set({ agentCommands: {} })
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

    openInFolder: async (folder, where, side) => {
      const platform = useWorkspace.getState().platform
      const session = await readySession()
      if (session.kind !== where.kind || (session.kind === 'wsl' && session.distro !== where.distro)) {
        const name = (place: Pick<Session, 'kind' | 'distro'>): string =>
          place.kind === 'wsl' ? `in WSL (${place.distro ?? 'no distribution'})` : platform?.isWindows ? 'on Windows' : 'on this computer'
        throw new Error(`This folder is ${name(where)}, but the Inbox terminal runs ${name(session)}.`)
      }
      const previous = get().layout
      const source = previous.panes.find((pane) => pane.terminalId === focused) ?? previous.panes.at(-1)
      const next = source && splitRuntimePane(INBOX_TERMINAL_SESSION_ID, INBOX_TERMINAL_TAB.id, previous, source.terminalId, side)
      const added = next?.panes.find((pane) => !previous.panes.includes(pane))
      if (!next || !added) throw new Error('The terminal has no room for another pane.')
      await window.api.pty.startInFolder({ terminalId: added.terminalId, sessionId: INBOX_TERMINAL_SESSION_ID, folder })
      // Panes added or closed meanwhile would make this pane's place stale; start over from what is there now.
      if (get().layout !== previous) return get().openInFolder(folder, where, side)
      commit(next)
      focused = added.terminalId
      focusTerminalWhenReady(added.terminalId)
    },

    agentCommands: {},
    agentArrivals: 0,

    openForAgent: async (request) => {
      let claimed: string | null = null
      try {
        await readySession()
        // Floating, the pane goes beside the last one; in the narrow sidebar, below it. It is placed by the last
        // pane rather than the one in use, so it never lands in the middle of what the person is working in.
        const side: TerminalSplitSide = useInboxFloatingTerminal.getState().floating ? 'right' : 'bottom'
        const previous = get().layout
        if (previous.panes.length >= MDE_MCP_TERMINAL_PANE_LIMIT) {
          throw new Error(`The Inbox terminal already has ${previous.panes.length} panes, which is as many as agents may open into. The person has to close one first.`)
        }
        const source = previous.panes.at(-1)
        const next = source && splitRuntimePane(INBOX_TERMINAL_SESSION_ID, INBOX_TERMINAL_TAB.id, previous, source.terminalId, side)
        const added = next?.panes.find((pane) => !previous.panes.includes(pane))
        if (!source || !next || !added) throw new Error('The Inbox terminal has no room for another pane. The person has to close one first.')
        await window.api.agentTerminals.claim({
          requestId: request.requestId,
          terminalId: added.terminalId,
          palette: getTerminalPalette(getTerminalSettings().theme),
        })
        claimed = added.terminalId
        // The layout may have changed while main started the shell: split what is there now. If that names another
        // pane than the one main started, the shell is ended rather than shown in the wrong place.
        const latest = get().layout
        const settled = latest === previous ? next : splitRuntimePane(INBOX_TERMINAL_SESSION_ID, INBOX_TERMINAL_TAB.id, latest, source.terminalId, side)
        if (!settled?.panes.some((pane) => pane.terminalId === added.terminalId && !latest.panes.includes(pane))) {
          disposeRuntimeTerminal(added.terminalId)
          return
        }
        commit(layoutTitled(settled, added.terminalId, request.title) ?? settled)
        set({
          agentArrivals: get().agentArrivals + 1,
          ...(request.approval && request.command !== null
            ? { agentCommands: { ...get().agentCommands, [added.terminalId]: { command: request.command, from: request.from } } }
            : {}),
        })
      } catch (error) {
        // Main already told the agent when it refused the claim itself.
        if (claimed === null) {
          void window.api.agentTerminals.refuse({ requestId: request.requestId, reason: ipcErrorMessage(error, 'MDE could not open the terminal.') }).catch(() => undefined)
        }
      }
    },

    decideAgentCommand: (terminalId, decision) => {
      if (!(terminalId in get().agentCommands)) return
      dropAgentCommand(terminalId)
      void window.api.agentTerminals.decide({ terminalId, decision }).catch(() => undefined)
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
      dropAgentCommand(terminalId)
      commit(next)
      focusAfterRemoval(previous, [terminalId], next)
    },

    paneFocused: (terminalId) => { focused = terminalId },

    paneExited: (info) => {
      if (info.sessionId !== INBOX_TERMINAL_SESSION_ID) return
      const previous = get().layout
      if (!previous.panes.some((pane) => pane.terminalId === info.terminalId)) return
      // A command can no longer run in a shell that has gone.
      if (info.terminalId in get().agentCommands) get().decideAgentCommand(info.terminalId, 'cancel')
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

    init: () => {
      const stopExits = window.api.pty.onExit((info) => get().paneExited(info))
      const stopAgents = window.api.agentTerminals.onOpen((request) => { void get().openForAgent(request) })
      return () => {
        stopExits()
        stopAgents()
      }
    },
  }
})
