import { useEffect, useMemo, useRef, useState } from 'react'
import { GitBranch, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { HighlightedText } from '@/components/HighlightedText'
import { InboxStatusBadge } from '@/components/InboxPanel'
import { ProjectIcon } from '@/components/inbox/ProjectIcon'
import { isInboxThreadSnoozed, isInboxThreadUnread, sessionAge } from '@/lib/inbox'
import { searchInboxThreads, type ThreadSwitcherRow } from '@/lib/inbox-thread-switcher'
import { cn } from '@/lib/utils'
import { useInboxChat } from '@/store/inbox-chat'
import { useWorkspace } from '@/store/workspace'

/**
 * Ctrl+O in the Inbox: switch to another thread, as the session switcher does for sessions. The open thread is
 * highlighted to begin with, so ↓ Enter goes to the next one down the list.
 */
export function InboxThreadSwitcher({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): JSX.Element {
  const threads = useWorkspace((state) => state.inboxThreads)
  const selectedThreadId = useWorkspace((state) => state.selectedInboxThreadId)
  const selectInboxThread = useWorkspace((state) => state.selectInboxThread)
  const folders = useInboxChat((state) => state.folders)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => (open ? searchInboxThreads(threads, folders, query) : []), [open, threads, folders, query])
  const rowKey = rows.map((row) => row.thread.id).join('\0')
  const selectedIndex = rows.findIndex((row) => row.thread.id === selectedThreadId)

  useEffect(() => {
    if (!open) return
    setActiveIndex(query.trim() ? 0 : Math.max(0, selectedIndex))
    // Only a new list or a new query moves the highlight; a thread changing its status in the background does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, rowKey])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, rowKey])

  const close = (next: boolean): void => {
    if (!next) {
      setQuery('')
      setActiveIndex(0)
    }
    onOpenChange(next)
  }

  const choose = (row: ThreadSwitcherRow | undefined): void => {
    if (!row) return
    selectInboxThread(row.thread.id)
    close(false)
  }

  const move = (delta: number): void => {
    if (rows.length > 0) setActiveIndex((current) => (current + delta + rows.length) % rows.length)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-w-xl p-3"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <DialogHeader className="mb-2 px-1">
          <DialogTitle className="sr-only">Switch thread</DialogTitle>
          <DialogDescription className="sr-only">
            Search the Inbox threads and press Enter to open the highlighted thread.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-fg-subtle" aria-hidden="true" />
          <Input
            ref={inputRef}
            autoFocus
            data-testid="thread-switcher-input"
            aria-label="Search threads"
            aria-controls="thread-switcher-results"
            aria-activedescendant={rows[activeIndex] ? `thread-switcher-${rows[activeIndex].thread.id}` : undefined}
            placeholder="Search threads"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                move(1)
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                move(-1)
              } else if (event.key === 'Enter') {
                event.preventDefault()
                choose(rows[activeIndex])
              } else if (event.key === 'Escape') {
                event.preventDefault()
                close(false)
              }
            }}
            className="h-10 pl-9 pr-10 text-sm"
          />
          <kbd className="pointer-events-none absolute right-3 top-3 rounded border border-line-strong px-1.5 text-[10px] leading-4 text-fg-subtle">
            Esc
          </kbd>
        </div>

        <div
          ref={listRef}
          id="thread-switcher-results"
          role="listbox"
          aria-label="Inbox threads"
          className="mt-2 max-h-[min(65vh,24rem)] overflow-y-auto"
        >
          {rows.length === 0 ? (
            <p data-testid="thread-switcher-empty" className="px-2 py-8 text-center text-xs text-fg-subtle">
              {threads.length === 0 ? 'No threads yet.' : 'No matching threads.'}
            </p>
          ) : (
            rows.map((row, index) => {
              const { thread } = row
              const active = index === activeIndex
              const unread = isInboxThreadUnread(thread)
              const parked = thread.archived ? 'Archived' : isInboxThreadSnoozed(thread) ? 'Snoozed' : null
              return (
                <button
                  key={thread.id}
                  type="button"
                  id={`thread-switcher-${thread.id}`}
                  role="option"
                  aria-selected={active}
                  aria-current={thread.id === selectedThreadId || undefined}
                  data-testid="thread-switcher-result"
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left transition-colors',
                    active ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
                  )}
                  onClick={() => choose(row)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <ProjectIcon icon={row.folder?.icon} className="self-start mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className={cn('min-w-0 flex-1 truncate text-[13px]', unread ? 'font-semibold text-fg' : 'font-medium')}>
                        <HighlightedText value={row.title} positions={row.matches.title} />
                      </span>
                      <span className="shrink-0 text-[11px] text-fg-subtle">
                        {parked ? `${parked} · ` : ''}{sessionAge(thread.lastActivityAt)}
                      </span>
                    </span>
                    <span className="flex min-w-0 items-center gap-1 text-[11px] text-fg-subtle">
                      <span className="min-w-0 truncate" title={thread.directory}>
                        <HighlightedText value={row.project} positions={row.matches.project} />
                      </span>
                      {thread.branch && (
                        <>
                          <GitBranch aria-hidden="true" className="ml-1 h-3 w-3 shrink-0" />
                          <span className="min-w-0 truncate">
                            <HighlightedText value={thread.branch} positions={row.matches.branch} />
                          </span>
                        </>
                      )}
                      <span className="ml-auto shrink-0 pl-2">
                        <InboxStatusBadge thread={thread} hideDone />
                      </span>
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>
        <p className="mt-2 px-1 text-[10px] text-fg-subtle">
          ↑↓ to navigate · Enter to open · Esc to close
        </p>
      </DialogContent>
    </Dialog>
  )
}
