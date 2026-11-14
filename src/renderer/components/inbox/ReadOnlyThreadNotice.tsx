import { FolderX } from 'lucide-react'
import type { InboxThread } from '@shared/types'

/**
 * In place of the composer, for a thread whose worktree was deleted: the conversation is kept to read, but there
 * is no folder left to run anything in.
 */
export function ReadOnlyThreadNotice({ thread }: { thread: InboxThread }): JSX.Element {
  const removedAt = thread.worktreeRemovedAt
  return (
    <div
      role="status"
      data-testid="inbox-thread-read-only"
      className="flex items-start gap-2.5 rounded-lg border border-line bg-elevated/40 px-3.5 py-3 text-[13px] text-fg-muted"
    >
      <FolderX aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" />
      <p className="min-w-0">
        The worktree this thread ran in
        {thread.worktree && <> (<span className="inbox-code-font text-fg">{thread.worktree.branch}</span>)</>}
        {' '}was deleted{removedAt !== undefined && <> on {new Date(removedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</>}.
        {' '}The conversation is kept to read; start a new thread to carry on.
      </p>
    </div>
  )
}
