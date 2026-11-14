import { memo, useId, useRef, useState } from 'react'
import { ChevronRight, FileDiff } from 'lucide-react'
import { FileDiffCard } from '@/components/inbox/ChatFileChange'
import { useFoldAnchor, useStuck } from '@/components/inbox/chat-ui'
import { plural } from '@/lib/chat-tools'
import type { TurnChanges } from '@/lib/turn-changes'
import { cn } from '@/lib/utils'

/**
 * The files one turn changed, in a panel at its end (compact mode). Shut, it is one line: how many files and how many
 * lines came and went. Open, it lists each file as a row with its counts, and a row opens onto the file's diff, every
 * change the turn made to it one after the other. Open, its line stays at the top of the conversation while the list
 * scrolls under it, and shutting it keeps the line where it was on screen.
 */
export const ChatTurnChanges = memo(function ChatTurnChanges({ changes, directory }: { changes: TurnChanges; directory: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const { headerRef, keepPlace } = useFoldAnchor<HTMLButtonElement>(open)
  const sentinel = useRef<HTMLDivElement>(null)
  const stuck = useStuck(sentinel, open)
  const { files, additions, deletions } = changes
  return (
    // Not clipped (no overflow-hidden): that would keep the line from staying at the top. The corners are rounded by hand.
    <section
      className="rounded-lg border border-line bg-elevated/40"
      aria-label="Files changed in this turn"
      data-testid="chat-turn-changes"
      data-open={open ? '' : undefined}
    >
      <div ref={sentinel} aria-hidden className="h-0" />
      <div
        className={cn(
          'rounded-t-lg',
          !open && 'rounded-b-lg',
          open && 'sticky top-0 z-10 bg-bg',
          stuck && 'rounded-none border-b border-line shadow-[0_6px_10px_-8px_rgb(0_0_0/0.5)]',
        )}
        data-stuck={stuck ? '' : undefined}
      >
        <button
          ref={headerRef}
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => {
            if (open) keepPlace()
            setOpen(!open)
          }}
          className={cn(
            'group/changes flex w-full min-w-0 items-center gap-2 rounded-[inherit] px-3 py-2 text-left text-[12.5px] leading-5 transition-colors hover:bg-hover/60 focus-visible:bg-hover/60 focus-visible:outline-none',
            open && 'bg-elevated/40',
          )}
          data-testid="chat-turn-changes-toggle"
        >
          <FileDiff aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
          <span className="min-w-0 flex-1 truncate text-fg-muted">
            Changed <span className="text-fg">{plural(files.length, 'file')}</span>
          </span>
          <span className="inbox-code-font flex shrink-0 items-center gap-2 text-[11.5px] tabular-nums" data-testid="chat-turn-changes-stats">
            <span className={additions > 0 ? 'text-ok' : 'text-fg-subtle'}>+{additions}</span>
            <span className={deletions > 0 ? 'text-danger' : 'text-fg-subtle'}>−{deletions}</span>
          </span>
          <ChevronRight
            aria-hidden
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-fg-subtle transition-transform duration-150 group-hover/changes:text-fg',
              open && 'rotate-90',
            )}
          />
        </button>
      </div>
      {open && (
        <div id={listId} className="flex min-w-0 flex-col border-t border-line px-1.5 py-1" data-testid="chat-turn-changes-list">
          {files.map((change) => (
            <FileDiffCard key={change.path} change={change} status="completed" directory={directory} testId="chat-turn-change" />
          ))}
        </div>
      )}
    </section>
  )
})
