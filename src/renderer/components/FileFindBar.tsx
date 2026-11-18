import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import type { FileFinder } from '@/lib/file-find'

/** Typing waits this long for the next key before the file is searched again. */
const SEARCH_DELAY_MS = 120
/** Text drawn late (a diagram) is searched again at most this often. */
const REFRESH_DELAY_MS = 150

/**
 * The file viewer's search bar (Ctrl+F), over the top right of the file. It searches whichever view is showing, the
 * rendered Markdown or the source, through the `FileFinder` that view puts in `finderRef`, and steps through the
 * matches with Enter and Shift+Enter.
 */
export function FileFindBar({
  finderRef,
  version,
  seed,
  focusSignal,
  onClose,
}: {
  finderRef: RefObject<FileFinder | null>
  /** Changes when the view or its text changes (another file, a reload, Preview and Source), to search again. */
  version: unknown
  /** Text selected in the file when the search was asked for; it becomes the query. Empty keeps the query as it is. */
  seed: string
  /** Changes when the search is asked for again while it is open, to take the focus back into the field. */
  focusSignal: number
  onClose: () => void
}): JSX.Element {
  const [query, setQuery] = useState(seed)
  const inputRef = useRef<HTMLInputElement>(null)
  const [count, setCount] = useState(0)
  const [current, setCurrent] = useState(-1)
  const currentRef = useRef(current)
  currentRef.current = current

  useEffect(() => {
    if (seed) setQuery(seed)
    inputRef.current?.focus()
    inputRef.current?.select()
    // Only asking again counts, not the seed's own change.
  }, [focusSignal])

  // Finds the matches again. A new query starts at the first match from the top of the view and goes to it; a
  // refresh (the text changed under it) stays at the same place in the list.
  const search = useCallback((fresh: boolean) => {
    const finder = finderRef.current
    if (!finder) {
      setCount(0)
      setCurrent(-1)
      return
    }
    const found = finder.search(query)
    let next = -1
    if (found > 0) next = fresh ? finder.startingMatch() : Math.min(Math.max(currentRef.current, 0), found - 1)
    setCount(found)
    setCurrent(next)
    finder.show(next, fresh)
  }, [finderRef, query])
  const searchRef = useRef(search)
  searchRef.current = search

  useEffect(() => {
    const timer = window.setTimeout(() => searchRef.current(true), query ? SEARCH_DELAY_MS : 0)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    searchRef.current(true)
  }, [version])

  useEffect(() => {
    const finder = finderRef.current
    if (!finder?.watch) return undefined
    let timer: number | undefined
    const stop = finder.watch(() => {
      if (timer !== undefined) return
      timer = window.setTimeout(() => {
        timer = undefined
        searchRef.current(false)
      }, REFRESH_DELAY_MS)
    })
    return () => {
      stop()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [finderRef, version])

  useEffect(() => () => finderRef.current?.clear(), [finderRef])

  const step = (direction: 1 | -1): void => {
    const finder = finderRef.current
    if (!finder || count === 0) return
    const next = (current + direction + count) % count
    setCurrent(next)
    finder.show(next, true)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      step(event.shiftKey ? -1 : 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
  }

  const status = !query ? '' : count === 0 ? 'No results' : `${current + 1} of ${count}`
  const button = 'flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40'
  return (
    <div
      role="search"
      aria-label="Find in file"
      data-testid="file-find"
      className="absolute right-5 top-2 z-20 flex items-center gap-1 rounded-lg border border-line-strong bg-elevated py-1 pl-2.5 pr-1 shadow-lg shadow-shade/40"
    >
      <input
        ref={inputRef}
        data-testid="file-find-input"
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Find in file"
        aria-label="Find in file"
        spellCheck={false}
        autoComplete="off"
        className="h-6 w-48 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-subtle"
      />
      <span aria-live="polite" data-testid="file-find-status" className="min-w-[4.5rem] whitespace-nowrap pr-1 text-right text-[11.5px] tabular-nums text-fg-subtle">
        {status}
      </span>
      <button type="button" aria-label="Previous match" title="Previous match (Shift+Enter)" data-testid="file-find-previous" disabled={count === 0} onClick={() => step(-1)} className={button}>
        <ChevronUp aria-hidden className="h-3.5 w-3.5" />
      </button>
      <button type="button" aria-label="Next match" title="Next match (Enter)" data-testid="file-find-next" disabled={count === 0} onClick={() => step(1)} className={button}>
        <ChevronDown aria-hidden className="h-3.5 w-3.5" />
      </button>
      <button type="button" aria-label="Close search" title="Close (Escape)" data-testid="file-find-close" onClick={onClose} className={button}>
        <X aria-hidden className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
