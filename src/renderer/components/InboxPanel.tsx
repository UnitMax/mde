import { useEffect, useRef, useState, type MouseEvent } from 'react'
import {
  Car,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitFork,
  Inbox,
  LoaderCircle,
  Lock,
  Mail,
  MailOpen,
  PenLine,
  Pin,
  PinOff,
  Terminal,
  Trash2,
  X
} from 'lucide-react'
import type { InboxThread } from '@shared/types'
import { ElapsedTime } from '@/components/ElapsedTime'
import { InboxChangesBadge } from '@/components/inbox/InboxChanges'
import { InboxDraftsSection } from '@/components/inbox/InboxDrafts'
import { InboxToolbar } from '@/components/inbox/InboxToolbar'
import { StatusMark, statusGlyph } from '@/components/inbox/StatusMark'
import { ThreadEffect } from '@/components/ThreadEffect'
import { ProjectIcon } from '@/components/inbox/ProjectIcon'
import { ThreadRenameDialog, useThreadRename } from '@/components/inbox/ThreadRename'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  INBOX_CLOCK_MS,
  countUnreadInboxThreads,
  inboxFolderLabel,
  inboxProjectSummaries,
  inboxProjects,
  inboxThreadFolder,
  inboxThreadHome,
  inboxThreadsInProject,
  inboxWorktreeShared,
  inboxLocked,
  inboxThreadWorking,
  inboxCueActive,
  inboxModelLabel,
  inboxStatusChip,
  isInboxThreadUnread,
  sessionAge,
  sessionDate,
  visibleInboxThreads,
  workingInboxThreads,
  type InboxFilter
} from '@/lib/inbox'
import { draftsInProject, visibleDrafts } from '@/lib/inbox-drafts'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { cn } from '@/lib/utils'
import { useInboxChat } from '@/store/inbox-chat'
import { useInboxChanges, inboxChangesKey } from '@/store/inbox-changes'
import { useInboxDrafts } from '@/store/inbox-drafts'
import { useInboxView } from '@/store/inbox-view'
import { useWorkspace } from '@/store/workspace'

/** Re-renders on an interval so "5m ago" labels stay current. */
export function useInboxClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), INBOX_CLOCK_MS)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

/** True where the Inbox cannot be used. */
export function useInboxLock(): boolean {
  const platform = useWorkspace((state) => state.platform)
  const wslAvailable = useWorkspace((state) => state.wslAvailable)
  return inboxLocked(platform, wslAvailable)
}

/** `elapsed` adds how long a working thread has been going, counting up. */
export function InboxStatusBadge({
  thread,
  elapsed = false,
  hideDone = false
}: {
  thread: InboxThread
  elapsed?: boolean
  /** Leaves out "Done", for a place where finished is what a thread normally is. */
  hideDone?: boolean
}): JSX.Element | null {
  const chip = inboxStatusChip(thread)
  const cueAt = useWorkspace((state) => state.inboxCues[thread.id])
  if (!chip || (hideDone && thread.status === 'completed')) return null
  const cued = inboxCueActive(cueAt)
  return (
    <StatusMark
      // A new key replays the pop each time something new happens in the thread being read.
      key={cued ? cueAt : 'still'}
      tone={chip.tone}
      glyph={statusGlyph(thread.status)}
      data-testid="inbox-status-chip"
      data-cue={cued || undefined}
      className={cn(cued && 'inbox-cue-pop')}
    >
      {chip.label}
      {elapsed && thread.status === 'working' && thread.workingSince !== undefined && (
        <>
          <span aria-hidden="true" className="opacity-50">
            ·
          </span>
          <ElapsedTime since={thread.workingSince} className="font-normal opacity-75" />
        </>
      )}
    </StatusMark>
  )
}

export function InboxLockedNotice({ compact = false }: { compact?: boolean }): JSX.Element {
  return (
    <div
      data-testid="inbox-locked"
      className={cn(
        'flex flex-col items-center text-center',
        compact ? 'gap-2 px-2 py-4' : 'h-full justify-center gap-3 px-6'
      )}
    >
      <Lock className={cn('text-fg-subtle', compact ? 'h-4 w-4' : 'h-6 w-6')} />
      <div>
        <p className="text-[13px] text-fg-muted">Inbox is not available here</p>
        <p className="mt-1 text-xs text-fg-subtle">
          The Inbox talks to OpenCode’s background service, which MDE can reach on macOS and in WSL
          on Windows.
        </p>
      </div>
    </div>
  )
}

type BulkAction = 'pin' | 'read' | 'park'

function InboxThreadRow({
  thread,
  selected,
  multiSelected,
  bulkPending,
  onBulk,
  now,
  forking,
  onSelect,
  onFork
}: {
  thread: InboxThread
  selected: boolean
  multiSelected: boolean
  bulkPending: boolean
  onBulk: (action: BulkAction, value: boolean) => void
  now: number
  /** A fork is being made, so another one waits. */
  forking: boolean
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void
  onFork: () => void
}): JSX.Element {
  const setRead = useWorkspace((state) => state.setInboxThreadRead)
  const setArchived = useWorkspace((state) => state.setInboxThreadArchived)
  const setPinned = useWorkspace((state) => state.setInboxThreadPinned)
  const rename = useThreadRename(thread)
  const { saving: savingName, error: nameError, renaming } = rename
  const pinLabel = thread.pinned ? 'Unpin thread' : 'Pin thread'
  const PinIcon = thread.pinned ? PinOff : Pin
  const parkLabel = thread.archived ? 'Move to Inbox' : 'Park'
  const ParkIcon = thread.archived ? Inbox : Car
  const removeThread = useWorkspace((state) => state.removeInboxThread)
  const reloadFolders = useInboxChat((state) => state.reloadFolders)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [alsoRemoveWorktree, setAlsoRemoveWorktree] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  // A worktree another thread (a fork of this one, say) still runs in is not offered for removal.
  const ownsWorktree = useWorkspace((state) => Boolean(thread.worktree) && !inboxWorktreeShared(thread, state.inboxThreads))
  const unread = isInboxThreadUnread(thread)
  // Fancy mode lights the row: a storm while it is unread, digital rain while it works (unread comes first).
  const effect = unread ? 'unread' : inboxThreadWorking(thread) ? 'working' : null
  // The project's own name and icon; once it has been removed from the Inbox, the folder's name and the plain folder.
  const project = useInboxChat((state) => inboxThreadFolder(thread, state.folders))
  const titleIcons = useInboxView((state) => state.titleIcons)
  const model = inboxModelLabel(thread.model)
  const showChanges = useInboxChanges((state) => state.sidebarChanges)
  const checkout = useInboxChanges((state) => state.entries[inboxChangesKey(thread.id)]?.value)
  const branch = checkout?.available ? checkout.branch : thread.branch
  const cueAt = useWorkspace((state) => state.inboxCues[thread.id])
  // An unsent message waits in this thread's box. The open thread is left out: its box is right there.
  const hasDraft = useInboxDrafts((state) => !selected && state.threadDrafts.includes(thread.id))

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className={cn('group relative isolate rounded', selected || multiSelected ? 'bg-active' : unread ? 'bg-accent/[0.08] hover:bg-hover' : 'hover:bg-hover', multiSelected && 'ring-1 ring-inset ring-accent')}>
          {effect && <ThreadEffect kind={effect} seed={thread.id} />}
          {selected && <span aria-hidden="true" data-testid={`inbox-thread-selected-bar-${thread.id}`} className="pointer-events-none absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" />}
          <button
            type="button"
            data-testid={`inbox-thread-${thread.id}`}
            data-unread={unread || undefined}
            aria-current={selected || undefined}
            aria-label={multiSelected ? `${thread.customTitle ?? thread.title}, selected` : undefined}
            onClick={onSelect}
            className="flex w-full min-w-0 flex-col gap-0.5 rounded px-2.5 py-2 text-left"
          >
            <span
              className={cn(
                'flex w-full min-w-0 items-center gap-1.5',
                thread.archived
                  ? 'group-hover:pr-28 group-focus-within:pr-28'
                  : 'group-hover:pr-14 group-focus-within:pr-14',
              )}
            >
              {titleIcons && (
                <ProjectIcon
                  icon={project?.icon}
                  size="title"
                  testId={`inbox-thread-title-icon-${thread.id}`}
                  className="text-fg-muted"
                />
              )}
              {unread && (
                <span
                  aria-label="Unread"
                  className="h-2 w-2 shrink-0 rounded-full bg-accent"
                />
              )}
              {thread.forkedFrom && (
                <GitFork
                  role="img"
                  aria-label="Forked thread"
                  data-testid={`inbox-thread-fork-mark-${thread.id}`}
                  className="h-3 w-3 shrink-0 text-fg-subtle"
                />
              )}
              {thread.mode === 'terminal' && (
                <span title="Terminal thread" data-testid={`inbox-thread-terminal-mark-${thread.id}`}>
                  <Terminal role="img" aria-label="Terminal thread" className="h-3 w-3 shrink-0 text-fg-subtle" />
                </span>
              )}
              {thread.pinned && (
                <Pin
                  role="img"
                  aria-label="Pinned thread"
                  className="h-3 w-3 shrink-0 text-fg-subtle"
                />
              )}
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[14px]',
                  // Unread reads at a glance: bold in the full colour, against regular weight in a slightly softer one.
                  unread || selected ? 'text-fg' : 'text-fg/90',
                  unread ? 'font-bold' : 'font-normal'
                )}
              >
                {thread.customTitle ?? thread.title}
              </span>
              <time
                dateTime={new Date(thread.lastActivityAt).toISOString()}
                title={sessionDate(thread.lastActivityAt)}
                className={cn('shrink-0 text-[11px] group-hover:hidden group-focus-within:hidden', unread ? 'font-semibold text-fg' : 'text-fg-muted')}
              >
                {sessionAge(thread.lastActivityAt, now)}
              </time>
            </span>
            {/* With the icon in front of the title, the lines below start where the title does. */}
            <span className={cn('flex w-full min-w-0 items-center gap-1 text-[11px] text-fg-muted', titleIcons && 'pl-5')}>
              {!titleIcons && <ProjectIcon icon={project?.icon} />}
              <span className="min-w-0 truncate" title={thread.directory} data-testid={`inbox-thread-project-${thread.id}`}>
                {project?.name ?? inboxFolderLabel(inboxThreadHome(thread))}
              </span>
              {branch && (
                <>
                  <GitBranch className="ml-1 h-3 w-3 shrink-0" />
                  <span className="min-w-0 truncate" title={branch}>
                    {branch}
                  </span>
                </>
              )}
            </span>
            {(model || hasDraft || inboxStatusChip(thread)) && (
              <span className={cn('flex w-full min-w-0 items-center gap-1.5 text-[11px]', titleIcons && 'pl-5')}>
                <span
                  className="min-w-0 flex-1 truncate text-fg-muted"
                  title={thread.model ? `${thread.model.providerId}/${thread.model.id}` : undefined}
                >
                  {model}
                </span>
                {hasDraft && (
                  <StatusMark
                    tone="muted"
                    data-testid={`inbox-thread-draft-${thread.id}`}
                    title="There is an unsent message in this thread’s box"
                  >
                    <PenLine aria-hidden="true" className="status-mark-glyph" />
                    Draft
                  </StatusMark>
                )}
                <InboxStatusBadge thread={thread} elapsed />
              </span>
            )}
          </button>
          {showChanges && <InboxChangesBadge threadId={thread.id} />}
          <button
            type="button"
            data-testid={`inbox-thread-park-${thread.id}`}
            aria-label={parkLabel}
            title={parkLabel}
            onClick={() => void setArchived(thread.id, !thread.archived)}
            className={cn(
              'absolute right-1.5 top-1.5 flex h-5 items-center justify-center gap-1 whitespace-nowrap rounded px-1.5 text-[11px] text-fg-muted opacity-0 transition-opacity hover:text-fg group-focus-within:opacity-100 group-hover:opacity-100',
              selected ? 'hover:bg-hover focus-visible:bg-hover' : 'hover:bg-active focus-visible:bg-active',
            )}
          >
            <ParkIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span>{parkLabel}</span>
          </button>
          {inboxCueActive(cueAt) && (
            <span
              key={cueAt}
              aria-hidden="true"
              data-testid={`inbox-thread-cue-${thread.id}`}
              className="inbox-cue pointer-events-none absolute inset-0 rounded"
            />
          )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
          {!multiSelected && <>
          <ContextMenuItem disabled={savingName} onSelect={rename.start}>
            <PenLine aria-hidden="true" className="h-3.5 w-3.5" />
            Rename thread
          </ContextMenuItem>
          <ContextMenuItem disabled={!thread.customTitle || savingName} onSelect={() => void rename.save(null)}>
            <X aria-hidden="true" className="h-3.5 w-3.5" />
            Clear custom name
          </ContextMenuItem>
          <ContextMenuSeparator />
          </>}
          <ContextMenuItem disabled={multiSelected && bulkPending} onSelect={() => multiSelected ? onBulk('pin', !thread.pinned) : void setPinned(thread.id, !thread.pinned)}>
            <PinIcon aria-hidden="true" className="h-3.5 w-3.5" />
            {pinLabel}
          </ContextMenuItem>
          <ContextMenuItem disabled={multiSelected && bulkPending} onSelect={() => multiSelected ? onBulk('read', unread) : void setRead(thread.id, unread)}>
            {unread ? <MailOpen className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
            {unread ? 'Mark as read' : 'Mark as unread'}
          </ContextMenuItem>
          <ContextMenuItem disabled={multiSelected && bulkPending} onSelect={() => multiSelected ? onBulk('park', !thread.archived) : void setArchived(thread.id, !thread.archived)}>
            <ParkIcon aria-hidden="true" className="h-3.5 w-3.5" />
            {parkLabel}
          </ContextMenuItem>
          {!multiSelected && <>
          <ContextMenuItem disabled={forking} onSelect={onFork}>
            <GitFork className="h-3.5 w-3.5" />
            Fork thread
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem destructive onSelect={() => setConfirmingRemove(true)}>
            <Trash2 className="h-3.5 w-3.5" />
            Delete from Inbox
          </ContextMenuItem>
          </>}
        </ContextMenuContent>
      </ContextMenu>

      {nameError && !renaming && <p role="alert" className="px-2 text-xs text-danger">{nameError}</p>}
      <ThreadRenameDialog thread={thread} rename={rename} />
      <AlertDialog
        open={confirmingRemove}
        onOpenChange={(open) => {
          setConfirmingRemove(open)
          if (!open) {
            setAlsoRemoveWorktree(false)
            setRemoveError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Delete “{thread.customTitle ?? thread.title}” from the Inbox?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the thread and any unsent draft from MDE’s Inbox. The OpenCode conversation is kept, and
            later activity will not restore it to the Inbox.
          </AlertDialogDescription>
          {ownsWorktree && (
            <label className="mt-3 flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                data-testid="inbox-remove-worktree"
                className="mt-0.5"
                checked={alsoRemoveWorktree}
                disabled={removing}
                onChange={(event) => setAlsoRemoveWorktree(event.target.checked)}
              />
              <span>
                <span className="text-fg">Also remove the worktree</span>
                <span className="block text-fg-muted">
                  Deletes the checkout folder. Git refuses while it has uncommitted changes. The branch{' '}
                  {thread.worktree?.branch} is kept.
                </span>
              </span>
            </label>
          )}
          {removeError && <p role="alert" className="mt-3 text-xs text-danger">{removeError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              onClick={(event) => {
                // Stay open until Git has answered, so a refusal can be shown and tried again.
                event.preventDefault()
                setRemoving(true)
                setRemoveError(null)
                const removeWorktree = alsoRemoveWorktree && ownsWorktree
                removeThread(thread.id, removeWorktree ? { removeWorktree: true } : undefined)
                  .then(() => {
                    setConfirmingRemove(false)
                    // The worktree's entry in the folder chooser went with it.
                    if (removeWorktree) void reloadFolders()
                  })
                  .catch((reason) => setRemoveError(ipcErrorMessage(reason, 'Could not delete the thread.')))
                  .finally(() => setRemoving(false))
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * `workingShown`: the Working section has the threads that are working, so the list does not. `project` is the name
 * of the project the Inbox is narrowed to, if it is.
 */
function emptyMessage(filter: InboxFilter, query: string, workingShown: boolean, project?: string): string {
  const where = project ? ` in ${project}` : ''
  if (query.trim()) return project ? `No threads in ${project} match your search.` : 'No threads match your search.'
  if (filter === 'unread') return `No unread threads${where}.`
  if (filter === 'archived') return `No parked threads${where}.`
  if (workingShown) return `No other threads${where}.`
  return project ? `No threads in ${project} yet.` : 'No threads yet.'
}

/**
 * Unpinned threads that are working, in a section under the list that folds up to its header. They are
 * here and not in the list, and go back to the list when they stop. The filter tabs do not apply,
 * so a glance tells what is running; the search does, since this is the only place to find them by it.
 */
function InboxWorkingSection({
  threads,
  searching,
  project,
  selectedId,
  selectedIds,
  bulkPending,
  onBulk,
  now,
  forking,
  onSelect,
  onFork
}: {
  threads: InboxThread[]
  /** A search is narrowing the threads. */
  searching: boolean
  /** The name of the project the Inbox is narrowed to, if it is. */
  project?: string
  selectedId: string | null
  selectedIds: Set<string>
  bulkPending: boolean
  onBulk: (action: BulkAction, value: boolean) => void
  now: number
  forking: boolean
  onSelect: (thread: InboxThread, event: MouseEvent<HTMLButtonElement>) => void
  onFork: (thread: InboxThread) => void
}): JSX.Element {
  const collapsed = useInboxView((state) => state.workingCollapsed)
  const setCollapsed = useInboxView((state) => state.setWorkingCollapsed)
  const Chevron = collapsed ? ChevronRight : ChevronDown
  return (
    <section
      data-testid="inbox-working-section"
      aria-label="Working threads"
      // A direct child of the panel, so the percentage is of the panel; the list above keeps its own minimum.
      className="flex max-h-[45%] min-h-0 shrink flex-col border-t border-line pt-1"
    >
      <button
        type="button"
        data-testid="inbox-working-toggle"
        aria-expanded={!collapsed}
        aria-controls="inbox-working-list"
        onClick={() => setCollapsed(!collapsed)}
        className="flex h-6 w-full shrink-0 items-center gap-1 rounded px-1 text-left text-[11px] font-medium uppercase tracking-wide text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
      >
        <Chevron aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span>Working</span>
        <span
          data-testid="inbox-working-count"
          className="rounded bg-elevated px-1.5 py-px text-[10px] font-medium normal-case tracking-normal text-fg-muted"
        >
          {threads.length}
        </span>
      </button>
      {!collapsed && (
        <div
          id="inbox-working-list"
          data-testid="inbox-working-list"
          className="mt-0.5 min-h-0 flex-1 overflow-y-auto"
        >
          {threads.length === 0 ? (
            <p className="px-2 py-1 text-xs text-fg-subtle">
              {searching
                ? 'No working threads match your search.'
                : project ? `No threads are working in ${project}.` : 'No threads are working.'}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {threads.map((thread) => (
                <InboxThreadRow
                  key={thread.id}
                  thread={thread}
                  selected={thread.id === selectedId}
                  multiSelected={selectedIds.has(thread.id)}
                  bulkPending={bulkPending}
                  onBulk={onBulk}
                  now={now}
                  forking={forking}
                  onSelect={(event) => onSelect(thread, event)}
                  onFork={() => onFork(thread)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** The Inbox tab of the sidebar: pinned threads first, then most recent activity. */
export function InboxPanel(): JSX.Element {
  const threads = useWorkspace((state) => state.inboxThreads)
  useEffect(() => useInboxChanges.getState().prune(threads.map((thread) => thread.id)), [threads])
  const selectedId = useWorkspace((state) => state.selectedInboxThreadId)
  const selectThread = useWorkspace((state) => state.selectInboxThread)
  const lock = useInboxLock()
  const now = useInboxClock()
  const forkThread = useInboxChat((state) => state.forkThread)
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [query, setQuery] = useState('')
  const [threadListHovered, setThreadListHovered] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkPending, setBulkPending] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  // A fork is a request to the service and can fail; the menu has no place to say so.
  const [fork, setFork] = useState<{ pending: boolean; error: string | null }>({ pending: false, error: null })
  const folders = useInboxChat((state) => state.folders)
  const foldersLoaded = useInboxChat((state) => state.foldersLoaded)
  const projectId = useInboxView((state) => state.projectFilter)
  const setProjectFilter = useInboxView((state) => state.setProjectFilter)
  // The project the Inbox is narrowed to. One that has since been removed narrows nothing, and is forgotten once the list is known.
  const project = (projectId && inboxProjects(folders).find((folder) => folder.id === projectId)) || null
  useEffect(() => {
    if (projectId && foldersLoaded && !project) setProjectFilter(null)
  }, [projectId, foldersLoaded, project, setProjectFilter])
  const drafts = useInboxDrafts((state) => state.drafts)
  const page = useInboxDrafts((state) => state.page)
  const loadDrafts = useInboxDrafts((state) => state.load)
  const openDraft = useInboxDrafts((state) => state.open)
  const startFresh = useInboxDrafts((state) => state.startFresh)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        lock || useWorkspace.getState().activeWorkspaceView !== 'inbox' || event.defaultPrevented ||
        event.isComposing || event.repeat || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey ||
        event.key.toLowerCase() !== 'n' || document.querySelector('[role="dialog"], [role="alertdialog"]')
      ) return
      event.preventDefault()
      event.stopPropagation()
      if (selectedId === null) void startFresh()
      else selectThread(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [lock, selectedId, selectThread, startFresh])
  // Read when the panel opens and whenever another thread is opened: the one left may have unsent text in its box.
  useEffect(() => {
    void loadDrafts()
  }, [loadDrafts, selectedId])
  // A new thread being written for the first time is not listed until its page is left; one taken from the list stays in it.
  const onNewThread = selectedId === null && !page.opened
  const projectDrafts = draftsInProject(drafts, project, folders)
  const listedDrafts = visibleDrafts(projectDrafts, onNewThread ? page.id : null, folders)
  const shownDrafts = query.trim() ? visibleDrafts(projectDrafts, onNewThread ? page.id : null, folders, query) : listedDrafts
  const showWorking = useInboxView((state) => state.workingSection)
  // With the section on, unpinned working threads move into it; pinned ones stay in the list.
  const projectThreads = inboxThreadsInProject(threads, project, folders)
  const visible = visibleInboxThreads(projectThreads, filter, query, showWorking)
  const working = showWorking ? workingInboxThreads(projectThreads, query) : []
  const selectedThreads = threads.filter((thread) => selectedIds.has(thread.id))
  const clearSelection = (): void => { setSelectedIds(new Set()); setBulkError(null) }
  const selectRow = (thread: InboxThread, event: MouseEvent<HTMLButtonElement>): void => {
    if (bulkPending) return
    if (event.ctrlKey || event.metaKey) {
      setSelectedIds((previous) => {
        const next = new Set(previous)
        if (previous.size === 0 && selectedId && selectedId !== thread.id && [...visible, ...working].some((item) => item.id === selectedId)) next.add(selectedId)
        if (next.has(thread.id)) next.delete(thread.id)
        else next.add(thread.id)
        return next
      })
      setBulkError(null)
    } else {
      clearSelection()
      selectThread(thread.id)
    }
  }
  const runBulk = async (action: BulkAction, value: boolean): Promise<void> => {
    setBulkPending(true)
    setBulkError(null)
    const workspace = useWorkspace.getState()
    const results = await Promise.allSettled(selectedThreads.map((thread) => (
      action === 'pin' ? workspace.setInboxThreadPinned(thread.id, value)
        : action === 'read' ? workspace.setInboxThreadRead(thread.id, value)
          : workspace.setInboxThreadArchived(thread.id, value)
    )))
    const failed = selectedThreads.filter((_, index) => results[index]?.status === 'rejected')
    setSelectedIds(new Set(failed.map((thread) => thread.id)))
    if (failed.length) setBulkError(`Could not update ${failed.length} ${failed.length === 1 ? 'thread' : 'threads'}. Try again.`)
    setBulkPending(false)
  }
  const workingShown = showWorking && projectThreads.some((thread) => !thread.pinned && inboxThreadWorking(thread))
  const projectSummaries = inboxProjectSummaries(threads, folders)
  const startFork = (thread: InboxThread): void => {
    if (fork.pending) return
    setFork({ pending: true, error: null })
    forkThread(thread.id).then(
      () => setFork({ pending: false, error: null }),
      (error: unknown) => setFork({ pending: false, error: ipcErrorMessage(error, 'Could not fork the thread.') })
    )
  }

  if (lock) return <InboxLockedNotice compact />

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <InboxToolbar
        newThreadActive={onNewThread}
        // From a thread this opens the blank page; on the page itself it sets aside what is typed there.
        onNewThread={() => (selectedId === null ? void startFresh() : selectThread(null))}
        query={query}
        onQueryChange={(value) => { clearSelection(); setQuery(value) }}
        searchOpen={searchOpen}
        onSearchOpenChange={setSearchOpen}
        searchRef={searchRef}
        filter={filter}
        onFilterChange={(value) => { clearSelection(); setFilter(value) }}
        summaries={projectSummaries}
        project={project}
        total={threads.filter((thread) => !thread.archived).length}
        unread={countUnreadInboxThreads(threads)}
        onProjectChange={(value) => { clearSelection(); setProjectFilter(value) }}
      />
      {bulkError && <p role="alert" className="px-2 text-xs text-danger">{bulkError}</p>}
      {fork.pending && (
        <p role="status" data-testid="inbox-fork-status" className="mx-1 flex items-center gap-1.5 rounded bg-elevated px-2 py-1 text-[11px] text-fg-muted">
          <LoaderCircle aria-hidden="true" className="h-3 w-3 shrink-0 animate-spin text-accent motion-reduce:animate-none" />
          Forking thread…
        </p>
      )}
      {fork.error && (
        <div role="alert" data-testid="inbox-fork-error" className="mx-1 flex items-start gap-1.5 rounded bg-danger/10 px-2 py-1 text-[11px] text-danger">
          <span className="min-w-0 flex-1 break-words">{fork.error}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setFork({ pending: false, error: null })}
            className="mt-px shrink-0 rounded text-danger/80 hover:text-danger"
          >
            <X aria-hidden="true" className="h-3 w-3" />
          </button>
        </div>
      )}
      <div
        className={cn('inbox-thread-list min-h-16 flex-1 overflow-y-auto', threadListHovered && 'inbox-thread-list-hovered')}
        data-testid="inbox-thread-list"
        onPointerEnter={() => setThreadListHovered(true)}
        onPointerLeave={() => setThreadListHovered(false)}
      >
        {visible.length === 0 ? (
          <div className="px-2 py-1 text-xs text-fg-subtle">
            <p>{emptyMessage(filter, query, workingShown, project?.name)}</p>
            {projectThreads.length === 0 && (
              <p className="mt-1">
                Start one with New thread.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {visible.map((thread) => (
              <InboxThreadRow
                key={thread.id}
                thread={thread}
                selected={thread.id === selectedId}
                multiSelected={selectedIds.has(thread.id)}
                bulkPending={bulkPending}
                onBulk={(action, value) => void runBulk(action, value)}
                now={now}
                forking={fork.pending}
                onSelect={(event) => selectRow(thread, event)}
                onFork={() => startFork(thread)}
              />
            ))}
          </div>
        )}
      </div>
      {listedDrafts.length > 0 && (
        <InboxDraftsSection
          drafts={shownDrafts}
          folders={folders}
          searching={query.trim() !== ''}
          selectedId={selectedId === null && page.opened ? page.id : null}
          now={now}
          onOpen={openDraft}
        />
      )}
      {showWorking && (
        <InboxWorkingSection
          threads={working}
          searching={query.trim() !== ''}
          project={project?.name}
          selectedId={selectedId}
          selectedIds={selectedIds}
          bulkPending={bulkPending}
          onBulk={(action, value) => void runBulk(action, value)}
          now={now}
          forking={fork.pending}
          onSelect={selectRow}
          onFork={startFork}
        />
      )}
    </div>
  )
}
