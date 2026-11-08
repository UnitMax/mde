import { useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject } from 'react'
import {
  markWindow,
  samePlace,
  TIMELINE_MAX_MARKS,
  TIMELINE_MIN_PROMPTS,
  timelinePlace,
  type PromptSpan,
  type TimelineEntry,
  type TimelinePlace,
} from '@/lib/chat-timeline'
import { cn } from '@/lib/utils'

const NOWHERE: TimelinePlace = { visible: new Set(), current: null }

/** Within this distance of the end of the conversation the reader counts as being at the end. */
const END_SLACK_PX = 8

type MarkState = 'current' | 'visible' | 'idle'

/** A mark's look follows where the reader is: the turn being read is brightest, the others on screen are lit. */
function markState(id: string, place: TimelinePlace): MarkState {
  if (id === place.current) return 'current'
  return place.visible.has(id) ? 'visible' : 'idle'
}

const MARK_CLASS: Record<MarkState, string> = {
  current: 'w-3.5 bg-fg',
  visible: 'w-3.5 bg-fg-muted',
  idle: 'w-2.5 bg-fg-subtle/40',
}

/** Fades the end of the rail that has more marks beyond it. */
function fadeMask(start: number, end: number, total: number): string | undefined {
  if (start === 0 && end === total) return undefined
  const top = start > 0 ? 'transparent, #000 22%' : '#000, #000 22%'
  const bottom = end < total ? '#000 78%, transparent' : '#000 78%, #000'
  return `linear-gradient(to bottom, ${top}, ${bottom})`
}

function Rail({
  entries,
  scrollRef,
  onJump,
}: {
  entries: readonly TimelineEntry[]
  scrollRef: RefObject<HTMLElement | null>
  onJump: (id: string) => void
}): JSX.Element {
  const [place, setPlace] = useState<TimelinePlace>(NOWHERE)
  const [hover, setHover] = useState(false)
  // Opened from the keyboard: it stays until focus leaves, whatever the pointer does.
  const [pinned, setPinned] = useState(false)
  const open = hover || pinned
  const railRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Where the reader is, worked out from the bubbles' places on screen. Scrolling and resizing only
  // ask for a measurement; one is taken per frame.
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const ids = new Set(entries.map((entry) => entry.id))
    let frame = 0
    const measure = (): void => {
      frame = 0
      const view = scroller.getBoundingClientRect()
      const spans: PromptSpan[] = []
      scroller.querySelectorAll<HTMLElement>('[data-chat-message]').forEach((element) => {
        const id = element.dataset.chatMessage
        if (!id || !ids.has(id)) return
        const box = element.getBoundingClientRect()
        spans.push({ id, top: box.top - view.top, bottom: box.bottom - view.top })
      })
      const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < END_SLACK_PX
      const next = timelinePlace(spans, view.height, atBottom)
      setPlace((previous) => (samePlace(previous, next) ? previous : next))
    }
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    scroller.addEventListener('scroll', schedule, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', schedule)
      observer?.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [entries, scrollRef])

  // The card opens on the turn being read, and from the keyboard it takes focus there. It is not
  // moved again while it stays open, so that it does not slide under the pointer.
  useLayoutEffect(() => {
    if (!open) return
    const list = listRef.current
    if (!list) return
    const row = list.querySelector<HTMLElement>('[data-current]') ?? list.querySelector<HTMLElement>('button')
    if (row) list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2
    if (pinned) row?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pinned])

  const total = entries.length
  const found = entries.findIndex((entry) => entry.id === place.current)
  const { start, end } = markWindow(total, TIMELINE_MAX_MARKS, found < 0 ? total - 1 : found)
  const mask = fadeMask(start, end, total)

  const close = (): void => {
    setPinned(false)
    setHover(false)
    triggerRef.current?.focus({ preventScroll: true })
  }

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setPinned(true)
    }
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    const at = rows.findIndex((row) => row === document.activeElement)
    const next =
      event.key === 'ArrowDown' ? Math.min(at + 1, rows.length - 1)
      : event.key === 'ArrowUp' ? (at < 0 ? rows.length - 1 : Math.max(at - 1, 0))
      : event.key === 'Home' ? 0
      : event.key === 'End' ? rows.length - 1
      : -1
    if (next < 0) return
    event.preventDefault()
    rows[next]?.focus()
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (!railRef.current?.contains(event.relatedTarget as Node | null)) setPinned(false)
  }

  return (
    // The layer is as tall as the conversation so that the card can use its height; only the rail takes the pointer.
    <div className="pointer-events-none absolute inset-y-0 right-3 z-20 flex items-center" data-testid="chat-timeline">
      <div ref={railRef} className="pointer-events-auto" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onBlur={onBlur}>
        <button
          ref={triggerRef}
          type="button"
          aria-label="Prompt timeline"
          aria-haspopup="menu"
          aria-expanded={open}
          data-testid="chat-timeline-trigger"
          // A click with a pointer already has the card open by hover; Enter and Space (detail 0) open it for the keyboard.
          onClick={(event) => {
            if (event.detail === 0) setPinned(true)
          }}
          onKeyDown={onTriggerKeyDown}
          className={cn(
            'flex flex-col items-end rounded-lg px-2.5 py-2 transition-opacity focus-visible:outline-offset-0',
            open && 'opacity-0',
          )}
          style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
        >
          {entries.slice(start, end).map((entry) => (
            <span key={entry.id} aria-hidden className="flex h-3.5 items-center">
              <span
                data-testid={`chat-timeline-mark-${entry.id}`}
                data-state={markState(entry.id, place)}
                className={cn('block h-[2px] rounded-full transition-[width,background-color] duration-150', MARK_CLASS[markState(entry.id, place)])}
              />
            </span>
          ))}
        </button>
        {open && (
          <div
            className="chat-timeline-card absolute right-1 top-1/2 flex max-h-[calc(100%-1.5rem)] w-[min(19rem,70vw)] -translate-y-1/2 flex-col rounded-xl border border-line-strong bg-elevated p-1 shadow-xl shadow-shade/50"
            data-testid="chat-timeline-card"
          >
            <div
              ref={listRef}
              role="menu"
              aria-label="Jump to a prompt"
              onKeyDown={onMenuKeyDown}
              className="relative min-h-0 flex-1 overflow-y-auto"
            >
              {entries.map((entry) => {
                const current = entry.id === place.current
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    title={entry.label}
                    aria-current={current ? 'location' : undefined}
                    data-current={current ? '' : undefined}
                    data-testid={`chat-timeline-item-${entry.id}`}
                    onClick={() => onJump(entry.id)}
                    className={cn(
                      'flex h-8 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[12.5px] transition-colors',
                      'hover:bg-hover hover:text-fg focus-visible:bg-hover focus-visible:text-fg focus-visible:outline-none',
                      current ? 'text-fg' : 'text-fg-muted',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                    <span
                      aria-hidden
                      className={cn('block h-[2px] shrink-0 rounded-full transition-[width,background-color] duration-150', MARK_CLASS[markState(entry.id, place)])}
                    />
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * A rail beside the conversation with one mark for each of the user's prompts. The marks follow the
 * reading position; hovering the rail (or focusing it and pressing Up, Down or Enter) grows it into a
 * list of the prompts to jump between.
 */
export function ChatTimeline({
  entries,
  scrollRef,
  onJump,
}: {
  entries: readonly TimelineEntry[]
  scrollRef: RefObject<HTMLElement | null>
  onJump: (id: string) => void
}): JSX.Element | null {
  // Streaming rebuilds the entries on every update; the rail only reacts when a prompt changes.
  const key = entries.map((entry) => `${entry.id}\u0000${entry.label}`).join('\u0001')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => entries, [key])
  if (stable.length < TIMELINE_MIN_PROMPTS) return null
  return <Rail entries={stable} scrollRef={scrollRef} onJump={onJump} />
}
