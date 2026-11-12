import { useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle, Search } from 'lucide-react'
import type { ChatSearchResponse } from '@shared/types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { sessionAge } from '@/lib/inbox'
import { searchRows, type InboxSearchRow } from '@/lib/inbox-search'
import { cn } from '@/lib/utils'
import { useInboxChat } from '@/store/inbox-chat'
import { useInboxFind } from '@/store/inbox-find'
import { useWorkspace } from '@/store/workspace'

/** Typing waits this long for the next key before the threads are asked. */
const TYPING_DELAY_MS = 150
/** While the threads are still being read, the answer is asked for again this often. */
const POLL_MS = 400

/**
 * Search over the text of every thread (Ctrl+Shift+F), in an overlay like the session switcher. Each result is a
 * message with the query in it, under the heading of its thread; choosing one opens the thread with its own search
 * bar on that message. The threads are read by the main process in the background, so the list fills in while it
 * works, and the dialog asks again until they are all read.
 */
export function InboxSearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): JSX.Element {
  const threads = useWorkspace((state) => state.inboxThreads)
  const selectInboxThread = useWorkspace((state) => state.selectInboxThread)
  const folders = useInboxChat((state) => state.folders)
  const [query, setQuery] = useState('')
  const [asked, setAsked] = useState('')
  const [answer, setAnswer] = useState<ChatSearchResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The highlighted row belongs to the list it was chosen in: a different list starts at its first row, with no effect to reset it after the fact.
  const [active, setActive] = useState({ list: '', index: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setAsked(query.trim()), query.trim() ? TYPING_DELAY_MS : 0)
    return () => window.clearTimeout(timer)
  }, [query])

  // Asking with nothing typed only sets the reading going, so that the threads are ready when the first word is.
  useEffect(() => {
    if (!open) return undefined
    let stopped = false
    let timer: number | undefined
    const ask = async (): Promise<void> => {
      try {
        const next = await window.api.chat.search({ query: asked })
        if (stopped) return
        setAnswer(next)
        setError(null)
        if (next.indexed < next.total) timer = window.setTimeout(() => void ask(), POLL_MS)
      } catch (failure) {
        if (!stopped) setError(ipcErrorMessage(failure, 'Could not search the threads.'))
      }
    }
    void ask()
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [open, asked])

  const rows = useMemo(() => (asked ? searchRows(answer, threads, folders) : []), [answer, asked, threads, folders])
  const rowKey = rows.map((row) => `${row.thread.id}:${row.hit.messageId}`).join('\0')
  const activeIndex = active.list === rowKey ? active.index : 0
  const setActiveIndex = (next: number | ((current: number) => number)): void =>
    setActive((current) => {
      const from = current.list === rowKey ? current.index : 0
      return { list: rowKey, index: typeof next === 'function' ? next(from) : next }
    })
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, rowKey])

  const close = (next: boolean): void => {
    if (!next) {
      setQuery('')
      setAsked('')
      setActive({ list: '', index: 0 })
    }
    onOpenChange(next)
  }

  const choose = (row: InboxSearchRow | undefined): void => {
    if (!row) return
    const text = asked
    selectInboxThread(row.thread.id)
    // A terminal thread has no conversation to search in; it is only opened.
    if (row.thread.mode !== 'terminal') useInboxFind.getState().ask({ threadId: row.thread.id, query: text, messageId: row.hit.messageId })
    close(false)
  }

  const move = (delta: number): void => {
    if (rows.length > 0) setActiveIndex((current) => (current + delta + rows.length) % rows.length)
  }

  const reading = answer !== null && answer.indexed < answer.total
  const threadCount = new Set(rows.map((row) => row.thread.id)).size
  const status = !asked
    ? ''
    : reading
      ? `Searching ${answer.indexed} of ${answer.total} threads…`
      : rows.length === 0
        ? ''
        : `${threadCount} ${threadCount === 1 ? 'thread' : 'threads'}${answer?.truncated ? ' (more not shown)' : ''}`

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-w-2xl p-3"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <DialogHeader className="mb-2 px-1">
          <DialogTitle className="sr-only">Search all threads</DialogTitle>
          <DialogDescription className="sr-only">
            Search the text of every thread and press Enter to open the thread at the highlighted message.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-fg-subtle" aria-hidden="true" />
          <Input
            ref={inputRef}
            autoFocus
            data-testid="inbox-search-input"
            aria-label="Search all threads"
            aria-controls="inbox-search-results"
            aria-activedescendant={rows[activeIndex] ? `inbox-search-${activeIndex}` : undefined}
            placeholder="Search all threads"
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

        <div ref={listRef} id="inbox-search-results" role="listbox" aria-label="Messages found" className="mt-2 max-h-[min(65vh,26rem)] overflow-y-auto">
          {error ? (
            <p role="alert" className="px-2 py-8 text-center text-xs text-danger">{error}</p>
          ) : !asked ? (
            <p className="px-2 py-8 text-center text-xs text-fg-subtle">Type to search what you and the agents wrote in every thread.</p>
          ) : rows.length === 0 ? (
            <p data-testid="inbox-search-empty" className="px-2 py-8 text-center text-xs text-fg-subtle">
              {reading || answer === null ? 'Searching…' : 'No thread has that text.'}
            </p>
          ) : (
            rows.map((row, index) => (
              <div key={`${row.thread.id}:${row.hit.messageId}`}>
                {row.first && (
                  <div className={cn('flex items-baseline gap-2 px-2.5 pb-0.5 text-[12px]', index > 0 && 'mt-2 pt-1')}>
                    <span className="min-w-0 truncate font-medium text-fg">{row.thread.customTitle ?? row.thread.title}</span>
                    <span className="min-w-0 shrink-[3] truncate text-[11px] text-fg-subtle">
                      {row.folder ? `${row.folder.name} · ` : ''}{sessionAge(row.thread.lastActivityAt)}{row.thread.archived ? ' · Archived' : row.thread.snoozedUntil !== undefined ? ' · Snoozed' : ''}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  id={`inbox-search-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  data-testid="inbox-search-result"
                  onClick={() => choose(row)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    'flex w-full items-baseline gap-2 rounded px-2.5 py-1.5 text-left text-[12.5px] leading-5 transition-colors',
                    index === activeIndex ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
                  )}
                >
                  <span className="w-11 shrink-0 text-[10.5px] uppercase tracking-wide text-fg-subtle">{row.hit.role === 'user' ? 'You' : 'Agent'}</span>
                  <span className="min-w-0 flex-1 break-words">
                    {row.hit.before}
                    <mark className="rounded-sm bg-accent/30 px-px text-fg">{row.hit.match}</mark>
                    {row.hit.after}
                  </span>
                </button>
                {row.more > 0 && (
                  <p className="px-2.5 pb-0.5 pl-[3.75rem] text-[11px] text-fg-subtle">
                    and {row.more} more {row.more === 1 ? 'message' : 'messages'} in this thread
                  </p>
                )}
              </div>
            ))
          )}
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[10px] text-fg-subtle">
          <span>↑↓ to navigate · Enter to open · Esc to close</span>
          <span aria-live="polite" data-testid="inbox-search-status" className="flex items-center gap-1.5">
            {reading && asked && rows.length > 0 && <LoaderCircle aria-hidden className="h-3 w-3 animate-spin motion-reduce:animate-none" />}
            {status}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
