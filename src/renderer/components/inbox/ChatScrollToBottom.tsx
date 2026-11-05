import { ArrowDown } from 'lucide-react'

/**
 * Shown over the foot of the conversation while it is scrolled up, so that the way back to the newest
 * message is one click. The layer around it passes the pointer through to the messages.
 */
export function ChatScrollToBottom({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
      <button
        type="button"
        data-testid="chat-scroll-to-bottom"
        onClick={onClick}
        className="chat-scroll-pill pointer-events-auto flex h-8 items-center gap-1.5 rounded-full border border-line-strong bg-elevated pl-2.5 pr-3.5 text-[12px] text-fg-muted shadow-lg shadow-black/40 transition-colors hover:bg-hover hover:text-fg"
      >
        <ArrowDown aria-hidden className="h-3.5 w-3.5" />
        Scroll to bottom
      </button>
    </div>
  )
}
