import { useEffect, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  Folder,
  GitBranch,
  GitFork,
  LoaderCircle,
  Lock,
  Mail,
  MailOpen,
  PenSquare,
  Search,
  Trash2,
  X
} from 'lucide-react'
import type { InboxThread } from '@shared/types'
import { ElapsedTime } from '@/components/ElapsedTime'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  INBOX_CLOCK_MS,
  INBOX_FILTERS,
  inboxFolderLabel,
  inboxLocked,
  inboxCueActive,
  inboxModelLabel,
  inboxStatusChip,
  isInboxThreadUnread,
  visibleInboxThreads,
  type InboxFilter,
  type InboxStatusChip
} from '@/lib/inbox'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { sessionAge, sessionDate } from '@/lib/opencode-sessions'
import { cn } from '@/lib/utils'
import { useInboxChat } from '@/store/inbox-chat'
import { useWorkspace } from '@/store/workspace'

/** Re-renders on an interval so "5m ago" labels stay current. */
export function useInboxClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), INBOX_CLOCK_MS)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

/** True where the Inbox cannot be used. */
export function useInboxLock(): boolean {
  const platform = useWorkspace((state) => state.platform)
  const wslAvailable = useWorkspace((state) => state.wslAvailable)
  return inboxLocked(platform, wslAvailable)
}

const CHIP_TONES: Record<InboxStatusChip['tone'], string> = {
  accent: 'bg-accent/15 text-accent',
  ok: 'bg-ok/15 text-ok',
  danger: 'bg-danger/15 text-danger',
  muted: 'bg-elevated text-fg-muted'
}

/** `elapsed` adds how long a working thread has been going, counting up. */
export function InboxStatusBadge({
  thread,
  elapsed = false
}: {
  thread: InboxThread
  elapsed?: boolean
}): JSX.Element | null {
  const chip = inboxStatusChip(thread)
  const cueAt = useWorkspace((state) => state.inboxCues[thread.id])
  if (!chip) return null
  const cued = inboxCueActive(cueAt)
  return (
    <span
      // A new key replays the pop each time something new happens in the thread being read.
      key={cued ? cueAt : 'still'}
      data-testid="inbox-status-chip"
      data-cue={cued || undefined}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-px text-[10px] font-medium',
        CHIP_TONES[chip.tone],
        cued && 'inbox-cue-pop'
      )}
    >
      {thread.status === 'working' && (
        <LoaderCircle
          aria-hidden="true"
          className="h-2.5 w-2.5 animate-spin text-accent motion-reduce:animate-none"
        />
      )}
      {chip.label}
      {elapsed && thread.status === 'working' && thread.workingSince !== undefined && (
        <>
          <span aria-hidden="true" className="opacity-50">
            ·
          </span>
          <ElapsedTime since={thread.workingSince} className="font-normal text-fg-subtle" />
        </>
      )}
    </span>
  )
}

export function InboxLockedNotice({ compact = false }: { compact?: boolean }): JSX.Element {
  return (
    <div
      data-testid="inbox-locked"
      className={cn(
        'flex flex-col items-center text-center',
        compact ? 'gap-2 px-2 py-4' : 'h-full justify-center gap-3 px-6'
      )}
    >
      <Lock className={cn('text-fg-subtle', compact ? 'h-4 w-4' : 'h-6 w-6')} />
      <div>
        <p className="text-[13px] text-fg-muted">Inbox is not available here</p>
        <p className="mt-1 text-xs text-fg-subtle">
          The Inbox talks to OpenCode’s background service, which MDE can reach on macOS and in WSL
          on Windows.
        </p>
      </div>
    </div>
  )
}

function InboxThreadRow({
  thread,
  selected,
  now,
  forking,
  onSelect,
  onFork
}: {
  thread: InboxThread
  selected: boolean
  now: number
  /** A fork is being made, so another one waits. */
  forking: boolean
  onSelect: () => void
  onFork: () => void
}): JSX.Element {
  const setRead = useWorkspace((state) => state.setInboxThreadRead)
  const setArchived = useWorkspace((state) => state.setInboxThreadArchived)
  const removeThread = useWorkspace((state) => state.removeInboxThread)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const unread = isInboxThreadUnread(thread)
  const model = inboxModelLabel(thread.model)
  const cueAt = useWorkspace((state) => state.inboxCues[thread.id])

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="group relative">
          <button
            type="button"
            data-testid={`inbox-thread-${thread.id}`}
            data-unread={unread || undefined}
            aria-current={selected || undefined}
            onClick={onSelect}
            className={cn(
              'flex w-full min-w-0 flex-col gap-0.5 rounded px-2 py-1.5 text-left',
              selected ? 'bg-active' : 'hover:bg-hover'
            )}
          >
            <span className="flex w-full min-w-0 items-center gap-1.5">
              {unread && (
                <span
                  aria-label="Unread"
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                />
              )}
              {thread.forkedFrom && (
                <GitFork
                  role="img"
                  aria-label="Forked thread"
                  data-testid={`inbox-thread-fork-mark-${thread.id}`}
                  className="h-3 w-3 shrink-0 text-fg-subtle"
                />
              )}
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[13px]',
                  unread ? 'font-semibold text-fg' : selected ? 'text-fg' : 'text-fg-muted'
                )}
              >
                {thread.title}
              </span>
              <time
                dateTime={new Date(thread.lastActivityAt).toISOString()}
                title={sessionDate(thread.lastActivityAt)}
                className="shrink-0 text-[11px] text-fg-subtle group-hover:invisible"
              >
                {sessionAge(thread.lastActivityAt, now)}
              </time>
            </span>
            <span className="flex w-full min-w-0 items-center gap-1 text-[11px] text-fg-subtle">
              <Folder className="h-3 w-3 shrink-0" />
              <span className="min-w-0 truncate" title={thread.directory}>
                {inboxFolderLabel(thread.directory)}
              </span>
              {thread.branch && (
                <>
                  <GitBranch className="ml-1 h-3 w-3 shrink-0" />
                  <span className="min-w-0 truncate" title={thread.branch}>
                    {thread.branch}
                  </span>
                </>
              )}
            </span>
            {(model || inboxStatusChip(thread)) && (
              <span className="flex w-full min-w-0 items-center gap-1.5 text-[11px]">
                <span
                  className="min-w-0 flex-1 truncate text-fg-subtle"
                  title={thread.model ? `${thread.model.providerId}/${thread.model.id}` : undefined}
                >
                  {model}
                </span>
                <InboxStatusBadge thread={thread} elapsed />
              </span>
            )}
          </button>
          <button
            type="button"
            data-testid={`inbox-thread-archive-${thread.id}`}
            aria-label={thread.archived ? 'Move to Inbox' : 'Archive'}
            title={thread.archived ? 'Move to Inbox' : 'Archive'}
            onClick={() => void setArchived(thread.id, !thread.archived)}
            className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded text-fg-muted opacity-0 transition-opacity hover:bg-active hover:text-fg focus-visible:bg-active focus-visible:opacity-100 group-hover:opacity-100"
          >
            {thread.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
          </button>
          {inboxCueActive(cueAt) && (
            <span
              key={cueAt}
              aria-hidden="true"
              data-testid={`inbox-thread-cue-${thread.id}`}
              className="inbox-cue pointer-events-none absolute inset-0 rounded"
            />
          )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
          <ContextMenuItem onSelect={() => void setRead(thread.id, unread)}>
            {unread ? <MailOpen className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
            {unread ? 'Mark as read' : 'Mark as unread'}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void setArchived(thread.id, !thread.archived)}>
            {thread.archived ? (
              <ArchiveRestore className="h-3.5 w-3.5" />
            ) : (
              <Archive className="h-3.5 w-3.5" />
            )}
            {thread.archived ? 'Move to Inbox' : 'Archive'}
          </ContextMenuItem>
          <ContextMenuItem disabled={forking} onSelect={onFork}>
            <GitFork className="h-3.5 w-3.5" />
            Fork thread
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem destructive onSelect={() => setConfirmingRemove(true)}>
            <Trash2 className="h-3.5 w-3.5" />
            Delete from Inbox
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete “{thread.title}” from the Inbox?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the thread and any unsent draft from MDE’s Inbox. The OpenCode conversation is kept, and
            later activity will not restore it to the Inbox.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void removeThread(thread.id)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function emptyMessage(filter: InboxFilter, query: string): string {
  if (query.trim()) return 'No threads match your search.'
  if (filter === 'unread') return 'No unread threads.'
  if (filter === 'attention') return 'No threads need your input.'
  if (filter === 'archived') return 'No archived threads.'
  return 'No threads yet.'
}

/** The Inbox tab of the sidebar: OpenCode threads, most recent activity first. */
export function InboxPanel(): JSX.Element {
  const threads = useWorkspace((state) => state.inboxThreads)
  const selectedId = useWorkspace((state) => state.selectedInboxThreadId)
  const selectThread = useWorkspace((state) => state.selectInboxThread)
  const lock = useInboxLock()
  const now = useInboxClock()
  const forkThread = useInboxChat((state) => state.forkThread)
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [query, setQuery] = useState('')
  // A fork is a request to the service and can fail; the menu has no place to say so.
  const [fork, setFork] = useState<{ pending: boolean; error: string | null }>({ pending: false, error: null })
  const visible = visibleInboxThreads(threads, filter, query)
  const startFork = (thread: InboxThread): void => {
    if (fork.pending) return
    setFork({ pending: true, error: null })
    forkThread(thread.id).then(
      () => setFork({ pending: false, error: null }),
      (error: unknown) => setFork({ pending: false, error: ipcErrorMessage(error, 'Could not fork the thread.') })
    )
  }

  if (lock) return <InboxLockedNotice compact />

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="px-1 pt-0.5">
        <button
          type="button"
          data-testid="inbox-new-thread-button"
          aria-current={selectedId === null || undefined}
          onClick={() => selectThread(null)}
          className={cn(
            'flex h-7 w-full items-center gap-2 rounded px-2 text-[13px] transition-colors',
            selectedId === null ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
          )}
        >
          <PenSquare className="h-3.5 w-3.5" />
          New thread
        </button>
      </div>
      <div className="relative px-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
        <Input
          aria-label="Search inbox"
          placeholder="Search threads"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) {
              event.stopPropagation()
              setQuery('')
            }
          }}
          className="h-7 pl-7 text-xs"
        />
      </div>
      <div role="group" aria-label="Inbox filter" className="flex gap-0.5 px-1">
        {INBOX_FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={filter === option.id}
            onClick={() => setFilter(option.id)}
            className={cn(
              'h-6 rounded px-1.5 text-[11px] transition-colors',
              filter === option.id
                ? 'bg-active text-fg'
                : 'text-fg-subtle hover:bg-hover hover:text-fg'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {fork.pending && (
        <p role="status" data-testid="inbox-fork-status" className="mx-1 flex items-center gap-1.5 rounded bg-elevated px-2 py-1 text-[11px] text-fg-muted">
          <LoaderCircle aria-hidden="true" className="h-3 w-3 shrink-0 animate-spin text-accent motion-reduce:animate-none" />
          Forking thread…
        </p>
      )}
      {fork.error && (
        <div role="alert" data-testid="inbox-fork-error" className="mx-1 flex items-start gap-1.5 rounded bg-danger/10 px-2 py-1 text-[11px] text-danger">
          <span className="min-w-0 flex-1 break-words">{fork.error}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setFork({ pending: false, error: null })}
            className="mt-px shrink-0 rounded text-danger/80 hover:text-danger"
          >
            <X aria-hidden="true" className="h-3 w-3" />
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="inbox-thread-list">
        {visible.length === 0 ? (
          <div className="px-2 py-1 text-xs text-fg-subtle">
            <p>{emptyMessage(filter, query)}</p>
            {threads.length === 0 && (
              <p className="mt-1">
                Start one with New thread.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {visible.map((thread) => (
              <InboxThreadRow
                key={thread.id}
                thread={thread}
                selected={thread.id === selectedId}
                now={now}
                forking={fork.pending}
                onSelect={() => selectThread(thread.id)}
                onFork={() => startFork(thread)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
