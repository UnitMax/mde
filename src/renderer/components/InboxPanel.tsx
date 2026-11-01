import { useEffect, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  Folder,
  GitBranch,
  LoaderCircle,
  Lock,
  Mail,
  MailOpen,
  PenSquare,
  Search,
  Settings2,
  Trash2
} from 'lucide-react'
import type { InboxThread } from '@shared/types'
import { Button } from '@/components/ui/button'
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
  inboxLockReason,
  inboxModelLabel,
  inboxStatusChip,
  isInboxThreadUnread,
  visibleInboxThreads,
  type InboxFilter,
  type InboxLockReason,
  type InboxStatusChip
} from '@/lib/inbox'
import { sessionAge, sessionDate } from '@/lib/opencode-sessions'
import { cn } from '@/lib/utils'
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

/** The current lock state; null while the Inbox can be used. */
export function useInboxLock(): InboxLockReason | null {
  const platform = useWorkspace((state) => state.platform)
  const wslAvailable = useWorkspace((state) => state.wslAvailable)
  const enabled = useWorkspace((state) => state.opencodeTuiEnabled)
  return inboxLockReason(platform, wslAvailable, enabled)
}

const CHIP_TONES: Record<InboxStatusChip['tone'], string> = {
  accent: 'bg-accent/15 text-accent',
  ok: 'bg-ok/15 text-ok',
  danger: 'bg-danger/15 text-danger',
  muted: 'bg-elevated text-fg-muted'
}

export function InboxStatusBadge({ thread }: { thread: InboxThread }): JSX.Element | null {
  const chip = inboxStatusChip(thread)
  if (!chip) return null
  return (
    <span
      data-testid="inbox-status-chip"
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-px text-[10px] font-medium',
        CHIP_TONES[chip.tone]
      )}
    >
      {thread.status === 'working' && (
        <LoaderCircle
          aria-hidden="true"
          className="h-2.5 w-2.5 animate-spin text-accent motion-reduce:animate-none"
        />
      )}
      {chip.label}
    </span>
  )
}

export function InboxLockedNotice({
  reason,
  compact = false
}: {
  reason: InboxLockReason
  compact?: boolean
}): JSX.Element {
  const openSettings = useWorkspace((state) => state.openSettings)
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
        <p className="text-[13px] text-fg-muted">Inbox is locked</p>
        <p className="mt-1 text-xs text-fg-subtle">
          {reason === 'unsupported'
            ? 'The Inbox is filled by the MDE status plugin for OpenCode, which runs on macOS and in WSL on Windows.'
            : 'The Inbox is filled by the MDE status plugin for OpenCode. Turn on status reporting and install the plugin in Settings → OpenCode.'}
        </p>
      </div>
      <Button size="sm" variant={compact ? 'secondary' : 'default'} onClick={() => openSettings('opencode')}>
        <Settings2 className="h-3.5 w-3.5" />
        Open OpenCode settings
      </Button>
    </div>
  )
}

function InboxThreadRow({
  thread,
  selected,
  now,
  onSelect
}: {
  thread: InboxThread
  selected: boolean
  now: number
  onSelect: () => void
}): JSX.Element {
  const setRead = useWorkspace((state) => state.setInboxThreadRead)
  const setArchived = useWorkspace((state) => state.setInboxThreadArchived)
  const removeThread = useWorkspace((state) => state.removeInboxThread)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const unread = isInboxThreadUnread(thread)
  const model = inboxModelLabel(thread.model)

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
                <InboxStatusBadge thread={thread} />
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
            This removes only MDE’s record. The OpenCode conversation itself is not changed, and
            the thread comes back if OpenCode reports new activity on it.
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
  const openSettings = useWorkspace((state) => state.openSettings)
  const lock = useInboxLock()
  const now = useInboxClock()
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [query, setQuery] = useState('')
  const visible = visibleInboxThreads(threads, filter, query)

  if (lock) return <InboxLockedNotice reason={lock} compact />

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
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="inbox-thread-list">
        {visible.length === 0 ? (
          <div className="px-2 py-1 text-xs text-fg-subtle">
            <p>{emptyMessage(filter, query)}</p>
            {threads.length === 0 && (
              <p className="mt-1">
                Start one with New thread. OpenCode conversations you run in MDE terminals appear
                here too; they need the MDE status plugin 2.1.0 or newer for each target in{' '}
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => openSettings('opencode')}
                >
                  Settings → OpenCode
                </button>
                ; restart OpenCode after updating it.
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
                onSelect={() => selectThread(thread.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
