import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { INBOX_TERMINAL_SESSION_ID } from '@shared/inbox-terminal'
import { SessionGitGraph } from '@/components/SessionGitGraph'
import { useInboxChanges } from '@/store/inbox-changes'
import { useInboxFloatingTerminal } from '@/store/inbox-floating-terminal'
import { useInboxTerminal } from '@/store/inbox-terminal'
import { useSessionGitGraph } from '@/store/session-git-graph'

/** Two boxes share some area, not just an edge. */
function overlaps(a: DOMRect, b: DOMRect): boolean {
  return Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top)
}

/**
 * Hides the floating terminal, as F11 does, when its window lies over `area`: what was just opened there would
 * otherwise be beneath it. A window parked clear of the area stays. F11 brings a hidden one back where it was.
 */
export function hideFloatingTerminalOver(area: Element | null): void {
  const { floating, visible, hide } = useInboxFloatingTerminal.getState()
  if (!floating || !visible || !area) return
  const window = document.querySelector('[data-testid="floating-terminal"]')
  if (window && overlaps(window.getBoundingClientRect(), area.getBoundingClientRect())) hide()
}

/**
 * The Git graph of an Inbox terminal pane's checkout, opened from the Git chip in the pane's header (in the
 * sidebar or floating) and laid over the conversation like the thread's own graph. Only one of the two, or a
 * diff under review, is open at a time. Whatever opens over the conversation is brought into view: a floating
 * terminal lying over it is hidden. `filePath` is the file open from the tree, which closes the graph.
 */
export function InboxTerminalGitGraph({ area, filePath }: { area: RefObject<HTMLElement | null>; filePath?: string }): JSX.Element {
  const panes = useInboxTerminal((s) => s.layout.panes)
  const terminalIds = useMemo(() => panes.map((pane) => pane.terminalId), [panes])
  const ids = useRef(terminalIds)
  ids.current = terminalIds
  const terminalGraph = useSessionGitGraph((s) => (s.terminalId !== null && terminalIds.includes(s.terminalId) ? s.terminalId : null))
  const threadGraph = useInboxChanges((s) => s.graphThreadId)
  const review = useInboxChanges((s) => s.selectedPath)

  // Opening one closes the other. Each effect runs only when its own side changes, so the one opened last stays.
  useEffect(() => {
    if (!terminalGraph) return
    const changes = useInboxChanges.getState()
    if (changes.graphThreadId !== null) changes.closeGraph()
    if (changes.selectedPath !== null) changes.closeFile()
  }, [terminalGraph])
  useEffect(() => {
    if (threadGraph !== null || review !== null) useSessionGitGraph.getState().close()
  }, [threadGraph, review])

  // Leaving the Inbox closes the graph rather than keeping it for the next visit.
  useEffect(() => () => {
    const open = useSessionGitGraph.getState().terminalId
    if (open !== null && ids.current.includes(open)) useSessionGitGraph.getState().close()
  }, [])

  const shown = terminalGraph !== null ? `terminal:${terminalGraph}`
    : threadGraph !== null ? `graph:${threadGraph}`
      : review !== null ? `diff:${review.threadId}:${review.path}`
        : filePath !== undefined ? `file:${filePath}` : null
  useEffect(() => {
    if (shown !== null) hideFloatingTerminalOver(area.current)
  }, [shown, area])

  return <SessionGitGraph sessionId={INBOX_TERMINAL_SESSION_ID} terminalIds={terminalIds} filePath={filePath} />
}
