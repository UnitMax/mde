import { useEffect } from 'react'
import { inboxTerminalSession } from '@shared/inbox-terminal'
import { TerminalView } from '@/components/TerminalView'
import { focusTerminalWhenReady } from '@/terminal/focus'
import { INBOX_TERMINAL_TAB, useInboxTerminal } from '@/store/inbox-terminal'
import { useWorkspace } from '@/store/workspace'

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
 * The Inbox's terminal: the project view's terminal layout, once, in the sidebar. It has no tabs of its own
 * and does not depend on the open thread; its shells start in the home directory and keep running while
 * the sidebar shows something else.
 */
export function InboxTerminal(): JSX.Element {
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

  useEffect(() => {
    if (platform?.isWindows && useInboxTerminal.getState().session === undefined) {
      void configureDistro(useInboxTerminal.getState().distro)
    }
  }, [platform?.isWindows, configureDistro])

  useEffect(() => {
    if (!focusWhenShown || !firstTerminalId || !session || configuring) return
    focusWhenShown = false
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
    />
  )
}
