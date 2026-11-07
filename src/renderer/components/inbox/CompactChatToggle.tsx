import { ListCollapse } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useInboxView } from '@/store/inbox-view'

/**
 * Turns compact mode on and off, in the thread's header. Compact folds everything but the text (thoughts,
 * commands, reads, searches) into one line per stretch of work, and starts file changes shut.
 */
export function CompactChatToggle(): JSX.Element {
  const compact = useInboxView((state) => state.compactChat)
  const setCompact = useInboxView((state) => state.setCompactChat)
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      type="button"
      className={cn('shrink-0', compact && 'bg-active text-fg')}
      data-testid="chat-compact-toggle"
      aria-label="Compact mode"
      aria-pressed={compact}
      title={
        compact
          ? 'Compact mode is on: each stretch of work is one line. Click to show every step'
          : 'Compact mode: fold each stretch of work into one line, and start file changes shut'
      }
      onClick={() => setCompact(!compact)}
    >
      <ListCollapse className="h-3.5 w-3.5" />
    </Button>
  )
}
