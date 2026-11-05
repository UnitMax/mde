import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A quote as a card, like an attachment: a bar beside the text, which is cut short and opens on request, so
 * that a long quote takes the room of a few lines and not of a page. In the message box (`onRemove` given) the
 * controls are on its right; in a sent message the card opens with a link under the text.
 */
export function ChatQuoteCard({
  text,
  onRemove,
  disabled = false,
}: {
  text: string
  /** Offered in the message box: takes the quote off the message. */
  onRemove?: () => void
  disabled?: boolean
}): JSX.Element {
  const draft = onRemove !== undefined
  const preview = draft ? 2 : 3
  const body = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  // Whether the text runs past the lines it is cut to, which depends on the width, so it is measured.
  const [overflowing, setOverflowing] = useState(false)
  const long = text.split('\n').length > preview || overflowing

  useLayoutEffect(() => {
    const element = body.current
    if (!element || open) return
    const measure = (): void => setOverflowing(element.scrollHeight > element.clientHeight + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text, open])

  const toggle = (): void => setOpen((value) => !value)
  return (
    <blockquote
      data-testid="chat-quote"
      className={cn(
        'flex min-w-0 items-start gap-1.5 rounded-lg border border-l-2 border-line border-l-accent/60 text-[12.5px] leading-snug text-fg-muted',
        draft ? 'bg-panel/60 py-1.5 pl-2.5 pr-1' : 'my-1.5 bg-bg/30 px-2.5 py-1.5 first:mt-0 last:mb-0',
      )}
    >
      <div className="min-w-0 flex-1">
        <span
          ref={body}
          data-testid="chat-quote-text"
          className={cn(
            'block whitespace-pre-wrap break-words',
            open ? (draft ? 'max-h-48 overflow-y-auto' : 'max-h-80 overflow-y-auto') : draft ? 'line-clamp-2' : 'line-clamp-3',
          )}
        >
          {text}
        </span>
        {long && !draft && (
          <button
            type="button"
            aria-expanded={open}
            data-testid="chat-quote-toggle"
            onClick={toggle}
            className="mt-0.5 rounded text-[11px] text-fg-subtle transition-colors hover:text-fg"
          >
            {open ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
      {draft && (
        <div className="flex shrink-0 items-center">
          {long && (
            <button
              type="button"
              aria-expanded={open}
              aria-label={open ? 'Show less of the quote' : 'Show all of the quote'}
              title={open ? 'Show less' : 'Show all'}
              data-testid="chat-quote-toggle"
              onClick={toggle}
              className="flex h-6 w-6 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
            >
              <ChevronDown aria-hidden className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
            </button>
          )}
          <button
            type="button"
            aria-label="Remove quote"
            title="Remove quote"
            data-testid="chat-quote-remove"
            disabled={disabled}
            onClick={onRemove}
            className="flex h-6 w-6 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-50"
          >
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </blockquote>
  )
}
