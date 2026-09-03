import { AlertCircle, ArrowLeftRight, GitBranch, LoaderCircle } from 'lucide-react'
import type {
  GitLocalBranchSnapshot,
  GitRemoteBranchSnapshot,
  GitRepositorySnapshot,
  GitWorktreeSnapshot
} from '@shared/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'

const GIT_LANE_COUNT = 4

export interface GitSessionDefaults {
  projectId?: string
  kind: 'wsl'
  distro: string
  path: string
  name: string
}

export interface GitLaneViewProps {
  onCreateSession?: (defaults: GitSessionDefaults) => void
}

function displayGitPath(path: string): string {
  const homePath = /^\/home\/[^/]+(\/.*)?$/.exec(path)
  return homePath ? `~${homePath[1] ?? ''}` : path
}

function primaryBranch(worktree: GitWorktreeSnapshot): string {
  return worktree.branch ?? worktree.status?.branch ?? 'Detached HEAD'
}

function BranchActionButtons({ branch }: { branch: string }): JSX.Element {
  return (
    <div className="mt-3 flex flex-wrap gap-2 pl-4">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled
        aria-label={`Check out ${branch} here`}
      >
        Check out here
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled
        className="border-accent/40 text-accent disabled:opacity-100"
        aria-label={`Create a worktree for ${branch}`}
      >
        + Worktree
      </Button>
    </div>
  )
}

function worktreeSessionName(worktree: GitWorktreeSnapshot): string {
  if (worktree.branch ?? worktree.status?.branch) return primaryBranch(worktree)
  const pathParts = worktree.path.split(/[\\/]+/).filter(Boolean)
  return pathParts[pathParts.length - 1] ?? 'New session'
}

function WorktreeActionButtons({
  repository,
  worktree,
  defaultProjectId,
  onCreateSession
}: {
  repository: GitRepositorySnapshot
  worktree: GitWorktreeSnapshot
  defaultProjectId?: string
  onCreateSession: (defaults: GitSessionDefaults) => void
}): JSX.Element {
  const branch = primaryBranch(worktree)

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-label={`Create a session for ${branch}`}
        data-testid="git-session-control"
        onClick={() => {
          onCreateSession({
            projectId: defaultProjectId,
            kind: 'wsl',
            distro: repository.distro,
            path: worktree.path,
            name: worktreeSessionName(worktree)
          })
        }}
      >
        Session
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled
        aria-label={`Pull ${branch}`}
        data-testid="git-pull-control"
      >
        Pull
      </Button>
    </div>
  )
}

function PrimaryBranch({
  repository,
  worktree,
  defaultProjectId,
  onCreateSession
}: {
  repository: GitRepositorySnapshot
  worktree: GitWorktreeSnapshot
  defaultProjectId?: string
  onCreateSession: (defaults: GitSessionDefaults) => void
}): JSX.Element {
  const branch = primaryBranch(worktree)
  return (
    <div
      className="shrink-0 border-b border-line px-5 py-5"
      data-testid="git-primary-branch"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="h-3 w-3 shrink-0 rounded-full bg-ok" aria-hidden="true" />
        <span className="min-w-0 truncate text-lg font-semibold text-fg">{branch}</span>
        <span className="shrink-0 rounded border border-line-strong px-1.5 py-0.5 font-mono text-xs uppercase text-accent">
          Primary
        </span>
      </div>
      <div
        className="mt-3 truncate font-mono text-sm text-fg-muted"
        title={worktree.path}
        data-testid="git-primary-path"
      >
        {displayGitPath(worktree.path)}
      </div>
      <WorktreeActionButtons
        repository={repository}
        worktree={worktree}
        defaultProjectId={defaultProjectId}
        onCreateSession={onCreateSession}
      />
    </div>
  )
}

function WorktreeLane({
  repository,
  worktree,
  defaultProjectId,
  onCreateSession
}: {
  repository: GitRepositorySnapshot
  worktree: GitWorktreeSnapshot
  defaultProjectId?: string
  onCreateSession: (defaults: GitSessionDefaults) => void
}): JSX.Element {
  const branch = primaryBranch(worktree)

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-line-strong bg-panel"
      data-testid="git-worktree-lane"
      aria-label={`Git worktree ${branch}`}
    >
      <div className="shrink-0 border-b border-line px-5 py-5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'h-3 w-3 shrink-0 rounded-full',
              worktree.error ? 'bg-danger' : worktree.primary ? 'bg-ok' : 'bg-warn'
            )}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate text-lg font-semibold text-fg">{branch}</span>
        </div>
        <div
          className="mt-3 truncate font-mono text-sm text-fg-muted"
          title={worktree.path}
          data-testid="git-worktree-path"
        >
          {displayGitPath(worktree.path)}
        </div>
        <WorktreeActionButtons
          repository={repository}
          worktree={worktree}
          defaultProjectId={defaultProjectId}
          onCreateSession={onCreateSession}
        />
        {worktree.error && (
          <p className="mt-3 truncate text-xs text-danger" title={worktree.error}>
            {worktree.error}
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1" />
    </section>
  )
}

function BranchSectionHeading({
  label,
  detail,
  count
}: {
  label: string
  detail: string
  count: number
}): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <h3 className="min-w-0 flex-1 text-xs text-fg-muted">
        <span className="font-semibold uppercase tracking-[0.18em] text-fg">{label}</span>
        <span> {detail}</span>
      </h3>
      <span className="shrink-0 text-xs text-fg-muted">{count}</span>
    </div>
  )
}

function LocalBranchRow({
  branch,
  checkedOutAs
}: {
  branch: GitLocalBranchSnapshot
  checkedOutAs: 'PRIMARY' | 'WORKTREE' | undefined
}): JSX.Element {
  return (
    <article
      className="rounded-lg bg-elevated/40 px-4 py-3"
      data-testid="git-local-branch-row"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 text-fg-subtle" aria-hidden="true">•</span>
        <span className="min-w-0 flex-1 truncate text-sm text-fg">{branch.name}</span>
        {checkedOutAs && (
          <span
            className={cn(
              'shrink-0 rounded border border-line-strong px-1.5 py-0.5 font-mono text-[10px] uppercase',
              checkedOutAs === 'PRIMARY' ? 'text-accent' : 'text-fg-muted'
            )}
          >
            {checkedOutAs}
          </span>
        )}
      </div>
      {branch.upstream ? (
        <div className="mt-2 flex min-w-0 items-center gap-2 pl-4 font-mono text-xs text-fg-subtle">
          <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{branch.upstream}</span>
        </div>
      ) : (
        <div className="mt-2 pl-4 font-mono text-xs text-warn">no upstream</div>
      )}
      <BranchActionButtons branch={branch.name} />
    </article>
  )
}

function RemoteBranchRow({ branch }: { branch: GitRemoteBranchSnapshot }): JSX.Element {
  return (
    <article
      className="rounded-lg bg-elevated/40 px-4 py-3"
      data-testid="git-remote-branch-row"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 text-fg-subtle" aria-hidden="true">▪</span>
        <span className="min-w-0 truncate font-mono text-sm text-fg">{branch.name}</span>
      </div>
      <BranchActionButtons branch={branch.name} />
    </article>
  )
}

function RemoteBranchGroup({
  remote,
  branches
}: {
  remote: string
  branches: GitRemoteBranchSnapshot[]
}): JSX.Element {
  return (
    <section className="mt-6" data-testid="git-remote-branch-group">
      <BranchSectionHeading
        label="REMOTE"
        detail={`· ${remote.toUpperCase()} · no local branch yet`}
        count={branches.length}
      />
      <div className="mt-3 space-y-2">
        {branches.map((branch) => (
          <RemoteBranchRow key={branch.name} branch={branch} />
        ))}
      </div>
    </section>
  )
}

function GitBranchLane({
  repository,
  defaultProjectId,
  onCreateSession
}: {
  repository: GitRepositorySnapshot
  defaultProjectId?: string
  onCreateSession: (defaults: GitSessionDefaults) => void
}): JSX.Element {
  const primary = repository.worktrees.find((worktree) => worktree.primary)
  const worktreeBranchKinds = new Map<string, 'PRIMARY' | 'WORKTREE'>()
  repository.worktrees.forEach((worktree) => {
    if (worktree.branch) {
      worktreeBranchKinds.set(worktree.branch, worktree.primary ? 'PRIMARY' : 'WORKTREE')
    }
  })
  const remoteGroups = new Map<string, GitRemoteBranchSnapshot[]>()
  repository.remoteBranches.forEach((branch) => {
    const group = remoteGroups.get(branch.remote) ?? []
    group.push(branch)
    remoteGroups.set(branch.remote, group)
  })
  const branchCount = repository.localBranches.length + repository.remoteBranches.length

  if (repository.error) {
    return (
      <section
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-line-strong bg-panel"
        data-testid="git-lane-1"
        aria-label="Git lane 1"
      >
        <div className="m-4 flex items-start gap-2 rounded border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{repository.error}</span>
        </div>
      </section>
    )
  }

  if (!primary) {
    return (
      <section
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-line-strong bg-panel"
        data-testid="git-lane-1"
        aria-label="Git lane 1"
      >
        <p className="m-4 text-xs text-fg-subtle">No primary worktree found.</p>
      </section>
    )
  }

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-line-strong bg-panel"
      data-testid="git-lane-1"
      aria-label="Git lane 1"
    >
      <PrimaryBranch
        repository={repository}
        worktree={primary}
        defaultProjectId={defaultProjectId}
        onCreateSession={onCreateSession}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <section data-testid="git-branches">
          <div className="flex items-center gap-3">
            <h2 className="min-w-0 flex-1 text-xs uppercase tracking-[0.2em] text-fg-muted">
              Branches
            </h2>
            <span className="shrink-0 text-xs text-fg-muted">{branchCount}</span>
          </div>

          <section className="mt-5" data-testid="git-local-branches">
            <BranchSectionHeading
              label="LOCAL"
              detail="on this machine"
              count={repository.localBranches.length}
            />
            {repository.localBranches.length > 0 ? (
              <div className="mt-3 space-y-2">
                {repository.localBranches.map((branch) => (
                  <LocalBranchRow
                    key={branch.name}
                    branch={branch}
                    checkedOutAs={worktreeBranchKinds.get(branch.name)}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-fg-subtle">No local branches found.</p>
            )}
          </section>

          {Array.from(remoteGroups.entries()).map(([remote, branches]) => (
            <RemoteBranchGroup key={remote} remote={remote} branches={branches} />
          ))}
        </section>
      </div>
    </section>
  )
}

function EmptyGitLane({ loading }: { loading: boolean }): JSX.Element {
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-line-strong bg-panel"
      data-testid="git-lane-1"
      aria-label="Git lane 1"
    >
      <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
        {loading ? (
          <LoaderCircle className="h-5 w-5 animate-spin text-fg-subtle" aria-hidden="true" />
        ) : (
          <GitBranch className="h-5 w-5 text-fg-subtle" aria-hidden="true" />
        )}
        <p className="text-xs text-fg-subtle">
          {loading ? 'Loading Git repositories…' : 'Add a Git repository from the sidebar.'}
        </p>
      </div>
    </section>
  )
}

function PlaceholderLane({ index }: { index: number }): JSX.Element {
  return (
    <section
      className="h-full min-h-0 min-w-0 rounded-xl border border-line-strong bg-panel"
      data-testid="git-lane-placeholder"
      aria-label={`Git lane ${index} placeholder`}
    />
  )
}

export function GitLaneView({ onCreateSession = () => undefined }: GitLaneViewProps = {}): JSX.Element {
  const repositories = useWorkspace((state) => state.gitRepositories)
  const projects = useWorkspace((state) => state.projects)
  const sessions = useWorkspace((state) => state.sessions)
  const selectedSessionId = useWorkspace((state) => state.selectedSessionId)
  const selectedRepositoryId = useWorkspace((state) => state.selectedGitRepositoryId)
  const loading = useWorkspace((state) => state.gitRepositoriesLoading)
  const selectedRepository = repositories.find(
    (repository) => repository.id === selectedRepositoryId
  ) ?? repositories[0]
  const selectedSession = sessions.find((session) => session.id === selectedSessionId)
  const defaultProjectId = selectedSession?.projectId ?? projects[0]?.id
  const primaryWorktree = selectedRepository?.worktrees.find((worktree) => worktree.primary)
  const additionalWorktrees = selectedRepository?.worktrees.filter(
    (worktree) => worktree !== primaryWorktree
  ) ?? []
  const laneCount = Math.max(GIT_LANE_COUNT, additionalWorktrees.length + 1)
  const minimumLaneWidth = 280
  const laneGap = 20

  return (
    <div className="h-full min-h-0 min-w-0 overflow-x-auto overflow-y-hidden p-3" data-testid="git-lane-view">
      <div
        className="grid h-full min-h-0 min-w-full gap-5"
        data-testid="git-lane-grid"
        style={{
          gridTemplateColumns: `repeat(${laneCount}, minmax(0, 1fr))`,
          ...(laneCount > GIT_LANE_COUNT
            ? { minWidth: `max(100%, ${laneCount * minimumLaneWidth + (laneCount - 1) * laneGap}px)` }
            : {})
        }}
      >
        {selectedRepository ? (
          <GitBranchLane
            repository={selectedRepository}
            defaultProjectId={defaultProjectId}
            onCreateSession={onCreateSession}
          />
        ) : (
          <EmptyGitLane loading={loading} />
        )}
        {additionalWorktrees.map((worktree) => (
          <WorktreeLane
            key={worktree.path}
            repository={selectedRepository!}
            worktree={worktree}
            defaultProjectId={defaultProjectId}
            onCreateSession={onCreateSession}
          />
        ))}
        {Array.from({ length: laneCount - additionalWorktrees.length - 1 }, (_, index) => (
          <PlaceholderLane key={`placeholder-${index}`} index={additionalWorktrees.length + index + 2} />
        ))}
      </div>
    </div>
  )
}
