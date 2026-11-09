import { Terminal } from 'lucide-react'
import { useInboxFloatingTerminal } from '@/store/inbox-floating-terminal'
import { useInboxTerminal } from '@/store/inbox-terminal'

/**
 * The reminder at the foot of the Inbox's thread list that the floating terminal is there but hidden (F11),
 * and the way back to it with the mouse. Draws nothing while the terminal is in the sidebar or on screen.
 */
export function HiddenTerminalIndicator(): JSX.Element | null {
  const hidden = useInboxFloatingTerminal((state) => state.floating && !state.visible)
  const panes = useInboxTerminal((state) => state.layout.panes.length)
  if (!hidden) return null
  const what = panes > 1 ? `${panes} terminals` : 'Terminal'
  return (
    <div className="hidden-terminal-indicator shrink-0 px-2 pb-2">
      <button
        type="button"
        data-testid="hidden-terminal-indicator"
        title={`Show the floating ${panes > 1 ? 'terminals' : 'terminal'} (F11)`}
        aria-label={`${what} hidden. Show (F11)`}
        onClick={() => useInboxFloatingTerminal.getState().show()}
        className="group flex h-8 w-full items-center gap-2 rounded-md border border-line bg-hover/40 pl-2 pr-1.5 text-left transition-colors hover:border-line-strong hover:bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        <span className="relative flex shrink-0">
          <Terminal className="h-3.5 w-3.5 text-fg-subtle transition-colors group-hover:text-accent" aria-hidden />
          {/* The shells are still running behind the scenes. */}
          <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-accent ring-2 ring-panel" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-fg-muted transition-colors group-hover:text-fg">
          {what} <span className="text-fg-subtle">hidden</span>
        </span>
        <span className="shrink-0 text-[11px] text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden>
          Show
        </span>
        <kbd className="shrink-0 rounded border border-line-strong px-1.5 font-sans text-[10px] leading-4 text-fg-subtle" aria-hidden>
          F11
        </kbd>
      </button>
    </div>
  )
}
