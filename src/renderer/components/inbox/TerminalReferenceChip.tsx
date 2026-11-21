import { SquareTerminal } from 'lucide-react'
import type { TerminalReferenceToken } from '@shared/terminal-references'
import { notifyActionError } from '@/lib/toasts'
import { useInboxTerminal } from '@/store/inbox-terminal'

/**
 * A terminal a sent message points at (`[terminal:<ref> "<title>"]`), shown with the title the pane had when it
 * was dropped in. A click brings that pane into view, if it still runs the shell that was shared.
 */
export function TerminalReferenceChip({ reference, text }: { reference: TerminalReferenceToken; text: string }): JSX.Element {
  const reveal = (): void => {
    void window.api.terminalReferences.resolve({ ref: reference.ref }).then(
      (found) => {
        const open = found && useInboxTerminal.getState().layout.panes.some((pane) => pane.terminalId === found.terminalId)
        if (found && open) useInboxTerminal.getState().reveal(found.terminalId)
        else notifyActionError({ label: 'Terminal gone', title: reference.title, detail: 'That terminal pane was closed or its shell restarted since, so the agent can no longer read it. Drag the pane in again to share it.' })
      },
      () => undefined,
    )
  }
  return (
    <button
      type="button"
      data-testid="chat-terminal-reference"
      title="A terminal the agent can read. Click to show it."
      aria-label={`Terminal ${reference.title}`}
      onClick={reveal}
      className="mx-px inline-flex max-w-full items-baseline gap-1 rounded-[5px] border border-accent/40 bg-accent/10 px-1.5 align-baseline text-[12.5px] leading-normal text-fg hover:bg-accent/20"
    >
      <SquareTerminal aria-hidden className="h-3 w-3 shrink-0 self-center text-accent" />
      <span className="truncate">{reference.title}</span>
      {/* The words as written stay in the page for copying and find, unseen. */}
      <span className="sr-only">{text}</span>
    </button>
  )
}
