import { Circle, CircleAlert, CircleCheck, CircleX, GitBranch, Inbox, LoaderCircle, Maximize2, Pin } from 'lucide-react'
import type { InboxFolder, InboxThread } from '@shared/types'
import { ProjectIcon } from '@/components/inbox/ProjectIcon'
import { StatusMark, statusGlyph } from '@/components/inbox/StatusMark'
import { TitleBar, TitleBarButton } from '@/components/TitleBar'
import { useInboxClock } from '@/components/InboxPanel'
import { inboxStatusChip, isInboxThreadUnread, sessionAge, sessionDate, visibleInboxThreads } from '@/lib/inbox'
import { miniInboxChips, miniInboxProject, summarizeThreads } from '@/lib/mini-inbox'
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
  const now = useInboxClock()
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
        <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-b border-line px-3 py-2" data-testid="mini-inbox-summary">
          {chips.map((chip) => (
            <StatusMark
              key={chip.key}
              data-testid={`mini-inbox-chip-${chip.key}`}
              tone={chip.tone}
              glyph={statusGlyph(chip.key)}
            >
              {chip.label}
            </StatusMark>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {listed.length === 0 ? (
          <div data-testid="mini-inbox-empty" className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Inbox className="h-5 w-5 text-fg-subtle" />
            <p className="text-[12px] text-fg-muted">No Inbox threads</p>
            <p className="text-[11px] text-fg-subtle">Start a conversation in the Inbox to see it here. Parked threads are hidden.</p>
          </div>
        ) : (
          <ul data-testid="mini-inbox-list" aria-label="Inbox threads" className="space-y-0.5">
            {listed.map((thread) => {
              const chip = inboxStatusChip(thread)
              const status = chip?.label ?? 'Idle'
              const StatusIcon = STATUS_ICON[thread.status]
              const unread = isInboxThreadUnread(thread)
              const project = miniInboxProject(thread, folders)
              const title = thread.customTitle ?? thread.title
              return (
                <li key={thread.id}>
                  <button
                    type="button"
                    data-testid="mini-inbox-row"
                    data-status={thread.status}
                    data-unread={unread || undefined}
                    title={`${title} · ${project.directory} · ${status}`}
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
                      <div className="flex min-w-0 items-center gap-1">
                        {thread.pinned && <Pin role="img" aria-label="Pinned thread" className="h-3 w-3 shrink-0 text-fg-subtle" />}
                        <span className={cn('min-w-0 truncate text-fg', unread && 'font-semibold')}>{title}</span>
                      </div>
                      <div className="flex min-w-0 items-center gap-1 text-[10px] text-fg-subtle">
                        <ProjectIcon icon={project.icon} />
                        <span data-testid="mini-inbox-project" className="min-w-0 truncate">{project.name}</span>
                        {thread.branch && (
                          <>
                            <GitBranch aria-hidden="true" className="ml-1 h-3 w-3 shrink-0" />
                            <span className="min-w-0 truncate">{thread.branch}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5 text-[10px] text-fg-subtle">
                      <time
                        data-testid="mini-inbox-age"
                        dateTime={new Date(thread.lastActivityAt).toISOString()}
                        title={sessionDate(thread.lastActivityAt)}
                      >
                        {sessionAge(thread.lastActivityAt, now)}
                      </time>
                      {chip ? <StatusMark tone={chip.tone} glyph={statusGlyph(thread.status)}>{chip.label}</StatusMark> : <span>{status}</span>}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
