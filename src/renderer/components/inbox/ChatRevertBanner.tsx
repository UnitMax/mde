import { useState } from 'react'
import { ChevronRight, LoaderCircle, Redo2, Undo2 } from 'lucide-react'
import type { ChatRevert, ChatRevertFile } from '@shared/types'
import { displayPath } from '@/lib/chat'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { cn } from '@/lib/utils'

/** A list of this many files or fewer starts open; a longer one starts folded. */
export const REVERT_FILES_OPEN = 6
/** A list shows this many files; the rest are counted. */
export const REVERT_FILES_SHOWN = 20

/** What the revert did to a file, from the file's point of view: the agent's change was undone. */
const OUTCOME: Record<ChatRevertFile['status'], string> = {
  modified: 'Restored',
  deleted: 'Removed',
  added: 'Recreated',
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * The note where the hidden part of the conversation would be: how much a staged revert took out of
 * view and which files it put back. The messages themselves are only hidden until the next message
 * is sent, which is what the note says, and until then Redo brings everything back.
 */
export function ChatRevertBanner({
  revert,
  messages,
  directory,
  onRedo,
}: {
  revert: ChatRevert
  /** How many of the user's messages are hidden. */
  messages: number
  directory: string
  /** Brings the messages and files back. A rejection keeps the note and shows the error. */
  onRedo: () => Promise<void>
}): JSX.Element {
  const [open, setOpen] = useState(revert.files.length <= REVERT_FILES_OPEN)
  const [redoing, setRedoing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const redo = (): void => {
    if (redoing) return
    setRedoing(true)
    setError(null)
    onRedo().then(
      () => setRedoing(false),
      (failure: unknown) => {
        setError(ipcErrorMessage(failure, 'Could not redo the revert.'))
        setRedoing(false)
      },
    )
  }
  const shown = revert.files.slice(0, REVERT_FILES_SHOWN)
  return (
    <section
      data-testid="chat-revert"
      aria-label="Reverted messages"
      className="min-w-0 rounded-lg border border-line bg-panel px-3 py-2 text-[12px]"
    >
      <div className="flex min-w-0 items-center gap-2 text-fg-muted">
        <Undo2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="min-w-0 flex-1" data-testid="chat-revert-summary">
          {messages > 0 ? <span className="tabular-nums text-fg">{plural(messages, 'message', 'messages')}</span> : 'The conversation'}{' '}
          reverted
          {revert.files.length > 0 && (
            <>
              {' · '}
              <span className="tabular-nums">{plural(revert.files.length, 'file', 'files')}</span> restored
            </>
          )}
        </span>
        <button
          type="button"
          onClick={redo}
          disabled={redoing}
          title="Show the messages again and put the files back as they were when you reverted"
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-accent transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-60"
        >
          {redoing ? <LoaderCircle aria-hidden className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : <Redo2 aria-hidden className="h-3 w-3" />}
          {redoing ? 'Redoing…' : 'Redo'}
        </button>
      </div>
      {error && <p role="alert" className="mt-1.5 text-danger">{error}</p>}
      {revert.files.length > 0 && (
        <div className="mt-1.5">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="flex items-center gap-1 rounded px-1 text-fg-subtle transition-colors hover:text-fg"
          >
            <ChevronRight aria-hidden className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')} />
            {open ? 'Hide files' : 'Show files'}
          </button>
          {open && (
            <ul className="mt-1 flex flex-col gap-0.5" data-testid="chat-revert-files">
              {shown.map((file) => {
                const name = displayPath(file.path, directory)
                return (
                  <li key={file.path} className="flex min-w-0 items-center gap-2 pl-4">
                    <span className="w-16 shrink-0 text-fg-subtle">{OUTCOME[file.status]}</span>
                    <span className="inbox-code-font min-w-0 flex-1 truncate text-[11.5px] text-fg" title={file.path}>{name}</span>
                    <span className="inbox-code-font flex shrink-0 items-center gap-2 text-[11.5px] tabular-nums">
                      {file.additions > 0 && <span className="text-ok">+{file.additions}</span>}
                      {file.deletions > 0 && <span className="text-danger">−{file.deletions}</span>}
                    </span>
                  </li>
                )
              })}
              {revert.files.length > shown.length && (
                <li className="pl-4 text-fg-subtle">and {revert.files.length - shown.length} more</li>
              )}
            </ul>
          )}
        </div>
      )}
      <p className="mt-1.5 text-fg-subtle">Sending a message now removes the reverted messages for good.</p>
    </section>
  )
}
