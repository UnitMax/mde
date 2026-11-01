import { Folder, GitBranch, Inbox, MessagesSquare, Sparkles } from 'lucide-react'
import {
  InboxLockedNotice,
  InboxStatusBadge,
  useInboxClock,
  useInboxLock
} from '@/components/InboxPanel'
import { inboxModelLabel } from '@/lib/inbox'
import { sessionAge, sessionDate } from '@/lib/opencode-sessions'
import { useWorkspace } from '@/store/workspace'

/**
 * Main area of the Inbox. The conversation view is not built yet, so a
 * selected thread shows its details above a placeholder.
 */
export function InboxThreadView(): JSX.Element {
  const threads = useWorkspace((state) => state.inboxThreads)
  const selectedId = useWorkspace((state) => state.selectedInboxThreadId)
  const lock = useInboxLock()
  const now = useInboxClock()
  const thread = threads.find((item) => item.id === selectedId) ?? null

  if (lock) return <InboxLockedNotice reason={lock} />

  if (!thread) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Inbox className="h-6 w-6 text-fg-subtle" />
        <div>
          <p className="text-[13px] text-fg-muted">No thread selected</p>
          <p className="mt-1 text-xs text-fg-subtle">
            Pick an OpenCode thread in the Inbox to see its details.
          </p>
        </div>
      </div>
    )
  }

  const model = inboxModelLabel(thread.model)

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="inbox-thread-view">
      <header className="shrink-0 border-b border-line px-5 py-3">
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
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <MessagesSquare className="h-6 w-6 text-fg-subtle" />
        <div>
          <p className="text-[13px] text-fg-muted">Conversation view coming soon</p>
          <p className="mt-1 max-w-md text-xs text-fg-subtle">
            This is where the conversation with the agent will appear, with model selection, a
            prompt box, and image attachments.
          </p>
        </div>
      </div>
    </div>
  )
}
