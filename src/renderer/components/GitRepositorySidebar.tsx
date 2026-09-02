import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  GitBranch,
  LoaderCircle,
  MoreHorizontal,
  RefreshCw,
  Trash2
} from 'lucide-react'
import type { GitRepositorySnapshot, GitWorktreeSnapshot } from '@shared/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { gitStatusChangesLabel, gitStatusSyncLabel } from '@/lib/git'
import { useWorkspace } from '@/store/workspace'

interface GitRepositorySidebarProps {
  active: boolean
  collapsed: boolean
}

function matches(value: string | null | undefined, query: string): boolean {
  return Boolean(value && value.toLocaleLowerCase().includes(query))
}

function worktreeSearchText(worktree: GitWorktreeSnapshot): string {
  return [worktree.path, worktree.branch, worktree.status?.branch, worktree.head]
    .filter(Boolean)
    .join(' ')
}

function visibleWorktrees(
  repository: GitRepositorySnapshot,
  query: string
): GitWorktreeSnapshot[] {
  if (!query) return repository.worktrees
  const repositoryMatches = [repository.name, repository.rootPath, repository.distro]
    .some((value) => matches(value, query))
  return repositoryMatches
    ? repository.worktrees
    : repository.worktrees.filter((worktree) => matches(worktreeSearchText(worktree), query))
}

function worktreeStatus(worktree: GitWorktreeSnapshot): string {
  if (worktree.error) return worktree.error
  if (!worktree.status) return 'Status unavailable'
  const sync = gitStatusSyncLabel(worktree.status)
  return [gitStatusChangesLabel(worktree.status), sync].filter(Boolean).join(' · ')
}

function WorktreeRow({ worktree }: { worktree: GitWorktreeSnapshot }): JSX.Element {
  const branch = worktree.branch ?? 'Detached HEAD'
  const statusClass = worktree.error
    ? 'text-danger'
    : worktree.status && (worktree.status.additions > 0 || worktree.status.deletions > 0)
      ? 'text-warn'
      : 'text-fg-subtle'

  return (
    <div
      role="listitem"
      className={cn(
        'rounded px-2 py-1.5',
        worktree.primary ? 'bg-active/70' : 'hover:bg-hover'
      )}
      title={worktree.path}
      data-testid="git-worktree-row"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            worktree.error ? 'bg-danger' : worktree.primary ? 'bg-ok' : 'bg-warn'
          )}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{branch}</span>
        <span
          className={cn(
            'shrink-0 rounded border border-line-strong px-1 text-[10px] uppercase tracking-wide',
            worktree.primary ? 'text-accent' : 'text-fg-muted'
          )}
        >
          {worktree.primary ? 'Primary' : 'Worktree'}
        </span>
      </div>
      <div className="mt-0.5 truncate pl-3.5 font-mono text-[11px] text-fg-subtle">
        {worktree.path} · <span className={statusClass}>{worktreeStatus(worktree)}</span>
      </div>
    </div>
  )
}

function RepositoryGroup({
  repository,
  query,
  onRemove
}: {
  repository: GitRepositorySnapshot
  query: string
  onRemove: () => void
}): JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const worktrees = useMemo(() => visibleWorktrees(repository, query), [query, repository])
  const countLabel = `${repository.worktrees.length} ${repository.worktrees.length === 1 ? 'worktree' : 'worktrees'}`

  return (
    <section className="border-b border-line py-1" data-testid="git-repository-group">
      <div className="flex min-w-0 items-center gap-1 px-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left hover:bg-hover"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          title={`${repository.distro}: ${repository.rootPath}`}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
          )}
          <span className="min-w-0 truncate text-[13px] font-semibold text-fg">{repository.name}</span>
          <span className="shrink-0 text-[11px] text-fg-subtle">{countLabel}</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-fg-subtle"
              title={`Actions for ${repository.name}`}
              aria-label={`Actions for ${repository.name}`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-danger" onSelect={onRemove}>
              <Trash2 className="h-3.5 w-3.5" />
              Remove repository
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {repository.error && (
        <p className="flex items-start gap-1.5 px-2 py-1 text-xs text-danger">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{repository.error}</span>
        </p>
      )}

      {expanded && (
        <div className="mt-0.5 space-y-0.5 pl-2" role="list">
          {worktrees.length > 0 ? (
            worktrees.map((worktree) => <WorktreeRow key={worktree.path} worktree={worktree} />)
          ) : (
            <p className="px-2 py-1 text-xs text-fg-subtle">
              {query ? 'No matching worktrees.' : 'No worktrees found.'}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

export function GitRepositorySidebar({
  active,
  collapsed
}: GitRepositorySidebarProps): JSX.Element {
  const ready = useWorkspace((state) => state.ready)
  const wslAvailable = useWorkspace((state) => state.wslAvailable)
  const repositories = useWorkspace((state) => state.gitRepositories)
  const loading = useWorkspace((state) => state.gitRepositoriesLoading)
  const error = useWorkspace((state) => state.gitRepositoriesError)
  const refresh = useWorkspace((state) => state.refreshGitRepositories)
  const remove = useWorkspace((state) => state.removeGitRepository)
  const [query, setQuery] = useState('')
  const [removing, setRemoving] = useState<GitRepositorySnapshot | null>(null)

  useEffect(() => {
    if (!active || !ready) return
    void refresh()
    const interval = window.setInterval(() => void refresh(), 10_000)
    const refreshOnFocus = (): void => void refresh()
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [active, ready, refresh])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleRepositories = repositories.filter((repository) => {
    if (!normalizedQuery) return true
    return visibleWorktrees(repository, normalizedQuery).length > 0
  })

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1" data-testid="git-repository-sidebar-collapsed">
        {repositories.map((repository) => (
          <div
            key={repository.id}
            className="flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg"
            title={`${repository.name} · ${repository.worktrees.length} worktrees`}
          >
            <GitBranch className="h-3.5 w-3.5" />
          </div>
        ))}
        {repositories.length === 0 && (
          <GitBranch className="mt-1 h-4 w-4 text-fg-subtle" aria-label="No Git repositories" />
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="git-repository-sidebar">
      <div className="flex items-center gap-1.5 px-1 py-1">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="filter repos or branches…"
          aria-label="Filter repositories or branches"
          className="h-8 font-mono text-[12px]"
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void refresh()}
          disabled={loading}
          title="Refresh Git repositories"
          aria-label="Refresh Git repositories"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      {error && (
        <p className="mx-1 mb-1 flex items-start gap-1.5 rounded border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto" role="list">
        {loading && repositories.length === 0 ? (
          <p className="flex items-center gap-1.5 px-2 py-2 text-xs text-fg-subtle">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Loading repositories…
          </p>
        ) : visibleRepositories.length === 0 ? (
          <p className="px-2 py-2 text-xs text-fg-subtle">
            {repositories.length === 0
              ? wslAvailable
                ? 'Add a WSL repository to get started.'
                : 'WSL is unavailable. Git repositories use WSL for now.'
              : 'No matching repositories or worktrees.'}
          </p>
        ) : (
          visibleRepositories.map((repository) => (
            <RepositoryGroup
              key={repository.id}
              repository={repository}
              query={normalizedQuery}
              onRemove={() => setRemoving(repository)}
            />
          ))
        )}
      </div>

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>Remove “{removing?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the repository from the Git sidebar only. No files, branches, or worktrees
            will be changed.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!removing) return
                void remove(removing.id)
                setRemoving(null)
              }}
            >
              Remove repository
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
