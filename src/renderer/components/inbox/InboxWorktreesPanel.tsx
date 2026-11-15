import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, FolderGit2, GitBranch, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react'
import type { InboxThread, InboxWorktreeEntry } from '@shared/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { OpenFolderMenu } from '@/components/OpenFolderButtons'
import { ProjectIcon } from '@/components/inbox/ProjectIcon'
import { StatusMark, statusGlyph } from '@/components/inbox/StatusMark'
import { inboxStatusChip } from '@/lib/inbox'
import {
  groupWorktrees,
  worktreeAge,
  worktreeCreatedAt,
  worktreeDeletion,
  worktreeKey,
  worktreeThreads,
} from '@/lib/inbox-worktrees'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { threadDisplayTitle } from '@/lib/toasts'
import { cn } from '@/lib/utils'
import { useInboxChat } from '@/store/inbox-chat'
import { useWorkspace } from '@/store/workspace'

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/** What is in a worktree now, in a word or two, the thing to know before deleting it first. */
function WorktreeState({ entry }: { entry: InboxWorktreeEntry }): JSX.Element {
  if (entry.missing) {
    return <span data-testid="inbox-worktree-state" data-state="missing" className="text-danger">Missing on disk</span>
  }
  const parts: JSX.Element[] = []
  if (entry.changes !== null && entry.changes > 0) {
    parts.push(<span key="changes" className="text-warn">● {plural(entry.changes, 'changed file')}</span>)
  } else if (entry.changes === 0) {
    parts.push(<span key="clean" className="text-ok">✓ clean</span>)
  }
  if (entry.unmerged !== null && entry.unmerged > 0) {
    parts.push(<span key="unmerged" className="text-fg-muted">{plural(entry.unmerged, 'unmerged commit')}</span>)
  }
  return (
    <span
      data-testid="inbox-worktree-state"
      data-state={entry.changes ? 'changed' : entry.changes === 0 ? 'clean' : 'unknown'}
      className="flex shrink-0 items-center gap-2 tabular-nums"
    >
      {parts.length > 0 ? parts : <span className="text-fg-subtle">Unknown</span>}
    </span>
  )
}

function ThreadLine({ thread, onOpen }: { thread: InboxThread; onOpen: () => void }): JSX.Element {
  const chip = inboxStatusChip(thread)
  return (
    <li>
      <button
        type="button"
        data-testid="inbox-worktree-thread"
        onClick={onOpen}
        title="Open the thread"
        className="flex w-full min-w-0 items-center gap-2 rounded px-1.5 py-0.5 text-left text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
      >
        <span aria-hidden className="shrink-0 text-fg-subtle">↳</span>
        <span className="min-w-0 flex-1 truncate">{threadDisplayTitle(thread)}</span>
        {chip && <StatusMark tone={chip.tone} glyph={statusGlyph(thread.status)} className="shrink-0">{chip.label}</StatusMark>}
      </button>
    </li>
  )
}

function WorktreeRow({
  entry,
  threads,
  selected,
  focused,
  onSelect,
  onOpenThread,
  onDelete,
}: {
  entry: InboxWorktreeEntry
  threads: InboxThread[]
  selected: boolean
  focused: boolean
  onSelect: (selected: boolean) => void
  onOpenThread: (id: string) => void
  onDelete: () => void
}): JSX.Element {
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [focused])
  const createdAt = worktreeCreatedAt(entry, threads)
  const opener = threads[0]
  const label = entry.branch ?? 'detached HEAD'
  return (
    <li
      ref={ref}
      data-testid="inbox-worktree-row"
      data-focused={focused ? '' : undefined}
      className={cn(
        'flex flex-col gap-0.5 rounded-md border border-line bg-panel/40 py-1.5 pl-2.5 pr-1.5',
        focused && 'border-accent/70 ring-1 ring-accent/40',
        selected && 'bg-hover/60',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <input
          type="checkbox"
          data-testid="inbox-worktree-select"
          aria-label={`Select ${label}`}
          checked={selected}
          onChange={(event) => onSelect(event.target.checked)}
          className="h-3.5 w-3.5 shrink-0"
        />
        <GitBranch aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
        <span className="min-w-0 flex-1 truncate">
          <span data-testid="inbox-worktree-branch" className="inbox-code-font text-[12.5px] text-fg" title={entry.root}>{label}</span>
          <span className="text-[11.5px] text-fg-subtle">
            {entry.base && ` from ${entry.base}`}
            {createdAt !== undefined && ` · ${worktreeAge(createdAt)}`}
          </span>
        </span>
        <span className="text-[11.5px]"><WorktreeState entry={entry} /></span>
        <span className="flex shrink-0 items-center">
          {/* Folders are opened by thread, so main resolves the path; a worktree no thread uses has none to open by. */}
          {opener && !entry.missing && (
            <OpenFolderMenu target={{ inboxId: opener.id }} kind={entry.target.kind} distro={entry.target.kind === 'wsl' ? entry.target.distro : undefined} />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-testid="inbox-worktree-delete"
            aria-label={`Delete ${label}`}
            title="Delete worktree…"
            onClick={onDelete}
            className="text-fg-muted hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </span>
      </div>
      {threads.length > 0 ? (
        <ul className="flex flex-col pl-5 pr-1">
          {threads.map((thread) => <ThreadLine key={thread.id} thread={thread} onOpen={() => onOpenThread(thread.id)} />)}
        </ul>
      ) : (
        <p className="pl-[2.6rem] pb-0.5 text-[11.5px] text-fg-subtle">No threads use it.</p>
      )}
    </li>
  )
}

/** Asks before deleting worktrees, naming what goes with them, and deletes them one after another. */
function DeleteWorktrees({
  entries,
  threads,
  onClose,
  onDone,
}: {
  entries: InboxWorktreeEntry[]
  threads: InboxThread[]
  onClose: () => void
  onDone: () => void
}): JSX.Element {
  const [deleteBranches, setDeleteBranches] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const summary = worktreeDeletion(entries, threads)
  const single = entries.length === 1 ? entries[0] : undefined
  const blocked = summary.running.length > 0

  const run = async (): Promise<void> => {
    setBusy(true)
    setErrors([])
    const failed: string[] = []
    for (const entry of entries) {
      try {
        const result = await window.api.inbox.removeWorktree({
          target: entry.target,
          root: entry.root,
          // Only what the person was warned about is thrown away; Git refuses anything it finds besides.
          ...(entry.changes ? { force: true } : {}),
          ...(deleteBranches && entry.branch ? { deleteBranch: true } : {}),
        })
        if (result.branchError) failed.push(result.branchError)
      } catch (reason) {
        failed.push(`${entry.branch ?? entry.root}: ${ipcErrorMessage(reason, 'Could not delete the worktree.')}`)
      }
    }
    setBusy(false)
    onDone()
    if (failed.length > 0) setErrors(failed)
    else onClose()
  }

  return (
    <AlertDialog open onOpenChange={(next) => { if (!next && !busy) onClose() }}>
      <AlertDialogContent data-testid="inbox-worktree-delete-dialog">
        <AlertDialogTitle>
          {single ? <>Delete worktree <span className="inbox-code-font">{single.branch ?? 'detached HEAD'}</span>?</> : `Delete ${entries.length} worktrees?`}
        </AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="flex flex-col gap-2.5 text-[13px]">
            {summary.threads.length > 0 ? (
              <div>
                <p>{summary.threads.length === 1 ? 'Its thread is kept to read, but cannot continue:' : `These ${summary.threads.length} threads are kept to read, but cannot continue:`}</p>
                <ul data-testid="inbox-worktree-delete-threads" className="mt-1 flex max-h-40 flex-col gap-0.5 overflow-y-auto">
                  {summary.threads.map((thread) => {
                    const running = summary.running.includes(thread)
                    return (
                      <li key={thread.id} className="flex min-w-0 items-center gap-2 text-fg">
                        <span aria-hidden className="text-fg-subtle">•</span>
                        <span className="min-w-0 flex-1 truncate">{threadDisplayTitle(thread)}</span>
                        {running && <span className="shrink-0 text-[11.5px] text-danger">still running, stop it first</span>}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : (
              <p>No thread uses {single ? 'it' : 'them'}.</p>
            )}
            {summary.changes > 0 && (
              <p data-testid="inbox-worktree-delete-changes" className="flex items-start gap-1.5 text-warn">
                <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {plural(summary.changes, 'file')} with uncommitted changes will be lost.
              </p>
            )}
            {summary.branches.length > 0 && (
              <label className="flex cursor-pointer items-start gap-2 text-fg">
                <input
                  type="checkbox"
                  data-testid="inbox-worktree-delete-branch"
                  className="mt-0.5 h-3.5 w-3.5"
                  checked={deleteBranches}
                  onChange={(event) => setDeleteBranches(event.target.checked)}
                />
                <span>
                  {single ? <>Also delete the branch <span className="inbox-code-font">{summary.branches[0]}</span></> : 'Also delete their branches'}
                  <span className="block text-[11.5px] text-fg-subtle">
                    {summary.unmerged > 0
                      ? `${plural(summary.unmerged, 'commit')} no other branch has would be lost.`
                      : summary.unmergedKnown
                        ? `Every commit on ${summary.branches.length === 1 ? 'it' : 'them'} is on another branch too.`
                        : 'MDE could not check for commits no other branch has.'}
                    {' '}Otherwise {summary.branches.length === 1 ? 'the branch is' : 'the branches are'} kept.
                  </span>
                </span>
              </label>
            )}
          </div>
        </AlertDialogDescription>
        {errors.length > 0 && (
          <ul role="alert" data-testid="inbox-worktree-delete-error" className="mt-3 flex flex-col gap-1 text-xs text-danger">
            {errors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{errors.length > 0 ? 'Close' : 'Cancel'}</AlertDialogCancel>
          {errors.length === 0 && (
            <AlertDialogAction
              data-testid="inbox-worktree-delete-confirm"
              disabled={busy || blocked}
              onClick={(event) => {
                // Stay open until they are gone, so a failure can be shown.
                event.preventDefault()
                void run()
              }}
            >
              {busy && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
              {summary.threads.length > 0 ? `Delete and keep ${plural(summary.threads.length, 'thread')} read-only` : 'Delete'}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * The worktree manager: every worktree MDE made, by project, with what is in it and the threads that run in it.
 * One or several can be deleted; their threads stay, to be read only.
 */
export function InboxWorktreesPanel({
  focus,
  onClose,
}: {
  /** The worktree to show first and mark, by `worktreeKey`. */
  focus?: string
  onClose: () => void
}): JSX.Element {
  const folders = useInboxChat((state) => state.folders)
  const reloadFolders = useInboxChat((state) => state.reloadFolders)
  const threads = useWorkspace((state) => state.inboxThreads)
  const selectThread = useWorkspace((state) => state.selectInboxThread)
  const [entries, setEntries] = useState<InboxWorktreeEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [deleting, setDeleting] = useState<InboxWorktreeEntry[] | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const next = await window.api.inbox.worktrees()
      setEntries(next)
      // What is gone cannot stay selected.
      setSelected((current) => new Set([...current].filter((key) => next.some((entry) => worktreeKey(entry) === key))))
    } catch (reason) {
      setError(ipcErrorMessage(reason, 'Could not list the worktrees.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const groups = useMemo(() => groupWorktrees(entries ?? [], folders, threads), [entries, folders, threads])
  const unused = useMemo(() => (entries ?? []).filter((entry) => worktreeThreads(entry, threads).length === 0), [entries, threads])
  const chosen = (entries ?? []).filter((entry) => selected.has(worktreeKey(entry)))

  const openThread = (id: string): void => {
    selectThread(id)
    onClose()
  }

  return (
    <>
      <div className="mb-2 flex items-center gap-2 text-[11.5px] text-fg-subtle">
        <span className="min-w-0 flex-1">
          {entries === null ? 'Looking for worktrees…' : entries.length === 0 ? '' : `${plural(entries.length, 'worktree')} in ~/.mde/worktrees`}
        </span>
        <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-fg-subtle" onClick={() => void load()} disabled={loading} title="Look again">
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin motion-reduce:animate-none')} />
        </Button>
      </div>
      {error && <p role="alert" className="mb-2 text-xs text-danger">{error}</p>}
      {entries !== null && entries.length === 0 && !error && (
        <p data-testid="inbox-worktrees-empty" className="rounded-md border border-dashed border-line px-3 py-6 text-center text-[13px] text-fg-muted">
          No worktrees. Start a thread in “New worktree” mode to get one.
        </p>
      )}
      {groups.length > 0 && (
        <div data-testid="inbox-worktree-list" className="-mx-1 flex max-h-[min(28rem,55vh)] flex-col gap-3 overflow-y-auto px-1">
          {groups.map((group) => (
            <section key={group.project?.id ?? group.name} aria-label={group.name} className="flex flex-col gap-1.5">
              <h3 className="flex items-center gap-1.5 text-[12px] font-medium text-fg-muted">
                {group.project ? <ProjectIcon icon={group.project.icon} size="sm" /> : <FolderGit2 aria-hidden className="h-3.5 w-3.5" />}
                {group.name}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {group.worktrees.map((entry) => {
                  const key = worktreeKey(entry)
                  return (
                    <WorktreeRow
                      key={key}
                      entry={entry}
                      threads={worktreeThreads(entry, threads)}
                      selected={selected.has(key)}
                      focused={focus === key}
                      onSelect={(on) => setSelected((current) => {
                        const next = new Set(current)
                        if (on) next.add(key)
                        else next.delete(key)
                        return next
                      })}
                      onOpenThread={openThread}
                      onDelete={() => setDeleting([entry])}
                    />
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      <DialogFooter className="items-center sm:justify-between">
        {/* Only when there is something to select; an empty spot keeps the other buttons on the right. */}
        {unused.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="inbox-worktrees-select-unused"
            onClick={() => setSelected(new Set(unused.map(worktreeKey)))}
            className="text-fg-muted"
          >
            Select {unused.length === 1 ? 'the one' : `the ${unused.length}`} with no threads
          </Button>
        ) : <span />}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
          <Button
            type="button"
            data-testid="inbox-worktrees-delete-selected"
            disabled={chosen.length === 0}
            onClick={() => setDeleting(chosen)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {chosen.length > 0 ? `Delete ${plural(chosen.length, 'worktree')}` : 'Delete selected'}
          </Button>
        </div>
      </DialogFooter>
      {deleting && (
        <DeleteWorktrees
          entries={deleting}
          threads={threads}
          onClose={() => setDeleting(null)}
          onDone={() => {
            void load()
            void reloadFolders()
          }}
        />
      )}
    </>
  )
}
