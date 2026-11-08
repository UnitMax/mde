import { useEffect } from 'react'
import { INBOX_TERMINAL_HIGHLIGHT_MS } from '@/lib/inbox-terminal-highlight'
import { useWorkspace } from '@/store/workspace'

/** One-shot streak and glow around an Inbox thread's OpenCode terminal. */
export function TerminalThreadHighlight({ threadId }: { threadId: string }): JSX.Element | null {
  const highlight = useWorkspace((state) => state.inboxTerminalHighlights[threadId])
  const clearHighlight = useWorkspace((state) => state.clearInboxTerminalHighlight)
  const token = highlight?.token
  const at = highlight?.at

  // Animation events may not fire while hidden or under reduced motion. Expire by time instead,
  // including when a thread is reopened after its animation would already have finished.
  useEffect(() => {
    if (token === undefined || at === undefined) return
    const delay = Math.max(0, at + INBOX_TERMINAL_HIGHLIGHT_MS + 100 - Date.now())
    const timer = window.setTimeout(() => clearHighlight(threadId, token), delay)
    return () => window.clearTimeout(timer)
  }, [threadId, token, at, clearHighlight])

  if (!highlight || Date.now() - highlight.at > INBOX_TERMINAL_HIGHLIGHT_MS) return null

  return (
    <div
      key={highlight.token}
      aria-hidden="true"
      data-testid="inbox-terminal-highlight"
      data-tone={highlight.tone}
      className="inbox-terminal-highlight"
    />
  )
}
