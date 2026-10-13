import { useEffect } from 'react'
import { TERMINAL_HIGHLIGHT_MS } from '@/lib/terminal-highlight'
import { useWorkspace } from '@/store/workspace'

/**
 * One-shot comet sweep and glow around a terminal pane. The flash lives in the store rather than
 * here because the pane remounts on session switches; the CSS lives in index.css.
 */
export function TerminalPaneHighlight({ terminalId }: { terminalId: string }): JSX.Element | null {
  const highlight = useWorkspace((state) => state.terminalHighlights[terminalId])
  const clearTerminalHighlight = useWorkspace((state) => state.clearTerminalHighlight)
  const token = highlight?.token
  const at = highlight?.at

  // A timer rather than animationend: that event never arrives if the element is hidden or the
  // reduced-motion preference swaps the animation. An entry left by an unmounted pane is stale
  // on arrival and is cleared without playing.
  useEffect(() => {
    if (token === undefined || at === undefined) return
    const delay = Math.max(0, at + TERMINAL_HIGHLIGHT_MS + 100 - Date.now())
    const timer = window.setTimeout(() => clearTerminalHighlight(terminalId, token), delay)
    return () => window.clearTimeout(timer)
  }, [terminalId, token, at, clearTerminalHighlight])

  if (!highlight || Date.now() - highlight.at > TERMINAL_HIGHLIGHT_MS) return null

  return (
    <div
      key={highlight.token}
      aria-hidden="true"
      data-testid="terminal-pane-highlight"
      data-tone={highlight.tone}
      className="terminal-pane-highlight"
    />
  )
}
