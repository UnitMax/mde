import { useEffect, useMemo, useRef, useState } from 'react'
import { File as FileIcon, LoaderCircle, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { HighlightedText } from '@/components/HighlightedText'
import { filePickerRows, type FilePickerRow } from '@/lib/inbox-file-picker'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'
import type { ChatFileEntry } from '@shared/types'

/** Typing waits this long for the next key before OpenCode is asked. */
const SEARCH_DELAY_MS = 80

/**
 * Ctrl+P in the Inbox: type part of a file's name or path to find it in the open thread's project (on the new-thread
 * page, the folder's), and open it in the file viewer over the conversation. OpenCode searches (`lib/inbox-file-picker.ts`); the list keeps the last answer
 * while the next one is on its way, so it does not blink while typing.
 */
export function InboxFilePicker({
  open,
  onOpenChange,
  place,
  rootId,
  project,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Whose files are searched: the open thread's, or on the new-thread page the folder's it starts in. */
  place: { threadId: string } | { folderId: string }
  /** The file viewer the chosen file opens in: the thread's or the folder's (see `openFiles`). */
  rootId: string
  /** The project's name, for the empty list. */
  project: string
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState<{ query: string; entries: ChatFileEntry[]; error?: string } | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const trimmed = query.trim()
  const placeKey = 'threadId' in place ? `thread:${place.threadId}` : `folder:${place.folderId}`
  const placeRef = useRef(place)
  placeRef.current = place

  useEffect(() => {
    if (!open || !trimmed) {
      setAnswer(null)
      return undefined
    }
    let current = true
    const timer = window.setTimeout(() => {
      Promise.resolve()
        .then(() => window.api.chat.files({ ...placeRef.current, query: trimmed, search: true }))
        .then(
          (entries) => { if (current) setAnswer({ query: trimmed, entries }) },
          (error: unknown) => { if (current) setAnswer({ query: trimmed, entries: [], error: error instanceof Error ? error.message : String(error) }) },
        )
    }, SEARCH_DELAY_MS)
    return () => { current = false; window.clearTimeout(timer) }
  }, [open, placeKey, trimmed])

  const rows = useMemo(() => (answer ? filePickerRows(answer.entries, answer.query) : []), [answer])
  const rowKey = rows.map((row) => row.path).join('\0')
  const searching = Boolean(trimmed) && answer?.query !== trimmed

  useEffect(() => setActiveIndex(0), [rowKey])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, rowKey])

  const close = (next: boolean): void => {
    if (!next) {
      setQuery('')
      setAnswer(null)
      setActiveIndex(0)
    }
    onOpenChange(next)
  }

  const choose = (row: FilePickerRow | undefined): void => {
    if (!row) return
    useWorkspace.getState().openFile(rootId, row.path)
    close(false)
  }

  const move = (delta: number): void => {
    if (rows.length > 0) setActiveIndex((index) => (index + delta + rows.length) % rows.length)
  }

  const empty = !trimmed
    ? `Type part of a file name to search ${project}.`
    : answer?.error
      ? `The files could not be searched: ${answer.error}`
      : searching
        ? 'Searching…'
        : 'No matching files.'

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
          <DialogTitle className="sr-only">Go to file</DialogTitle>
          <DialogDescription className="sr-only">
            Search the files of the thread's project and press Enter to open the highlighted file.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          {searching && rows.length > 0 ? (
            <LoaderCircle className="pointer-events-none absolute left-3 top-3 h-4 w-4 animate-spin text-fg-subtle" aria-hidden="true" />
          ) : (
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-fg-subtle" aria-hidden="true" />
          )}
          <Input
            ref={inputRef}
            autoFocus
            data-testid="file-picker-input"
            aria-label="Search files"
            aria-controls="file-picker-results"
            aria-activedescendant={rows[activeIndex] ? `file-picker-${activeIndex}` : undefined}
            placeholder="Go to file"
            spellCheck={false}
            autoComplete="off"
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
                // An answer for an older query is not what Enter means; wait for the one being typed.
                if (!searching) choose(rows[activeIndex])
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
          id="file-picker-results"
          role="listbox"
          aria-label="Files"
          className="mt-2 max-h-[min(65vh,24rem)] overflow-y-auto"
        >
          {rows.length === 0 ? (
            <p data-testid="file-picker-empty" className="break-words px-2 py-8 text-center text-xs text-fg-subtle">
              {empty}
            </p>
          ) : (
            rows.map((row, index) => {
              const active = index === activeIndex
              return (
                <button
                  key={row.path}
                  type="button"
                  id={`file-picker-${index}`}
                  role="option"
                  aria-selected={active}
                  title={row.path}
                  data-testid="file-picker-result"
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left transition-colors',
                    active ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
                  )}
                  onClick={() => choose(row)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <FileIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="max-w-[75%] shrink-0 truncate text-[13px] font-medium">
                      <HighlightedText value={row.name} positions={row.matches.name} />
                    </span>
                    {row.folder && (
                      <span className="min-w-0 truncate text-[11px] text-fg-subtle" style={{ direction: 'rtl', textAlign: 'left' }}>
                        <bdi>
                          <HighlightedText value={row.folder.slice(0, -1)} positions={row.matches.folder} />
                        </bdi>
                      </span>
                    )}
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
