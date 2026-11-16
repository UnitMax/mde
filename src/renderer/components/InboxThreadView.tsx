import { InboxAutomationsDialog } from '@/components/inbox/InboxAutomationsDialog'
import { useRef, type ReactNode } from 'react'
import { InboxLockedNotice, useInboxLock } from '@/components/InboxPanel'
import { ChatThreadView } from '@/components/inbox/ChatThreadView'
import { ThreadHeader } from '@/components/inbox/ThreadHeader'
import { NewThreadView } from '@/components/inbox/NewThreadView'
import { useFloatingReserve } from '@/components/inbox/use-floating-reserve'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'

/**
 * Where the sidebar floats as a card over the conversation's corner, the conversation moves out from under it while
 * there is room for both side by side; with too little, the card floats over it.
 */
function MakesWayForCard({ page = false, children }: { page?: boolean; children: ReactNode }): JSX.Element {
  const area = useRef<HTMLDivElement>(null)
  const style = useFloatingReserve(area)
  return (
    <div ref={area} data-testid="inbox-card-reserve" style={style} className={cn('flex min-h-0 flex-1 flex-col transition-[padding] duration-150 motion-reduce:transition-none', page && 'h-full')}>
      {children}
    </div>
  )
}

/**
 * Main area of the Inbox: the new-thread page when nothing is selected,
 * otherwise the selected thread's conversation.
 */
export function InboxThreadView(): JSX.Element {
  const threads = useWorkspace((state) => state.inboxThreads)
  const selectedId = useWorkspace((state) => state.selectedInboxThreadId)
  const lock = useInboxLock()
  const markSeen = useWorkspace((state) => state.markOpenInboxThreadSeen)
  const thread = threads.find((item) => item.id === selectedId) ?? null

  if (lock) return <InboxLockedNotice />
  if (!thread) return <><MakesWayForCard page><NewThreadView /></MakesWayForCard><InboxAutomationsDialog /></>

  return (
    // Something new in the open thread stays unread until the person acts in it: a click anywhere in the thread,
    // or a key (typing a reply). Capture, so an editor that stops the event still counts.
    <div className="flex h-full min-h-0 flex-col" onPointerDownCapture={markSeen} onKeyDownCapture={markSeen}>
      <ThreadHeader thread={thread} />
      <InboxAutomationsDialog />
      <MakesWayForCard><ChatThreadView key={thread.id} thread={thread} /></MakesWayForCard>
    </div>
  )
}
