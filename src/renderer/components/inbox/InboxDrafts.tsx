import { useState } from 'react'
import { ChevronDown, ChevronRight, Folder, Paperclip, PenLine, Trash2 } from 'lucide-react'
import type { ChatDraftSummary, InboxFolder } from '@shared/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { draftFolderLabel, draftTitle } from '@/lib/inbox-drafts'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { sessionAge, sessionDate } from '@/lib/opencode-sessions'
import { cn } from '@/lib/utils'
import { useInboxDrafts } from '@/store/inbox-drafts'
import { useInboxView } from '@/store/inbox-view'

/**
 * One unsent new thread, drawn like a thread row. Hovering offers Delete draft where a thread offers
 * Park, since a draft has nothing to be parked: it is either carried on with or thrown away.
 */
function DraftRow({
  draft,
  folders,
  selected,
  now,
  onOpen
}: {
  draft: ChatDraftSummary
  folders: readonly InboxFolder[]
  /** This is the draft the page shows. */
  selected: boolean
  now: number
  onOpen: () => void
}): JSX.Element {
  const remove = useInboxDrafts((state) => state.remove)
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const title = draftTitle(draft)

  return (
    <>
      <div className={cn('group relative rounded', selected ? 'bg-active' : 'hover:bg-hover')}>
        <button
          type="button"
          data-testid={`inbox-draft-${draft.id}`}
          aria-current={selected || undefined}
          onClick={onOpen}
          className="flex w-full min-w-0 flex-col gap-0.5 rounded px-2 py-1.5 text-left"
        >
          <span className="flex w-full min-w-0 items-center gap-1.5 group-hover:pr-28 group-focus-within:pr-28">
            <PenLine aria-hidden="true" className="h-3 w-3 shrink-0 text-fg-subtle" />
            <span className={cn('min-w-0 flex-1 truncate text-[13px]', selected ? 'text-fg' : 'text-fg-muted')}>
              {title}
            </span>
            <time
              dateTime={new Date(draft.updatedAt).toISOString()}
              title={sessionDate(draft.updatedAt)}
              className="shrink-0 text-[11px] text-fg-subtle group-hover:hidden group-focus-within:hidden"
            >
              {sessionAge(draft.updatedAt, now)}
            </time>
          </span>
          <span className="flex w-full min-w-0 items-center gap-1 text-[11px] text-fg-subtle">
            <Folder aria-hidden="true" className="h-3 w-3 shrink-0" />
            <span className="min-w-0 truncate">{draftFolderLabel(draft, folders)}</span>
            {draft.attachments > 0 && (
              <>
                <Paperclip aria-hidden="true" className="ml-1 h-3 w-3 shrink-0" />
                <span
                  className="shrink-0"
                  title={draft.attachments === 1 ? draft.attachmentName : `${draft.attachments} files`}
                >
                  {draft.attachments}
                </span>
              </>
            )}
          </span>
        </button>
        <button
          type="button"
          data-testid={`inbox-draft-delete-${draft.id}`}
          aria-label="Delete draft"
          title="Delete draft"
          onClick={() => setConfirming(true)}
          className="absolute right-1.5 top-1.5 flex h-5 items-center justify-center gap-1 whitespace-nowrap rounded px-1.5 text-[11px] text-fg-muted opacity-0 transition-opacity hover:bg-active hover:text-danger focus-visible:bg-active group-focus-within:opacity-100 group-hover:opacity-100"
        >
          <Trash2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span>Delete draft</span>
        </button>
      </div>

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          setConfirming(open)
          if (!open) setError(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
          <AlertDialogDescription>
            “{title}” has not been sent. Deleting it also deletes the files saved with it, and cannot be undone.
          </AlertDialogDescription>
          {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="inbox-draft-confirm-delete"
              disabled={removing}
              onClick={(event) => {
                // Stay open until it is gone, so a failure can be shown and tried again.
                event.preventDefault()
                setRemoving(true)
                setError(null)
                remove(draft.id)
                  .then(() => setConfirming(false))
                  .catch((reason) => setError(ipcErrorMessage(reason, 'Could not delete the draft.')))
                  .finally(() => setRemoving(false))
              }}
            >
              Delete draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * The new threads that were started and not sent, in a section of their own above Working that folds
 * up to its header. A draft is here from the moment its page is left with something typed in it,
 * and it stays until it is sent or deleted. The filter tabs do not apply; the search does.
 */
export function InboxDraftsSection({
  drafts,
  folders,
  searching,
  selectedId,
  now,
  onOpen
}: {
  drafts: readonly ChatDraftSummary[]
  folders: readonly InboxFolder[]
  /** A search is narrowing the drafts. */
  searching: boolean
  /** The draft the page shows, when it was taken from this list. */
  selectedId: string | null
  now: number
  onOpen: (draft: ChatDraftSummary) => void
}): JSX.Element {
  const collapsed = useInboxView((state) => state.draftsCollapsed)
  const setCollapsed = useInboxView((state) => state.setDraftsCollapsed)
  const Chevron = collapsed ? ChevronRight : ChevronDown
  return (
    <section
      data-testid="inbox-drafts-section"
      aria-label="Drafts"
      // A direct child of the panel, so the percentage is of the panel; the list above keeps its own minimum.
      className="flex max-h-[35%] min-h-0 shrink flex-col border-t border-line pt-1"
    >
      <button
        type="button"
        data-testid="inbox-drafts-toggle"
        aria-expanded={!collapsed}
        aria-controls="inbox-drafts-list"
        onClick={() => setCollapsed(!collapsed)}
        className="flex h-6 w-full shrink-0 items-center gap-1 rounded px-1 text-left text-[11px] font-medium uppercase tracking-wide text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
      >
        <Chevron aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span>Drafts</span>
        <span
          data-testid="inbox-drafts-count"
          className="rounded bg-elevated px-1.5 py-px text-[10px] font-medium normal-case tracking-normal text-fg-muted"
        >
          {drafts.length}
        </span>
      </button>
      {!collapsed && (
        <div id="inbox-drafts-list" data-testid="inbox-drafts-list" className="mt-0.5 min-h-0 flex-1 overflow-y-auto">
          {drafts.length === 0 ? (
            <p className="px-2 py-1 text-xs text-fg-subtle">
              {searching ? 'No drafts match your search.' : 'No drafts.'}
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {drafts.map((draft) => (
                <DraftRow
                  key={draft.id}
                  draft={draft}
                  folders={folders}
                  selected={draft.id === selectedId}
                  now={now}
                  onOpen={() => onOpen(draft)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
