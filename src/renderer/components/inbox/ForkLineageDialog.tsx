import { useMemo, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Archive, GitFork } from 'lucide-react'
import { InboxStatusBadge, useInboxClock } from '@/components/InboxPanel'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { forkLineage, type LineageRow } from '@/lib/fork-lineage'
import { dayTimeLabel } from '@/lib/time-label'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'

/** Width of one level of the tree; the dot of a thread sits in the middle of its level, where its forks' lines start. */
const LEVEL = 20
const LINE = 'absolute w-px bg-line-strong'

/** The lines leading to one thread: on from the levels above, then the bend into its own. */
function Lines({ row }: { row: LineageRow }): JSX.Element | null {
  if (row.depth === 0) return null
  return (
    <>
      {row.guides.map((on, level) => (
        <span key={level} aria-hidden className="relative h-full shrink-0" style={{ width: LEVEL }}>
          {on && <span className={cn(LINE, 'inset-y-0')} style={{ left: LEVEL / 2 }} />}
        </span>
      ))}
      <span aria-hidden className="relative h-full shrink-0" style={{ width: LEVEL }}>
        <span className={cn(LINE, 'top-0', row.last ? 'h-1/2' : 'bottom-0')} style={{ left: LEVEL / 2 }} />
        <span className="absolute top-1/2 h-px bg-line-strong" style={{ left: LEVEL / 2, right: -(LEVEL / 2 - 6) }} />
      </span>
    </>
  )
}

/** The thread's own place on the tree, with the line down to its forks. */
function Dot({ row, current }: { row: LineageRow; current: boolean }): JSX.Element {
  return (
    <span aria-hidden className="relative flex h-full shrink-0 items-center justify-center" style={{ width: LEVEL }}>
      {row.forks > 0 && <span className={cn(LINE, 'bottom-0 top-1/2')} style={{ left: LEVEL / 2 }} />}
      <span
        className={cn(
          'relative h-2 w-2 rounded-full',
          !row.thread ? 'border border-dashed border-fg-subtle bg-elevated'
            : current ? 'bg-accent ring-4 ring-accent/20'
              : 'bg-fg-subtle group-hover/lineage:bg-fg-muted',
        )}
      />
    </span>
  )
}

/** Up and Down (Home and End) walk the threads that can be opened. */
function walkRows(event: ReactKeyboardEvent<HTMLElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button[role="treeitem"]'))
  const at = rows.indexOf(document.activeElement as HTMLElement)
  const next = event.key === 'Home' ? rows[0]
    : event.key === 'End' ? rows[rows.length - 1]
      : rows[Math.max(0, Math.min(rows.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]
  if (!next) return
  event.preventDefault()
  next.focus()
}

/**
 * The tree of forks the open thread belongs to: the thread it all began with, every fork of it and every fork of a
 * fork, each with its state. Choosing one opens it.
 */
export function ForkLineageDialog({ threadId, open, onOpenChange }: { threadId: string; open: boolean; onOpenChange(open: boolean): void }): JSX.Element {
  const threads = useWorkspace((state) => state.inboxThreads)
  const select = useWorkspace((state) => state.selectInboxThread)
  const rows = useMemo(() => forkLineage(threads, threadId), [threads, threadId])
  const now = useInboxClock()
  const count = rows.filter((row) => row.thread).length
  const openThread = (id: string): void => {
    onOpenChange(false)
    if (id !== threadId) select(id)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(36rem,calc(100vh-4rem))] max-w-xl flex-col gap-0 overflow-hidden p-0"
        data-testid="fork-lineage-dialog"
        onOpenAutoFocus={(event) => {
          // Starts on the open thread, so that the arrows go from where the person is.
          const here = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[aria-current="true"]')
          if (here) {
            event.preventDefault()
            here.focus()
          }
        }}
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-hover text-fg-muted">
            <GitFork aria-hidden className="h-4 w-4" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <DialogTitle>Fork lineage</DialogTitle>
            <DialogDescription>
              {count === 1 ? '1 thread' : `${count} threads`} forked from one conversation. Choose one to open it.
            </DialogDescription>
          </div>
        </div>
        <div role="tree" aria-label="Fork lineage" onKeyDown={walkRows} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
          {rows.map((row) => {
            const thread = row.thread
            const current = row.id === threadId
            const name = thread ? (thread.customTitle ?? thread.title) : 'A thread no longer in the Inbox'
            const when = thread ? dayTimeLabel(thread.createdAt, now) : null
            const body = (
              <>
                <span className="flex h-full shrink-0">
                  <Lines row={row} />
                  <Dot row={row} current={current} />
                </span>
                <span className={cn('ml-1.5 min-w-0 flex-1 truncate', !thread && 'italic text-fg-subtle', current && 'font-medium text-fg')}>{name}</span>
                {current && <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-px text-[11px] font-medium text-accent">This thread</span>}
                {thread?.archived && (
                  <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-fg-subtle" title="Archived">
                    <Archive aria-hidden className="h-3 w-3" />
                    Archived
                  </span>
                )}
                {thread && <span className="shrink-0 text-[12px]"><InboxStatusBadge thread={thread} hideDone /></span>}
                {when && <span className="w-28 shrink-0 truncate text-right text-[11.5px] tabular-nums text-fg-subtle">{when}</span>}
              </>
            )
            const className = cn(
              'group/lineage flex h-9 w-full min-w-0 items-center gap-2 rounded-lg pl-1 pr-2.5 text-left text-[13px]',
              current ? 'bg-accent/[0.07]' : '',
            )
            if (!thread) {
              return (
                <div key={row.id} role="treeitem" aria-level={row.depth + 1} aria-disabled="true" className={className} data-testid="fork-lineage-removed">
                  {body}
                </div>
              )
            }
            return (
              <button
                key={row.id}
                type="button"
                role="treeitem"
                aria-level={row.depth + 1}
                aria-current={current || undefined}
                title={`${row.depth === 0 ? 'Started' : 'Forked'} ${when}`}
                onClick={() => openThread(thread.id)}
                data-testid={`fork-lineage-${thread.id}`}
                className={cn(className, 'text-fg-muted transition-colors hover:bg-hover hover:text-fg focus-visible:bg-hover focus-visible:text-fg focus-visible:outline-none')}
              >
                {body}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-3 whitespace-nowrap border-t border-line px-5 py-2.5 text-[11.5px] text-fg-subtle">
          <span><kbd className="rounded border border-line px-1 font-sans">↑</kbd> <kbd className="rounded border border-line px-1 font-sans">↓</kbd> to move</span>
          <span><kbd className="rounded border border-line px-1 font-sans">Enter</kbd> to open</span>
          <span className="ml-auto min-w-0 truncate" title="Forks share their folder, so file changes made in one show up in all of them.">Forks share one folder</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** How many threads are in the open thread's fork tree; 0 when it has none. */
export function useForkLineageCount(threadId: string | undefined): number {
  const threads = useWorkspace((state) => state.inboxThreads)
  return useMemo(() => (threadId ? forkLineage(threads, threadId).filter((row) => row.thread).length : 0), [threads, threadId])
}
