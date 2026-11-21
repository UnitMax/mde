import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useInboxView } from '@/store/inbox-view'

/**
 * Hides or shows the Inbox's left-hand sidebar, the thread list, so the conversation can have the whole width. Sits
 * just left of the conversation's title; on the new-thread page, which has no title bar, in its top-left corner.
 */
export function ThreadListToggle({ className }: { className?: string }): JSX.Element {
  const hidden = useInboxView((state) => state.threadListHidden)
  const label = hidden ? 'Show the thread list' : 'Hide the thread list'
  const Icon = hidden ? PanelLeftOpen : PanelLeftClose
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      aria-pressed={hidden}
      data-testid="inbox-thread-list-toggle"
      className={cn('shrink-0 text-fg-subtle hover:text-fg', className)}
      onClick={() => useInboxView.getState().setThreadListHidden(!hidden)}
    >
      <Icon className="h-4 w-4" />
    </Button>
  )
}
