import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, LoaderCircle, RefreshCw, X } from 'lucide-react'
import { ChatMarkdown } from '@/components/inbox/ChatMarkdown'
import { SlashCommandIcon } from '@/components/inbox/SlashCommandIcon'
import type { ChatAside as Aside } from '@/store/inbox-aside'

/** How long the Copy button says it has copied. */
const COPIED_MS = 1500

const ACTION =
  'flex h-6 w-6 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35'

/** When a side question was answered: the time today, the day as well before that. */
export function asideTime(askedAt: number, now = Date.now()): string {
  const asked = new Date(askedAt)
  const time = asked.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (asked.toDateString() === new Date(now).toDateString()) return time
  return `${asked.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`
}

/**
 * The answer to a side question (`/btw`), above the message box. It is drawn apart from the conversation
 * because it is not part of it: a card of its own that shows the question, then the answer as it
 * arrives, and says that nothing here is added to the thread. It stays until it is dismissed, so the
 * answer can be read, copied, and looked back at while the agent works. A thread that has had several
 * side questions gets a pager, which steps through them; `position` says which of how many this one is.
 */
export function ChatAside({
  aside,
  position,
  onStep,
  onDismiss,
  onRetry,
}: {
  aside: Aside
  /** Which of the thread's side questions this is, counted from 0, and how many there are. */
  position?: { index: number; count: number }
  /** Shows the question before (-1) or after (1) this one. */
  onStep?: (by: number) => void
  onDismiss: () => void
  onRetry: () => void
}): JSX.Element {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  // Another question is another answer to copy.
  useEffect(() => setCopied(false), [aside.id])

  const copy = (): void => {
    void window.api.clipboard.writeText(aside.answer).then(() => {
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), COPIED_MS)
    }, () => undefined)
  }
  // A click on a button must not take the caret out of the message box.
  const keepFocus = (event: { preventDefault: () => void }): void => event.preventDefault()

  return (
    <section
      role="region"
      aria-label="Side question"
      data-testid="chat-aside"
      data-status={aside.status}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onDismiss()
      }}
      className="chat-aside mb-2 overflow-hidden rounded-2xl border border-line-strong bg-elevated shadow-lg shadow-shade/20"
    >
      <header className="flex items-start gap-2.5 px-3.5 pt-3">
        <span className="flex h-5 shrink-0 items-center gap-1 rounded-md bg-accent/15 pl-1.5 pr-2 text-[11.5px] font-medium text-accent">
          <SlashCommandIcon name="btw" className="h-3 w-3" />
          btw
        </span>
        <p
          data-testid="chat-aside-question"
          title={aside.question}
          className="chat-selectable line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-fg-muted"
        >
          {aside.question}
        </p>
        <div className="-mr-1 flex shrink-0 items-center gap-0.5">
          {position && position.count > 1 && onStep && (
            <div role="group" aria-label="Side question history" data-testid="chat-aside-pager" className="mr-1 flex items-center">
              <button type="button" data-testid="chat-aside-previous" aria-label="Earlier side question" title="Earlier side question" disabled={position.index === 0} onMouseDown={keepFocus} onClick={() => onStep(-1)} className={ACTION}>
                <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
              </button>
              <span data-testid="chat-aside-position" aria-live="polite" aria-label={`Side question ${position.index + 1} of ${position.count}`} className="min-w-[2.25rem] select-none text-center text-[11px] tabular-nums text-fg-subtle">
                {position.index + 1} / {position.count}
              </span>
              <button type="button" data-testid="chat-aside-next" aria-label="Later side question" title="Later side question" disabled={position.index === position.count - 1} onMouseDown={keepFocus} onClick={() => onStep(1)} className={ACTION}>
                <ChevronRight aria-hidden className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {aside.status === 'done' && (
            <button type="button" data-testid="chat-aside-copy" aria-label={copied ? 'Copied' : 'Copy answer'} title={copied ? 'Copied' : 'Copy answer'} onMouseDown={keepFocus} onClick={copy} className={ACTION}>
              {copied ? <Check aria-hidden className="h-3.5 w-3.5 text-ok" /> : <Copy aria-hidden className="h-3.5 w-3.5" />}
            </button>
          )}
          <button type="button" data-testid="chat-aside-dismiss" aria-label="Dismiss side question" title="Dismiss (Esc)" onMouseDown={keepFocus} onClick={onDismiss} className={ACTION}>
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <div
        // The editor ends an answer that ends in a list with an empty paragraph, which would be a blank line under it.
        className="chat-selectable max-h-[min(22rem,38vh)] overflow-y-auto px-4 pb-3 pt-2.5 [&_.ProseMirror>p:last-child:has(>br.ProseMirror-trailingBreak:only-child)]:hidden"
        data-testid="chat-aside-body"
        // A long answer scrolls; the keys must be able to reach it.
        tabIndex={aside.status === 'done' ? 0 : undefined}
      >
        {aside.status === 'loading' && (
          <div role="status" data-testid="chat-aside-loading" className="flex flex-col gap-2.5 py-0.5">
            <span className="flex items-center gap-2 text-[12.5px] text-fg-muted">
              <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin text-accent motion-reduce:animate-none" />
              Thinking about it…
            </span>
            <span aria-hidden className="flex flex-col gap-2">
              <span className="h-2 w-11/12 animate-pulse rounded-full bg-active motion-reduce:animate-none" />
              <span className="h-2 w-4/5 animate-pulse rounded-full bg-active motion-reduce:animate-none" />
              <span className="h-2 w-3/5 animate-pulse rounded-full bg-active motion-reduce:animate-none" />
            </span>
          </div>
        )}
        {aside.status === 'error' && (
          <div role="alert" data-testid="chat-aside-error" className="flex items-start gap-2 text-[13px] text-danger">
            <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{aside.error}</span>
            <button type="button" data-testid="chat-aside-retry" onMouseDown={keepFocus} onClick={onRetry} className="flex shrink-0 items-center gap-1 text-accent hover:underline">
              <RefreshCw aria-hidden className="h-3 w-3" />
              Retry
            </button>
          </div>
        )}
        {/* One editor per question: a new answer must not show the old one until the editor catches up. */}
        {aside.status === 'done' && <ChatMarkdown key={aside.id} text={aside.answer} label="Answer to the side question" />}
      </div>

      <footer className="flex items-center gap-3 border-t border-line px-3.5 py-1.5 text-[11px] text-fg-subtle">
        <span className="min-w-0 flex-1 truncate">Only you see this. It is not added to the conversation.</span>
        {aside.askedAt !== undefined && (
          <time data-testid="chat-aside-time" dateTime={new Date(aside.askedAt).toISOString()} title={new Date(aside.askedAt).toLocaleString()} className="shrink-0 tabular-nums">
            {asideTime(aside.askedAt)}
          </time>
        )}
      </footer>
    </section>
  )
}
