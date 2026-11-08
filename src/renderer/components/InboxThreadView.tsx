import { useEffect } from 'react'
import { InboxLockedNotice, useInboxLock } from '@/components/InboxPanel'
import { ChatThreadView } from '@/components/inbox/ChatThreadView'
import { ThreadHeader } from '@/components/inbox/ThreadHeader'
import { NewThreadView } from '@/components/inbox/NewThreadView'
import { TerminalThreadView } from '@/components/inbox/TerminalThreadView'
import { useWorkspace } from '@/store/workspace'

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

  // Coming back to the window counts as seeing what the open thread did meanwhile.
  useEffect(() => {
    window.addEventListener('focus', markSeen)
    return () => window.removeEventListener('focus', markSeen)
  }, [markSeen])

  if (lock) return <InboxLockedNotice />
  if (!thread) return <NewThreadView />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ThreadHeader thread={thread} />
      {thread.mode === 'terminal'
        ? <TerminalThreadView key={thread.id} thread={thread} />
        : <ChatThreadView key={thread.id} thread={thread} />}
    </div>
  )
}
