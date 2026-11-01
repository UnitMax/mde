import { Folder, GitBranch, Sparkles } from 'lucide-react'
import type { InboxThread } from '@shared/types'
import {
  InboxLockedNotice,
  InboxStatusBadge,
  useInboxClock,
  useInboxLock
} from '@/components/InboxPanel'
import { ChatThreadView } from '@/components/inbox/ChatThreadView'
import { NewThreadView } from '@/components/inbox/NewThreadView'
import { inboxModelLabel } from '@/lib/inbox'
import { sessionAge, sessionDate } from '@/lib/opencode-sessions'
import { useWorkspace } from '@/store/workspace'

function ThreadHeader({ thread }: { thread: InboxThread }): JSX.Element {
  const now = useInboxClock()
  const model = inboxModelLabel(thread.model)
  return (
    <header className="shrink-0 border-b border-line px-5 py-3" data-testid="inbox-thread-view">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{thread.title}</h2>
        <InboxStatusBadge thread={thread} />
      </div>
      <dl className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-subtle">
        <div className="flex min-w-0 items-center gap-1">
          <dt className="sr-only">Folder</dt>
          <Folder className="h-3.5 w-3.5 shrink-0" />
          <dd className="min-w-0 truncate" title={thread.directory}>
            {thread.directory}
            {thread.target.kind === 'wsl' ? ` (${thread.target.distro})` : ''}
          </dd>
        </div>
        {thread.branch && (
          <div className="flex min-w-0 items-center gap-1">
            <dt className="sr-only">Branch</dt>
            <GitBranch className="h-3.5 w-3.5 shrink-0" />
            <dd className="min-w-0 truncate">{thread.branch}</dd>
          </div>
        )}
        {model && thread.model && (
          <div className="flex min-w-0 items-center gap-1">
            <dt className="sr-only">Model</dt>
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <dd className="min-w-0 truncate" title={`${thread.model.providerId}/${thread.model.id}`}>
              {model}
            </dd>
          </div>
        )}
        <div className="flex items-center gap-1">
          <dt className="sr-only">Last activity</dt>
          <dd title={sessionDate(thread.lastActivityAt)}>
            Last activity {sessionAge(thread.lastActivityAt, now).toLowerCase()}
          </dd>
        </div>
      </dl>
    </header>
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
  const thread = threads.find((item) => item.id === selectedId) ?? null

  if (lock) return <InboxLockedNotice reason={lock} />
  if (!thread) return <NewThreadView />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ThreadHeader thread={thread} />
      <ChatThreadView key={thread.id} thread={thread} />
    </div>
  )
}
