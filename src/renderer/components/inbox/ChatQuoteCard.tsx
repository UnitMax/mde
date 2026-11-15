import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A quote as a card, like an attachment: a bar beside the text, which is cut short and opens on request, so
 * that a long quote takes the room of a few lines and not of a page. In the message box (`onRemove` given) the
 * controls are on its right, with an X to take it off; in a sent message only the chevron. A click on the text
 * of a long quote opens it too.
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
  // Shut, a quote of many lines is drawn as one run of text, so that its first lines fill the preview instead
  // of ending at the first line break. Only the drawing: the text itself stays as it was written.
  const flowing = !open && text.split('\n').length > preview
  // A click on the text of a long quote opens or shuts it, unless it ended a selection of some of the text.
  const clickText = (): void => {
    if (!long || !window.getSelection()?.isCollapsed) return
    toggle()
  }
  return (
    <blockquote
      data-testid="chat-quote"
      data-open={open || undefined}
      className={cn(
        'relative flex min-w-0 items-start gap-1 rounded-lg py-1.5 pl-[18px] text-[12.5px] leading-[1.45] text-fg-muted',
        draft || long ? 'pr-1' : 'pr-3',
        draft ? 'border border-line bg-panel/70' : 'my-1.5 bg-bg/35 first:mt-0 last:mb-0',
      )}
    >
      {/* The quote mark: a bar of its own, so that it stays straight against the rounded corners. */}
      <span aria-hidden className="absolute bottom-2 left-2 top-2 w-[3px] rounded-full bg-accent/70" />
      <span
        ref={body}
        data-testid="chat-quote-text"
        onClick={clickText}
        className={cn(
          'block min-w-0 flex-1 break-words py-0.5',
          flowing ? 'whitespace-normal' : 'whitespace-pre-wrap',
          long && 'cursor-pointer',
          open ? (draft ? 'max-h-48 overflow-y-auto' : 'max-h-80 overflow-y-auto') : draft ? 'line-clamp-2' : 'line-clamp-3',
        )}
      >
        {text}
      </span>
      {(draft || long) && <div className="-my-0.5 flex shrink-0 items-center">
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
        {draft && (
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
        )}
      </div>}
    </blockquote>
  )
}
