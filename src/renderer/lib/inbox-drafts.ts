import type { ChatDraftSummary, InboxFolder } from '@shared/types'
import { inboxThreadFolder } from '@/lib/inbox'
import { matchSubsequence, queryTokens } from '@/lib/fuzzy-search'

/** A new id for a draft the new-thread page is about to edit; it is only saved once something is typed. */
export function newDraftId(): string {
  return `drf_${crypto.randomUUID()}`
}

/** What a draft's row is called: the first line that says something, or the first file when there is no text. */
export function draftTitle(draft: ChatDraftSummary): string {
  const line = draft.preview.split(/\r?\n/).map((part) => part.replace(/\s+/g, ' ').trim()).find(Boolean)
  if (line) return line
  if (draft.attachmentName) {
    return draft.attachments > 1 ? `${draft.attachmentName} and ${draft.attachments - 1} more` : draft.attachmentName
  }
  return 'Empty draft'
}

/**
 * The project a draft is for, as far as its icon goes: the draft's folder, or for a worktree folder the
 * project it was cut from. Undefined when the folder is gone from the Inbox.
 */
export function draftProject(draft: ChatDraftSummary, folders: readonly InboxFolder[]): InboxFolder | undefined {
  const own = folders.find((folder) => folder.id === draft.folderId)
  if (!own?.worktree) return own
  return inboxThreadFolder({ folderId: own.id, worktree: own.worktree, target: own.target }, folders) ?? own
}

/** The drafts for one project, or all of them with no project; a worktree folder's draft is its source project's. */
export function draftsInProject(
  drafts: readonly ChatDraftSummary[],
  project: Pick<InboxFolder, 'id'> | null,
  folders: readonly InboxFolder[]
): ChatDraftSummary[] {
  if (!project) return [...drafts]
  return drafts.filter((draft) => draftProject(draft, folders)?.id === project.id)
}

/** The folder's name in a row, or a note that it is gone from the Inbox (the draft then opens in the page's folder). */
export function draftFolderLabel(draft: ChatDraftSummary, folders: readonly InboxFolder[]): string {
  return folders.find((folder) => folder.id === draft.folderId)?.name ?? 'Removed folder'
}

/**
 * The drafts to list: all of them but `hidden`, the one the new-thread page is showing for the first
 * time (it only joins the list once it is left), narrowed by the search over its text and folder.
 */
export function visibleDrafts(
  drafts: readonly ChatDraftSummary[],
  hidden: string | null,
  folders: readonly InboxFolder[],
  query = '',
): ChatDraftSummary[] {
  const tokens = queryTokens(query)
  return drafts.filter((draft) => {
    if (draft.id === hidden) return false
    if (tokens.length === 0) return true
    const fields = [draft.preview, draft.attachmentName ?? '', draftFolderLabel(draft, folders)]
    return tokens.every((token) => fields.some((field) => matchSubsequence(token, field)))
  })
}
