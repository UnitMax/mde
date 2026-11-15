import { useEffect, useMemo, useRef } from 'react'
import { inboxTerminalSession } from '@shared/inbox-terminal'
import { TerminalView } from '@/components/TerminalView'
import { AgentCommandBar } from '@/components/inbox/AgentCommandBar'
import { TerminalSelectionActionsContext, type TerminalSelectionActions } from '@/components/terminal-selection-actions'
import { sendTextToNewThread, sendTextToThread } from '@/lib/inbox-thread-input'
import { focusTerminalWhenReady } from '@/terminal/focus'
import { INBOX_TERMINAL_TAB, useInboxTerminal } from '@/store/inbox-terminal'
import { useWorkspace } from '@/store/workspace'

const agentCommandBar = (terminalId: string): JSX.Element => <AgentCommandBar terminalId={terminalId} />

/** Set when the tab was chosen with the pointer, so the terminal that appears takes the keyboard. */
let focusWhenShown = false

/**
 * Asks the terminal, the next time it appears, to take the keyboard. Choosing the tab from the keyboard does
 * not ask: the tab strip keeps the focus there, so the arrow keys can go on to the next tab.
 */
export function focusInboxTerminalWhenShown(): void {
  focusWhenShown = true
}

/**
 * The Inbox's terminal: the project view's terminal layout, once, in the sidebar or, when it is broken out
 * of it, floating over the conversation (`focusOnMount` takes the keyboard as the floating window opens). It has no tabs of its own
 * and does not depend on the open thread; its shells start in the home directory and keep running while
 * the sidebar shows something else.
 */
export function InboxTerminal({ focusOnMount = false }: { focusOnMount?: boolean }): JSX.Element {
  const layout = useInboxTerminal((state) => state.layout)
  const splitPane = useInboxTerminal((state) => state.splitPane)
  const resize = useInboxTerminal((state) => state.resize)
  const reorder = useInboxTerminal((state) => state.reorder)
  const titlePane = useInboxTerminal((state) => state.titlePane)
  const closePane = useInboxTerminal((state) => state.closePane)
  const paneFocused = useInboxTerminal((state) => state.paneFocused)
  const platform = useWorkspace((state) => state.platform)
  const configuredSession = useInboxTerminal((state) => state.session)
  const configuring = useInboxTerminal((state) => state.configuring)
  const error = useInboxTerminal((state) => state.error)
  const configureDistro = useInboxTerminal((state) => state.configureDistro)
  const session = platform?.isWindows ? configuredSession : inboxTerminalSession(platform?.platform ?? '', [])
  const firstTerminalId = layout.panes[0]?.terminalId
  // The right-click menu can send the selected text to the thread that is open in the Inbox.
  const openThreadId = useWorkspace((state) => state.inboxThreads.some((thread) => thread.id === state.selectedInboxThreadId) ? state.selectedInboxThreadId : null)
  const selectionActions = useMemo<TerminalSelectionActions>(() => ({
    canSend: openThreadId !== null,
    send: (text) => { if (openThreadId) sendTextToThread(openThreadId, text) },
    sendNew: (text) => {
      // Handed over first, so the page that opens takes it; a page that is open already takes it as it is.
      sendTextToNewThread(text)
      if (useWorkspace.getState().selectedInboxThreadId !== null) useWorkspace.getState().selectInboxThread(null)
    },
  }), [openThreadId])

  useEffect(() => {
    if (platform?.isWindows && useInboxTerminal.getState().session === undefined) {
      void configureDistro(useInboxTerminal.getState().distro)
    }
  }, [platform?.isWindows, configureDistro])

  // A terminal opened by the person taking it out, or bringing it back, takes the keyboard once it is there.
  const focusMount = useRef(focusOnMount)
  useEffect(() => {
    if (!(focusWhenShown || focusMount.current) || !firstTerminalId || !session || configuring) return
    focusWhenShown = false
    focusMount.current = false
    return focusTerminalWhenReady(firstTerminalId)
  }, [firstTerminalId, session, configuring])

  if (!platform || configuring || (!session && !error && platform.isWindows && configuredSession === undefined)) {
    return <p role="status" className="p-4 text-[12px] text-fg-muted">Opening sidebar terminal…</p>
  }
  if (!session && error) {
    return <p role="alert" className="p-4 text-[12px] leading-snug text-danger">{error} Choose a distribution in Settings → Terminal → Inbox sidebar terminal.</p>
  }
  if (!session) {
    return <p role="status" className="p-4 text-[12px] leading-snug text-fg-muted">The terminal needs a WSL distribution, and none was found.</p>
  }
  return (
    <TerminalSelectionActionsContext.Provider value={selectionActions}>
    <TerminalView
      session={session}
      activeTab={INBOX_TERMINAL_TAB}
      terminalLayout={layout}
      embedded
      onSplitPane={splitPane}
      onLayoutResize={resize}
      onPaneOrderChange={reorder}
      onClosePane={closePane}
      onPaneFocus={paneFocused}
      onPaneTitleChange={titlePane}
      paneNotice={agentCommandBar}
    />
    </TerminalSelectionActionsContext.Provider>
  )
}
