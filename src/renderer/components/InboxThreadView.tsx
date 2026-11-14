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

  if (lock) return <InboxLockedNotice />
  if (!thread) return <NewThreadView />

  return (
    // Something new in the open thread stays unread until the person acts in it: a click anywhere in the thread,
    // or a key (typing a reply). Capture, so a terminal or editor that stops the event still counts.
    <div className="flex h-full min-h-0 flex-col" onPointerDownCapture={markSeen} onKeyDownCapture={markSeen}>
      <ThreadHeader thread={thread} />
      {/* A terminal thread whose worktree was deleted has no folder to start in; its conversation is read as a chat. */}
      {thread.mode === 'terminal' && thread.worktreeRemovedAt === undefined
        ? <TerminalThreadView key={thread.id} thread={thread} />
        : <ChatThreadView key={thread.id} thread={thread} />}
    </div>
  )
}
