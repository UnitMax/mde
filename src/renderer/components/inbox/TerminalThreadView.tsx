import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle, RotateCw, Terminal } from 'lucide-react'
import type { ChatDraft, InboxThread } from '@shared/types'
import { inboxThreadTerminalId, inboxThreadTerminalSession } from '@shared/inbox-thread-terminal'
import { TerminalSurface } from '@/components/TerminalView'
import { TerminalThreadHighlight } from '@/components/inbox/TerminalThreadHighlight'
import { Button } from '@/components/ui/button'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useInboxChat } from '@/store/inbox-chat'
import { useWorkspace } from '@/store/workspace'
import { fitSession, getSession } from '@/terminal/sessions'
import { getTerminalSettings } from '@/terminal/terminal-settings'
import { getTerminalPalette } from '@/theme/themes'

/** The native OpenCode TUI attached to the same API session the Inbox sidebar follows. */
export function TerminalThreadView({ thread }: { thread: InboxThread }): JSX.Element {
  const terminalId = inboxThreadTerminalId(thread.id)
  const session = useMemo(() => inboxThreadTerminalSession(thread), [thread.id, thread.directory, thread.target, thread.title, thread.createdAt])
  const pane = useMemo(() => ({ terminalId }), [terminalId])
  const status = useWorkspace((state) => state.statuses[terminalId] ?? 'none')
  const openThread = useInboxChat((state) => state.openThread)
  const send = useInboxChat((state) => state.send)
  const draftReload = useInboxChat((state) => state.draftReloads[thread.id])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ChatDraft | null>(null)

  // Keep the thread's API subscription and reconnect behavior while its terminal is displayed.
  useEffect(() => openThread(thread.id), [openThread, thread.id])
  useEffect(() => {
    let cancelled = false
    // A sidebar fork may preserve an unfinished message after the new terminal is already mounted.
    void window.api.chat.draft({ key: `thread:${thread.id}`, action: 'load' }).then((value) => {
      if (!cancelled) setDraft(value)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [thread.id, draftReload?.id])
  const hasDraft = Boolean(draft?.text.trim() || draft?.attachments.length)

  const retry = async (firstMessage = false): Promise<void> => {
    setPending(true)
    setError(null)
    try {
      if (firstMessage) {
        const draft = await window.api.chat.draft({ key: `thread:${thread.id}`, action: 'load' })
        await send(thread.id, draft.text, { attachmentIds: draft.attachments.map((file) => file.id), draftRevision: draft.revision })
        setDraft(null)
        if (draftReload) useInboxChat.getState().clearDraftReload(thread.id, draftReload.id)
      } else {
        const terminal = getSession(terminalId)
        terminal?.term.reset()
        const result = await window.api.pty.restart({
          terminalId,
          sessionId: session.id,
          size: terminal ? fitSession(terminal) ?? { cols: 80, rows: 24 } : { cols: 80, rows: 24 },
          palette: getTerminalPalette(getTerminalSettings().theme),
        })
        useWorkspace.getState().clearExit(terminalId)
        useWorkspace.getState().setStatus(terminalId, result)
        terminal?.term.focus()
      }
    } catch (failure) {
      setError(ipcErrorMessage(failure, firstMessage ? 'Could not send the first message.' : 'Could not reopen OpenCode.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="inbox-terminal-thread">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2 text-xs text-fg-subtle">
        <Terminal aria-hidden className="h-3.5 w-3.5" />
        <span className="flex-1" title="The Inbox follows this thread’s original conversation. Switching conversations inside OpenCode does not relink the thread.">Terminal chat</span>
        {status === 'exited' && (
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => void retry()}>
            {pending ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
            Reopen OpenCode
          </Button>
        )}
      </div>
      {(thread.sendError || hasDraft) && (
        <div role={thread.sendError ? 'alert' : 'status'} className="flex items-center gap-3 border-b border-line px-4 py-2 text-xs text-fg-muted">
          <div className="min-w-0 flex-1">
            <p className={thread.sendError ? 'text-danger' : undefined}>{thread.sendError ?? 'This thread has an unsent draft.'}</p>
            {hasDraft && <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-fg-subtle">{draft!.text || `${draft!.attachments.length} attachment(s)`}</p>}
          </div>
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => void retry(true)}>{thread.sendError ? 'Retry first message' : 'Send saved draft'}</Button>
        </div>
      )}
      {error && <p role="alert" className="px-4 py-2 text-xs text-danger">{error}</p>}
      <div className="relative flex min-h-0 flex-1 overflow-hidden" data-testid="inbox-terminal-surface">
        <TerminalSurface session={session} pane={pane} onFocus={() => {}} isFullscreen={false} />
        <TerminalThreadHighlight threadId={thread.id} />
      </div>
    </div>
  )
}
