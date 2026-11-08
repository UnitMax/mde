import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { ChevronDown, ChevronUp, LoaderCircle, X } from 'lucide-react'
import { clearMatches, matchRanges, paintMatches, startingMatch } from '@/lib/chat-find'
import { scrollBehavior } from '@/lib/chat-timeline'

/** Typing waits this long for the next key before the conversation is searched again. */
const SEARCH_DELAY_MS = 120
/** A streaming reply changes the text again and again; the matches are found again at most this often. */
const REFRESH_DELAY_MS = 150

/** The message whose text the range is in. */
function messageOf(range: Range): string | null {
  return range.startContainer.parentElement?.closest('[data-chat-message]')?.getAttribute('data-chat-message') ?? null
}

/**
 * The search bar over the top right of a conversation (Ctrl+F). It looks for the query in the text of the messages,
 * paints every match, and steps through them with Enter and Shift+Enter. Earlier messages that are not loaded yet are
 * loaded while it searches, so that it covers the whole thread.
 */
export function ChatFindBar({
  scrollRef,
  seed,
  target,
  focusSignal,
  moreToLoad,
  loadingMore,
  onLoadMore,
  onClose,
}: {
  scrollRef: RefObject<HTMLElement | null>
  /** Text selected in the conversation when the search was asked for; it becomes the query. Empty keeps the query as it is. */
  seed: string
  /** A message to go to first, when the search comes from a result in the search over all threads: its first match is the current one. */
  target?: string
  /** Changes when the search is asked for again while it is open, to take the focus back into the field. */
  focusSignal: number
  /** There are earlier messages that are not loaded, and loading them is possible right now. */
  moreToLoad: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onClose: () => void
}): JSX.Element {
  const [query, setQuery] = useState(seed)
  const inputRef = useRef<HTMLInputElement>(null)
  const ranges = useRef<Range[]>([])
  const [count, setCount] = useState(0)
  const [current, setCurrent] = useState(-1)
  // Counts the times the view should move to the current match: when it was chosen by the person, not when a refresh found it again.
  const [reveal, setReveal] = useState(0)

  // The message the search should land on, until it is found (earlier messages may have to be loaded first) or given up on.
  const targetRef = useRef(target)
  const moreRef = useRef(moreToLoad || loadingMore)
  moreRef.current = moreToLoad || loadingMore

  useEffect(() => {
    targetRef.current = target
    if (seed) setQuery(seed)
    inputRef.current?.focus()
    inputRef.current?.select()
    // Only asking again counts, not the seed's own change.
  }, [focusSignal])

  const paint = useCallback((index: number) => paintMatches(ranges.current, index), [])

  // Finds the matches again. A new query starts at the match nearest the top of the view; a refresh (the text changed
  // under it) keeps the match the person was on.
  const search = useCallback((fresh: boolean) => {
    const scroller = scrollRef.current
    if (!scroller) return
    const found = matchRanges(scroller, query)
    const before = ranges.current[current]
    ranges.current = found
    setCount(found.length)
    let next = -1
    const wanted = targetRef.current
    if (wanted && found.length > 0) {
      next = found.findIndex((range) => messageOf(range) === wanted)
      // Found, or nowhere to be found once everything is loaded (the text is drawn differently from how it was written).
      if (next !== -1 || !moreRef.current) {
        targetRef.current = undefined
        setReveal((tick) => tick + 1)
      }
    }
    if (next === -1 && found.length > 0) {
      if (!fresh && before) {
        next = found.findIndex((range) => range.startContainer === before.startContainer && range.startOffset === before.startOffset)
        // The text was drawn again under the match (a streaming reply): stay at the same place in the list.
        if (next === -1) next = Math.min(current, found.length - 1)
      }
      if (next === -1) {
        const viewTop = scroller.getBoundingClientRect().top
        next = startingMatch(found.map((range) => range.getBoundingClientRect().top), viewTop)
        // While the wanted message is still being looked for, the view stays where it is.
        if (fresh && !targetRef.current) setReveal((tick) => tick + 1)
      }
    }
    setCurrent(next)
    paint(next)
  }, [scrollRef, query, current, paint])
  const searchRef = useRef(search)
  searchRef.current = search

  useEffect(() => {
    const timer = window.setTimeout(() => searchRef.current(true), query ? SEARCH_DELAY_MS : 0)
    return () => window.clearTimeout(timer)
  }, [query])

  // New messages, streaming text and earlier messages being loaded all change what there is to find.
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || typeof MutationObserver === 'undefined') return undefined
    let timer: number | undefined
    const observer = new MutationObserver(() => {
      if (timer !== undefined) return
      timer = window.setTimeout(() => {
        timer = undefined
        searchRef.current(false)
      }, REFRESH_DELAY_MS)
    })
    observer.observe(scroller, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [scrollRef])

  useEffect(() => () => clearMatches(), [])

  // The whole thread is searched: what is not loaded yet is loaded as long as there is a query.
  useEffect(() => {
    if (query && moreToLoad && !loadingMore) onLoadMore()
  }, [query, moreToLoad, loadingMore, onLoadMore])

  // Brings the current match into view, a third of the way down so that the text around it shows.
  useLayoutEffect(() => {
    if (reveal === 0 || current < 0) return
    const scroller = scrollRef.current
    const range = ranges.current[current]
    if (!scroller || !range) return
    const box = range.getBoundingClientRect()
    const view = scroller.getBoundingClientRect()
    const margin = Math.min(48, view.height / 4)
    if (box.top >= view.top + margin && box.bottom <= view.bottom - margin) return
    const top = Math.max(0, scroller.scrollTop + box.top - view.top - view.height / 3)
    scroller.scrollTo({ top, behavior: scrollBehavior() })
  // Only a new reveal moves the view, not the match counts changing under it.
  }, [reveal, scrollRef])

  const step = (direction: 1 | -1): void => {
    if (ranges.current.length === 0) return
    const next = (current + direction + ranges.current.length) % ranges.current.length
    setReveal((tick) => tick + 1)
    setCurrent(next)
    paint(next)
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

  const searching = query !== '' && (moreToLoad || loadingMore)
  const status = !query ? '' : count === 0 ? (searching ? 'Searching…' : 'No results') : `${current + 1} of ${count}`
  const button = 'flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40'
  return (
    <div
      role="search"
      aria-label="Find in conversation"
      data-testid="chat-find"
      className="absolute right-5 top-2 z-20 flex items-center gap-1 rounded-lg border border-line-strong bg-elevated py-1 pl-2.5 pr-1 shadow-lg shadow-shade/40"
    >
      <input
        ref={inputRef}
        data-testid="chat-find-input"
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Find in conversation"
        aria-label="Find in conversation"
        spellCheck={false}
        autoComplete="off"
        className="h-6 w-48 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-subtle"
      />
      <span aria-live="polite" data-testid="chat-find-status" className="flex min-w-[4.5rem] items-center justify-end gap-1 whitespace-nowrap pr-1 text-[11.5px] tabular-nums text-fg-subtle">
        {searching && count > 0 && <LoaderCircle aria-hidden className="h-3 w-3 animate-spin motion-reduce:animate-none" />}
        {status}
      </span>
      <button type="button" aria-label="Previous match" title="Previous match (Shift+Enter)" data-testid="chat-find-previous" disabled={count === 0} onClick={() => step(-1)} className={button}>
        <ChevronUp aria-hidden className="h-3.5 w-3.5" />
      </button>
      <button type="button" aria-label="Next match" title="Next match (Enter)" data-testid="chat-find-next" disabled={count === 0} onClick={() => step(1)} className={button}>
        <ChevronDown aria-hidden className="h-3.5 w-3.5" />
      </button>
      <button type="button" aria-label="Close search" title="Close (Escape)" data-testid="chat-find-close" onClick={onClose} className={button}>
        <X aria-hidden className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
