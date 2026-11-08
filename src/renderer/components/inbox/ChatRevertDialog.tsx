import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { ChatMessage } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ipcErrorMessage } from '@/lib/ipc-error'

type UserMessage = Extract<ChatMessage, { kind: 'user' }>

/**
 * Asks before the conversation is reverted to just before one of the user's messages. Nothing is
 * deleted by it, and a redo undoes it until the next message is sent, but it does put files back,
 * which replaces any change the person made to them by hand, so that is said here and can be
 * switched off. The dialog belongs to the thread view, not to the message, because the message is
 * hidden by the very thing the dialog does.
 */
export function ChatRevertDialog({
  message,
  hidden,
  running,
  onCancel,
  onConfirm,
}: {
  /** The message to revert to; null while the dialog is closed. */
  message: UserMessage | null
  /** How many of the user's messages, this one included, the revert hides. */
  hidden: number
  /** Whether the agent is working now, which the revert stops first. */
  running: boolean
  onCancel: () => void
  onConfirm: (options: { files: boolean }) => Promise<void>
}): JSX.Element {
  const [files, setFiles] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = message?.id

  // A fresh question each time the dialog opens.
  useEffect(() => {
    setFiles(true)
    setPending(false)
    setError(null)
  }, [id])

  const confirm = async (): Promise<void> => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await onConfirm({ files })
    } catch (reason) {
      setError(ipcErrorMessage(reason, 'Could not revert the conversation.'))
      setPending(false)
    }
  }

  return (
    <Dialog open={message !== null} onOpenChange={(open) => { if (!open && !pending) onCancel() }}>
      <DialogContent className="max-w-md" data-testid="chat-revert-dialog">
        <DialogHeader>
          <DialogTitle>Revert to before this message?</DialogTitle>
          <DialogDescription>
            {hidden > 1 ? `These ${hidden} messages` : 'This message'} and the agent&apos;s replies will be hidden, and the text goes back in the
            message box so you can change it and send it again.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void confirm()
          }}
        >
          <blockquote
            className="line-clamp-4 whitespace-pre-wrap break-words rounded-md border border-line bg-bg px-3 py-2 text-[12.5px] leading-snug text-fg-muted"
            data-testid="chat-revert-quote"
          >
            {message?.text.trim() ? message.text : 'A message without text'}
          </blockquote>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={files}
              disabled={pending}
              onChange={(event) => setFiles(event.target.checked)}
            />
            <span>
              <span className="text-fg">Restore file changes</span>
              <span className="block text-fg-muted">
                Puts back the files the agent changed from here on. Changes you made to those files yourself since then are replaced.
              </span>
            </span>
          </label>
          {running && <p className="text-xs text-fg-muted">The agent is still working and will be stopped first.</p>}
          {message?.attachments?.length ? <p className="text-xs text-fg-muted">Attachments on this message are not put back.</p> : null}
          <p className="text-xs text-fg-subtle">You can redo this until you send a message.</p>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>
            <Button type="submit" disabled={pending}>
              {pending && <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />}
              Revert
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
