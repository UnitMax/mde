import { useState, type ReactNode } from 'react'
import { Copy, Ellipsis, FolderGit2, GitBranch, GitFork, LoaderCircle, PenLine, RefreshCw } from 'lucide-react'
import type { InboxThread } from '@shared/types'
import { InboxStatusBadge, useInboxClock } from '@/components/InboxPanel'
import { CompactChatToggle } from '@/components/inbox/CompactChatToggle'
import { ProjectIcon } from '@/components/inbox/ProjectIcon'
import { ThreadRenameDialog, useThreadRename } from '@/components/inbox/ThreadRename'
import { OpenFolderMenu } from '@/components/OpenFolderButtons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { inboxFolderLabel, inboxThreadFolder, inboxThreadHome, sessionAge, sessionDate } from '@/lib/inbox'
import { cn } from '@/lib/utils'
import { useInboxChat } from '@/store/inbox-chat'
import { useWorkspace } from '@/store/workspace'

/** One quiet fact about the thread: an icon and a few words, shown while there is room and always in its tooltip. */
function Fact({
  icon,
  title,
  testId,
  className,
  children
}: {
  icon: ReactNode
  title: string
  testId?: string
  className?: string
  children: ReactNode
}): JSX.Element {
  return (
    <span data-testid={testId} title={title} className={cn('flex shrink-0 items-center gap-1', className)}>
      {icon}
      <span className="min-w-0 max-w-[14rem] truncate">{children}</span>
    </span>
  )
}

const ICON = 'h-3.5 w-3.5 shrink-0'

/**
 * Where the thread was forked from, with the one thing worth knowing about forks in its tooltip. A link when the
 * original is still in the Inbox.
 */
function ForkedFrom({ source }: { source: string }): JSX.Element {
  const original = useWorkspace((state) => state.inboxThreads.find((item) => item.id === source))
  const select = useWorkspace((state) => state.selectInboxThread)
  const explanation =
    'This thread works in the same folder as the one it was forked from, so file changes made by either show up in both.'
  const name = original ? (original.customTitle ?? original.title) : null
  const label = name ? `Forked from ${name}` : 'Forked from a thread that is no longer in the Inbox'
  const body = (
    <>
      <GitFork aria-hidden className={ICON} />
      <span className="min-w-0 max-w-[14rem] truncate">{label}</span>
    </>
  )
  const className = '@max-[56rem]/thread:hidden flex shrink-0 items-center gap-1'
  if (!original) {
    return <span data-testid="inbox-forked-from" title={explanation} className={className}>{body}</span>
  }
  return (
    <button
      type="button"
      data-testid="inbox-forked-from"
      onClick={() => select(original.id)}
      title={`Open ${name}. ${explanation}`}
      className={cn(className, 'rounded hover:text-fg')}
    >
      {body}
    </button>
  )
}

/**
 * The open thread's header: one row. The title is the only strong text; the folder, the branch and a fork's origin
 * sit beside it in muted type and drop out, last one first, as the pane narrows. Opening the folder and compact
 * mode are buttons; what is done to the thread itself (new title, rename, fork) is in the menu at the end.
 */
export function ThreadHeader({ thread }: { thread: InboxThread }): JSX.Element {
  const now = useInboxClock()
  const regeneration = useInboxChat((state) => state.titleRegenerations[thread.id])
  const regenerateTitle = useInboxChat((state) => state.regenerateTitle)
  const forkThread = useInboxChat((state) => state.forkThread)
  const project = useInboxChat((state) => inboxThreadFolder(thread, state.folders))
  const rename = useThreadRename(thread)
  const [fork, setFork] = useState<{ pending: boolean; error: string | null }>({ pending: false, error: null })
  const [copyError, setCopyError] = useState(false)

  const title = thread.customTitle ?? thread.title
  const home = inboxThreadHome(thread)
  const wsl = thread.target.kind === 'wsl' ? thread.target.distro : undefined
  const branch = thread.branch ?? thread.worktree?.branch
  const pendingTitle = regeneration?.pending === true
  const error = regeneration?.error ?? fork.error ?? (copyError ? 'Could not copy the folder path.' : null)

  const startFork = (): void => {
    if (fork.pending) return
    setFork({ pending: true, error: null })
    forkThread(thread.id).then(
      () => setFork({ pending: false, error: null }),
      (reason: unknown) => setFork({ pending: false, error: ipcErrorMessage(reason, 'Could not fork the thread.') })
    )
  }
  const copyPath = (): void => {
    setCopyError(false)
    navigator.clipboard.writeText(thread.directory).catch(() => setCopyError(true))
  }

  return (
    <header className="@container/thread shrink-0 border-b border-line px-5" data-testid="inbox-thread-view">
      <div className="flex h-11 min-w-0 items-center gap-3">
        <h2
          className="min-w-0 shrink truncate text-sm font-semibold text-fg"
          title={`${title}\nLast activity ${sessionAge(thread.lastActivityAt, now).toLowerCase()} · ${sessionDate(thread.lastActivityAt)}`}
          onDoubleClick={rename.start}
        >
          {title}
        </h2>
        {pendingTitle && (
          <span role="status" aria-label="Regenerating title" title="Regenerating the title…" className="shrink-0 text-fg-subtle">
            <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          </span>
        )}
        <InboxStatusBadge thread={thread} hideDone />
        {/* With no room left the facts are clipped before the title is shortened, hence the larger shrink factor. */}
        <div className="flex min-w-0 shrink-[4] items-center gap-3 overflow-hidden text-xs text-fg-subtle">
          <Fact
            testId="inbox-thread-folder"
            title={`${thread.directory}${wsl ? ` (${wsl})` : ''}`}
            icon={<ProjectIcon icon={project?.icon} />}
            className="@max-[30rem]/thread:hidden"
          >
            {project?.name ?? inboxFolderLabel(home)}
          </Fact>
          {branch && (
            <Fact
              testId={thread.worktree ? 'inbox-thread-worktree' : 'inbox-thread-branch'}
              title={
                thread.worktree
                  ? `Runs in a worktree of ${thread.worktree.repository}, started from ${thread.worktree.base}: ${thread.directory}`
                  : `Branch ${branch}`
              }
              icon={thread.worktree ? <FolderGit2 aria-hidden className={ICON} /> : <GitBranch aria-hidden className={ICON} />}
              className="@max-[44rem]/thread:hidden"
            >
              {thread.worktree && <span className="sr-only">Worktree </span>}
              {branch}
            </Fact>
          )}
          {thread.forkedFrom && <ForkedFrom source={thread.forkedFrom} />}
        </div>
        <div className="min-w-2 flex-1" />
        <div className="flex shrink-0 items-center gap-0.5">
          <OpenFolderMenu
            target={{ inboxId: thread.id }}
            kind={thread.target.kind}
            distro={wsl}
          />
          {thread.mode !== 'terminal' && <CompactChatToggle />}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Thread actions" title="Thread actions" data-testid="thread-actions">
                <Ellipsis className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={pendingTitle} onSelect={() => void regenerateTitle(thread.id)}>
                <RefreshCw className="h-3.5 w-3.5" />
                Regenerate title
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={rename.start}>
                <PenLine className="h-3.5 w-3.5" />
                Rename thread
              </DropdownMenuItem>
              <DropdownMenuItem disabled={fork.pending} onSelect={startFork}>
                <GitFork className="h-3.5 w-3.5" />
                Fork thread
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={copyPath}>
                <Copy className="h-3.5 w-3.5" />
                Copy folder path
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {error && <p role="alert" className="-mt-1 pb-2 text-xs text-danger">{error}</p>}
      <ThreadRenameDialog thread={thread} rename={rename} />
    </header>
  )
}
