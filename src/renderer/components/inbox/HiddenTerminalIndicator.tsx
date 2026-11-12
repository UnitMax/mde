import { useEffect, useRef, useState } from 'react'
import { Terminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useInboxFloatingTerminal } from '@/store/inbox-floating-terminal'
import { useInboxTerminal } from '@/store/inbox-terminal'

/** How long the reminder says that an agent opened a terminal, before it goes back to counting them. */
export const AGENT_ARRIVAL_MS = 4000

/**
 * The reminder at the foot of the Inbox's thread list that the floating terminal is there but hidden (F11),
 * and the way back to it with the mouse. Draws nothing while the terminal is in the sidebar or on screen.
 * When an agent opens a terminal while it is hidden, the reminder lights up and a small terminal drops into it;
 * a command waiting for approval keeps it saying so until the person shows the terminal and answers.
 */
export function HiddenTerminalIndicator(): JSX.Element | null {
  const hidden = useInboxFloatingTerminal((state) => state.floating && !state.visible)
  const panes = useInboxTerminal((state) => state.layout.panes.length)
  const arrivals = useInboxTerminal((state) => state.agentArrivals)
  const waiting = useInboxTerminal((state) => Object.keys(state.agentCommands).length)
  const seen = useRef(arrivals)
  const [arrival, setArrival] = useState<number | null>(null)

  useEffect(() => {
    if (arrivals === seen.current) return
    seen.current = arrivals
    // Only an arrival while hidden: one the person saw come in needs no reminder.
    if (!hidden) return
    setArrival(arrivals)
    const timer = window.setTimeout(() => setArrival(null), AGENT_ARRIVAL_MS)
    return () => window.clearTimeout(timer)
  }, [arrivals, hidden])

  useEffect(() => {
    if (!hidden) setArrival(null)
  }, [hidden])

  if (!hidden) return null
  const what = panes > 1 ? `${panes} terminals` : 'Terminal'
  const fresh = arrival !== null
  // Short enough for the sidebar's narrowest width (260 px) beside the F11 key.
  const label = fresh
    ? 'New agent terminal'
    : waiting > 0
      ? `${waiting} ${waiting === 1 ? 'command' : 'commands'} to approve`
      : `${what} hidden`
  const announcing = fresh || waiting > 0
  return (
    <div className="hidden-terminal-indicator shrink-0 px-2 pb-2">
      <button
        // A new key replays the animation for every arrival.
        key={arrival ?? 'idle'}
        type="button"
        data-testid="hidden-terminal-indicator"
        data-arrival={fresh ? 'true' : 'false'}
        data-waiting={waiting > 0 ? 'true' : 'false'}
        title={fresh
          ? 'An agent opened a terminal. Show it (F11)'
          : waiting > 0
            ? `An agent asked to run ${waiting === 1 ? 'a command' : 'commands'}. Show the terminal to approve (F11)`
            : `Show the floating ${panes > 1 ? 'terminals' : 'terminal'} (F11)`}
        aria-label={`${fresh ? 'An agent opened a terminal' : label}. Show (F11)`}
        onClick={() => useInboxFloatingTerminal.getState().show()}
        className={cn(
          'group relative flex h-8 w-full items-center gap-2 overflow-hidden rounded-md border border-line bg-hover/40 pl-2 pr-1.5 text-left transition-colors hover:border-line-strong hover:bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
          fresh && 'hidden-terminal-arrival',
          waiting > 0 && !fresh && 'border-accent/50',
        )}
      >
        <span className={cn('relative flex shrink-0', fresh && 'hidden-terminal-arrival-icon')}>
          <Terminal className={cn('h-3.5 w-3.5 transition-colors group-hover:text-accent', announcing ? 'text-accent' : 'text-fg-subtle')} aria-hidden />
          {/* The shells are still running behind the scenes. */}
          <span className={cn('absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-accent ring-2 ring-panel', announcing && 'hidden-terminal-ping')} aria-hidden />
        </span>
        <span
          className={cn('min-w-0 flex-1 truncate text-[12px] transition-colors group-hover:text-fg', announcing ? 'text-fg' : 'text-fg-muted')}
          aria-live="polite"
        >
          {announcing ? label : <>{what} <span className="text-fg-subtle">hidden</span></>}
        </span>
        {/* Room for the longer words while there is news; the title still says what a click does. */}
        {!announcing && (
          <span className="shrink-0 text-[11px] text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden>
            Show
          </span>
        )}
        <kbd className="shrink-0 rounded border border-line-strong px-1.5 font-sans text-[10px] leading-4 text-fg-subtle" aria-hidden>
          F11
        </kbd>
      </button>
    </div>
  )
}
