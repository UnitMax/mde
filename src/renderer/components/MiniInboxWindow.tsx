import { Circle, CircleAlert, CircleCheck, CircleX, Folder, Inbox, LoaderCircle, Maximize2 } from 'lucide-react'
import type { InboxFolder, InboxThread } from '@shared/types'
import { TitleBar, TitleBarButton } from '@/components/TitleBar'
import { inboxStatusChip, isInboxThreadUnread, visibleInboxThreads } from '@/lib/inbox'
import { groupThreadsByFolder, miniInboxChips, summarizeThreads, type MiniInboxChipTone } from '@/lib/mini-inbox'
import { cn } from '@/lib/utils'

const ROW_TINT: Partial<Record<InboxThread['status'], string>> = {
  attention: 'bg-accent/10',
  completed: 'bg-ok/10',
  error: 'bg-danger/10',
}

const STATUS_ICON = {
  idle: Circle,
  working: LoaderCircle,
  attention: CircleAlert,
  completed: CircleCheck,
  error: CircleX,
}

const CHIP_TONE: Record<MiniInboxChipTone, string> = {
  accent: 'bg-accent/15 text-accent',
  ok: 'bg-ok/15 text-ok',
  danger: 'bg-danger/15 text-danger',
}

export function MiniInboxWindow({
  threads,
  folders,
  onRestore,
  onOpenThread,
}: {
  threads: readonly InboxThread[]
  folders: readonly InboxFolder[]
  onRestore: () => void
  onOpenThread: (threadId: string) => void
}): JSX.Element {
  const listed = visibleInboxThreads(threads, 'all', '')
  const groups = groupThreadsByFolder(listed, folders)
  const chips = miniInboxChips(summarizeThreads(listed))

  return (
    <div data-testid="mini-inbox-window" className="flex h-full w-full flex-col overflow-hidden bg-bg text-fg">
      <TitleBar
        icon={<Inbox className="h-3.5 w-3.5 shrink-0 text-fg-muted" />}
        title={
          <>
            <h1 className="text-[12px] font-medium">Inbox</h1>
            <span className="text-[11px] font-normal text-fg-subtle" data-testid="mini-inbox-count">{listed.length}</span>
          </>
        }
      >
        <TitleBarButton
          data-testid="mini-inbox-restore"
          onClick={onRestore}
          title="Restore the full window (F12)"
          aria-label="Restore the full window"
        >
          <Maximize2 className="h-3 w-3" />
          <span className="text-[10px] leading-none">F12</span>
        </TitleBarButton>
      </TitleBar>
      {chips.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-1 border-b border-line px-3 py-1.5" data-testid="mini-inbox-summary">
          {chips.map((chip) => (
            <span
              key={chip.key}
              data-testid={`mini-inbox-chip-${chip.key}`}
              className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium leading-none', CHIP_TONE[chip.tone])}
            >
              {chip.label}
            </span>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {groups.length === 0 ? (
          <div data-testid="mini-inbox-empty" className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Inbox className="h-5 w-5 text-fg-subtle" />
            <p className="text-[12px] text-fg-muted">No Inbox threads</p>
            <p className="text-[11px] text-fg-subtle">Start a conversation in the Inbox to see it here. Parked threads are hidden.</p>
          </div>
        ) : groups.map((group) => (
          <section key={group.folderId} data-testid="mini-inbox-group" aria-label={group.name} className="px-1.5 pb-1">
            <div className="flex items-center gap-1.5 px-1.5 pb-0.5 pt-1.5" title={group.directory}>
              <Folder className="h-3 w-3 shrink-0 text-fg-subtle" aria-hidden="true" />
              <h2 className="min-w-0 flex-1 truncate text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{group.name}</h2>
            </div>
            <div className="space-y-0.5">
              {group.threads.map((thread) => {
                const status = inboxStatusChip(thread)?.label ?? 'Idle'
                const StatusIcon = STATUS_ICON[thread.status]
                const unread = isInboxThreadUnread(thread)
                return (
                  <button
                    key={thread.id}
                    type="button"
                    data-testid="mini-inbox-row"
                    data-status={thread.status}
                    data-unread={unread || undefined}
                    title={`${thread.customTitle ?? thread.title} · ${group.directory} · ${status}`}
                    onClick={() => onOpenThread(thread.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-fg-muted hover:bg-hover hover:text-fg',
                      ROW_TINT[thread.status],
                    )}
                  >
                    <StatusIcon
                      aria-hidden="true"
                      className={cn('h-3 w-3 shrink-0', thread.status === 'working' && 'animate-spin motion-reduce:animate-none')}
                    />
                    <div className="min-w-0 flex-1">
                      <div className={cn('truncate text-fg', unread && 'font-semibold')}>{thread.customTitle ?? thread.title}</div>
                      {thread.branch && <div className="truncate text-[10px] text-fg-subtle">{thread.branch}</div>}
                    </div>
                    <span className="shrink-0 text-[10px] text-fg-subtle">{status}</span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
