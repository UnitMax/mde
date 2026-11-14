import { memo, useId, useState } from 'react'
import { ChevronRight, FileDiff } from 'lucide-react'
import { FileDiffCard } from '@/components/inbox/ChatFileChange'
import { plural } from '@/lib/chat-tools'
import type { TurnChanges } from '@/lib/turn-changes'
import { cn } from '@/lib/utils'

/**
 * The files one turn changed, in a panel at its end (compact mode). Shut, it is one line: how many files and how many
 * lines came and went. Open, it lists each file as a row with its counts, and a row opens onto the file's diff, every
 * change the turn made to it one after the other.
 */
export const ChatTurnChanges = memo(function ChatTurnChanges({ changes, directory }: { changes: TurnChanges; directory: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const { files, additions, deletions } = changes
  return (
    <section
      className="overflow-hidden rounded-lg border border-line bg-elevated/40"
      aria-label="Files changed in this turn"
      data-testid="chat-turn-changes"
      data-open={open ? '' : undefined}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
        className="group/changes flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-[12.5px] leading-5 transition-colors hover:bg-hover/60 focus-visible:bg-hover/60 focus-visible:outline-none"
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
