import { useEffect } from 'react'
import { Folder, GitBranch, GitFork, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react'
import type { InboxThread } from '@shared/types'
import {
  InboxLockedNotice,
  InboxStatusBadge,
  useInboxClock,
  useInboxLock
} from '@/components/InboxPanel'
import { ChatThreadView } from '@/components/inbox/ChatThreadView'
import { NewThreadView } from '@/components/inbox/NewThreadView'
import { TerminalThreadView } from '@/components/inbox/TerminalThreadView'
import { inboxModelLabel, inboxThreadHome, sessionAge, sessionDate } from '@/lib/inbox'
import { useWorkspace } from '@/store/workspace'
import { useInboxChat } from '@/store/inbox-chat'
import { Button } from '@/components/ui/button'
import { OpenFolderButtons } from '@/components/OpenFolderButtons'

/** Says which thread this one was forked from, and that the two share a folder. */
function ForkedFrom({ source }: { source: string }): JSX.Element {
  const original = useWorkspace((state) => state.inboxThreads.find((item) => item.id === source))
  const select = useWorkspace((state) => state.selectInboxThread)
  return (
    <p
      className="mt-1.5 flex min-w-0 items-center gap-1 text-xs text-fg-subtle"
      data-testid="inbox-forked-from"
      title="This thread works in the same folder as the one it was forked from, so file changes made by either show up in both."
    >
      <GitFork aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">
        Forked from{' '}
        {original ? (
          <button
            type="button"
            onClick={() => select(original.id)}
            className="text-accent hover:underline"
            title={`Open ${original.customTitle ?? original.title}`}
          >
            {original.customTitle ?? original.title}
          </button>
        ) : (
          'a thread that is no longer in the Inbox'
        )}
        {' · '}
        works in the same folder, so file changes show up in both
      </span>
    </p>
  )
}

function ThreadHeader({ thread }: { thread: InboxThread }): JSX.Element {
  const now = useInboxClock()
  const model = inboxModelLabel(thread.model)
  const regeneration = useInboxChat((state) => state.titleRegenerations[thread.id])
  const regenerateTitle = useInboxChat((state) => state.regenerateTitle)
  return (
    <header className="shrink-0 border-b border-line px-5 py-3" data-testid="inbox-thread-view">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{thread.customTitle ?? thread.title}</h2>
        <InboxStatusBadge thread={thread} />
        <OpenFolderButtons
          target={{ inboxId: thread.id }}
          kind={thread.target.kind}
          distro={thread.target.kind === 'wsl' ? thread.target.distro : undefined}
        />
        <Button
          variant="ghost"
          size="sm"
          type="button"
          aria-label="Regenerate title"
          aria-busy={regeneration?.pending || undefined}
          disabled={regeneration?.pending}
          onClick={() => void regenerateTitle(thread.id)}
        >
          {regeneration?.pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {regeneration?.pending ? 'Regenerating…' : 'Regenerate title'}
        </Button>
      </div>
      {regeneration?.error && <p role="alert" className="mt-1.5 text-xs text-danger">{regeneration.error}</p>}
      <dl className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-subtle">
        <div className="flex min-w-0 items-center gap-1">
          <dt className="sr-only">Folder</dt>
          <Folder className="h-3.5 w-3.5 shrink-0" />
          <dd className="min-w-0 truncate" title={thread.directory}>
            {inboxThreadHome(thread)}
            {thread.target.kind === 'wsl' ? ` (${thread.target.distro})` : ''}
          </dd>
        </div>
        {(thread.branch || thread.worktree) && (
          <div className="flex min-w-0 items-center gap-1">
            <dt className="sr-only">Branch</dt>
            <GitBranch className="h-3.5 w-3.5 shrink-0" />
            <dd className="min-w-0 truncate">{thread.branch ?? thread.worktree?.branch}</dd>
            {thread.worktree && (
              <dd
                data-testid="inbox-thread-worktree"
                className="shrink-0 rounded bg-hover px-1 text-[10px] uppercase tracking-wide text-fg-muted"
                title={`Runs in a worktree of ${thread.worktree.repository}, started from ${thread.worktree.base}: ${thread.directory}`}
              >
                worktree
              </dd>
            )}
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
      {thread.forkedFrom && <ForkedFrom source={thread.forkedFrom} />}
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
