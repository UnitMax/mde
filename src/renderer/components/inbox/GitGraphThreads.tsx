import type { KeyboardEvent as ReactKeyboardEvent, SyntheticEvent } from 'react'
import { GitBranch, GitCommitHorizontal, MessagesSquare } from 'lucide-react'
import type { GitGraphThread, InboxThread } from '@shared/types'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSwitchItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { inboxStatusChip } from '@/lib/inbox'
import { cn } from '@/lib/utils'
import { StatusMark, statusGlyph } from './StatusMark'

const SHOWN_KEY = 'mde.gitGraph.threads'

/** Whether the threads are marked on the graph's commits; on until it is switched off. */
export function storedGraphThreadsShown(): boolean {
  try { return localStorage.getItem(SHOWN_KEY) !== 'off' } catch { return true }
}

export function saveGraphThreadsShown(shown: boolean): void {
  try { localStorage.setItem(SHOWN_KEY, shown ? 'on' : 'off') } catch { /* the choice is only a convenience */ }
}

/** A thread with the checkout it runs in and the commit that checkout is at. */
export interface PlacedThread {
  thread: InboxThread
  head: string | null
  branch: string | null
  root: string
}

/** The threads of one checkout: they share its branch and commit. */
export interface ThreadCheckout {
  root: string
  head: string | null
  branch: string | null
  threads: PlacedThread[]
}

/** Where the person is wanted comes first, then what is running, then what ended. */
const STATUS_ORDER: Record<InboxThread['status'], number> = { attention: 0, working: 1, error: 2, completed: 3, idle: 4 }

/**
 * Joins what main said about where threads run with the threads as the Inbox has them now (their
 * title and status), most pressing first. A thread removed or archived since is left out.
 */
export function placeGraphThreads(positions: readonly GitGraphThread[] | undefined, threads: readonly InboxThread[]): PlacedThread[] {
  if (!positions?.length) return []
  const byId = new Map(threads.map((thread) => [thread.id, thread]))
  return positions
    .flatMap((position) => {
      const thread = byId.get(position.threadId)
      return thread && !thread.archived ? [{ thread, head: position.head, branch: position.branch, root: position.root }] : []
    })
    .sort((a, b) => STATUS_ORDER[a.thread.status] - STATUS_ORDER[b.thread.status] || b.thread.lastActivityAt - a.thread.lastActivityAt)
}

/** The placed threads by checkout: the graph's own checkout first, then the others by branch name. */
export function threadCheckouts(placed: readonly PlacedThread[], ownRoot: string | null): ThreadCheckout[] {
  const groups = new Map<string, ThreadCheckout>()
  for (const item of placed) {
    const group = groups.get(item.root) ?? { root: item.root, head: item.head, branch: item.branch, threads: [] }
    group.threads.push(item)
    groups.set(item.root, group)
  }
  return [...groups.values()].sort((a, b) =>
    Number(b.root === ownRoot) - Number(a.root === ownRoot) || (a.branch ?? '￿').localeCompare(b.branch ?? '￿') || a.root.localeCompare(b.root))
}

export const graphThreadTitle = (thread: InboxThread): string => thread.customTitle?.trim() || thread.title.trim() || 'Untitled thread'
export const graphThreadStatus = (thread: InboxThread): string => inboxStatusChip(thread)?.label ?? 'Idle'

/** The thread's state as the Inbox list draws it, without the label; a hollow dot for one that has not run. */
function ThreadGlyph({ thread }: { thread: InboxThread }): JSX.Element {
  const chip = inboxStatusChip(thread)
  if (!chip) return <span aria-hidden className="mx-px h-1.5 w-1.5 shrink-0 rounded-full border border-fg-subtle" />
  return <StatusMark tone={chip.tone} glyph={thread.woke && chip.label === 'Woke up' ? 'alarm' : statusGlyph(thread.status)} aria-hidden>{null}</StatusMark>
}

/**
 * The graph lies beneath the menus in the React tree, though not on the page: a click or a key in a
 * menu would reach the commit row and the list too (choosing a commit, moving the selection, closing
 * the graph on Escape). They stop here.
 */
const contain = (event: SyntheticEvent): void => event.stopPropagation()

function ThreadItem({ item, current, onOpen }: { item: PlacedThread; current: boolean; onOpen: (threadId: string) => void }): JSX.Element {
  const chip = inboxStatusChip(item.thread)
  return (
    <DropdownMenuItem
      data-testid="git-graph-thread-item"
      data-thread={item.thread.id}
      data-status={item.thread.status}
      title={current ? 'The thread this graph was opened from' : 'Open this thread'}
      onSelect={() => onOpen(item.thread.id)}
      className="gap-2 py-1"
    >
      <span className="flex w-3.5 shrink-0 items-center justify-center"><ThreadGlyph thread={item.thread} /></span>
      <span className="min-w-0 flex-1 truncate text-[12.5px]">{graphThreadTitle(item.thread)}</span>
      {current && <span className="shrink-0 rounded-sm bg-active px-1 text-[10px] leading-4 text-fg-muted">This thread</span>}
      {chip
        ? <StatusMark tone={chip.tone}>{chip.label}</StatusMark>
        : <span className="shrink-0 text-[11px] text-fg-subtle">Idle</span>}
    </DropdownMenuItem>
  )
}

const pill = 'inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[5px] border border-line bg-panel px-1.5 text-[11px] leading-none ' +
  'text-fg-muted outline-none transition-colors hover:border-line-strong hover:bg-elevated hover:text-fg ' +
  'focus-visible:border-accent/60 focus-visible:text-fg data-[state=open]:border-line-strong data-[state=open]:bg-elevated data-[state=open]:text-fg'

/** Keys on a marker are its own, apart from Escape, which still closes what the graph has open. */
const markerKey = (event: ReactKeyboardEvent): void => { if (event.key !== 'Escape') event.stopPropagation() }

/**
 * The threads whose checkout is at a commit, in that commit's row. One thread is a small button
 * with its state and title that opens it; several are collected into one button that lists them.
 */
export function GraphThreadMarker({ threads, currentId, onOpen }: {
  threads: readonly PlacedThread[]
  /** The thread the graph was opened from, if it was opened from one. */
  currentId?: string
  onOpen: (threadId: string) => void
}): JSX.Element | null {
  if (threads.length === 0) return null
  if (threads.length === 1) {
    const { thread } = threads[0]!
    const title = graphThreadTitle(thread)
    return (
      <button
        type="button"
        data-testid="git-graph-thread"
        data-thread={thread.id}
        data-status={thread.status}
        title={`${title}\n${graphThreadStatus(thread)}${thread.id === currentId ? ' · this thread' : ''}\nOpen the thread`}
        aria-label={`Thread ${title}, ${graphThreadStatus(thread)}. Open the thread`}
        onClick={(event) => { event.stopPropagation(); onOpen(thread.id) }}
        onKeyDown={markerKey}
        className={cn(pill, 'max-w-[11rem]')}
      >
        <ThreadGlyph thread={thread} />
        <span className="truncate">{title}</span>
      </button>
    )
  }
  const summary = threads.map(({ thread }) => `${graphThreadTitle(thread)} · ${graphThreadStatus(thread)}`).join('\n')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="git-graph-thread-group"
          title={summary}
          aria-label={`${threads.length} threads here`}
          onClick={contain}
          onKeyDown={markerKey}
          className={pill}
        >
          <span className="flex items-center gap-[3px]">
            {threads.slice(0, 3).map(({ thread }) => <ThreadGlyph key={thread.id} thread={thread} />)}
          </span>
          <span className="tabular-nums">{threads.length} threads</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[min(22rem,60vh)] w-80 overflow-y-auto" onClick={contain} onKeyDown={contain}>
        <DropdownMenuLabel>{threads.length} threads at this commit</DropdownMenuLabel>
        {threads.map((item) => <ThreadItem key={item.thread.id} item={item} current={item.thread.id === currentId} onOpen={onOpen} />)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The toolbar's Threads button: every thread in the repository, collected by the checkout it runs
 * in. A checkout's line goes to its commit in the graph, a thread opens it, and the switch decides
 * whether the commits carry the markers.
 */
export function GraphThreadsMenu({ checkouts, count, shown, currentId, inGraph, onShownChange, onLocate, onOpen }: {
  checkouts: readonly ThreadCheckout[]
  count: number
  shown: boolean
  currentId?: string
  /** Whether a commit is among those the graph has loaded. */
  inGraph: (hash: string) => boolean
  onShownChange: (shown: boolean) => void
  onLocate: (hash: string) => void
  onOpen: (threadId: string) => void
}): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="git-graph-threads"
          title={`${count} ${count === 1 ? 'thread' : 'threads'} in this repository`}
          aria-label={`Threads in this repository: ${count}`}
          className={cn(
            'flex h-7 shrink-0 items-center gap-1.5 rounded px-2 text-[11.5px] outline-none transition-colors',
            'hover:bg-hover focus-visible:bg-hover data-[state=open]:bg-hover',
            shown ? 'text-fg' : 'text-fg-muted',
          )}
        >
          <MessagesSquare className={cn('h-3.5 w-3.5', shown && 'text-accent')} aria-hidden />
          <span className="tabular-nums">{count}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[min(28rem,70vh)] w-[22rem] overflow-y-auto" onClick={contain} onKeyDown={contain}>
        <DropdownMenuSwitchItem checked={shown} onCheckedChange={(next) => onShownChange(next === true)} data-testid="git-graph-threads-shown" className="text-[12.5px]">
          <span className="flex-1">Show threads on the graph</span>
        </DropdownMenuSwitchItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Threads in this repository</DropdownMenuLabel>
        {checkouts.map((checkout) => {
          const visible = checkout.head !== null && inGraph(checkout.head)
          const name = checkout.branch ?? (checkout.head ? `Detached at ${checkout.head.slice(0, 7)}` : 'No commits yet')
          return (
            <div key={checkout.root} role="group" aria-label={name} data-testid="git-graph-thread-checkout">
              <DropdownMenuItem
                disabled={!visible}
                title={visible ? `${checkout.root}\nGo to this commit in the graph` : `${checkout.root}\nIts commit is not among those shown (see the branches shown, or load more commits)`}
                onSelect={() => { if (checkout.head) onLocate(checkout.head) }}
                className="mt-0.5 gap-1.5 py-1 text-[11.5px] text-fg-muted data-[disabled]:opacity-70"
              >
                {checkout.branch ? <GitBranch className="h-3 w-3 shrink-0" aria-hidden /> : <GitCommitHorizontal className="h-3 w-3 shrink-0" aria-hidden />}
                <span className="min-w-0 truncate font-medium">{name}</span>
                <span className="flex-1" />
                {checkout.head && checkout.branch && <span className="inbox-code-font shrink-0 text-[11px] text-fg-subtle">{checkout.head.slice(0, 7)}</span>}
                {!visible && checkout.head && <span className="shrink-0 text-[10.5px] text-fg-subtle">not shown</span>}
              </DropdownMenuItem>
              {checkout.threads.map((item) => <ThreadItem key={item.thread.id} item={item} current={item.thread.id === currentId} onOpen={onOpen} />)}
            </div>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
