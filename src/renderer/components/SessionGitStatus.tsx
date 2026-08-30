import { CircleAlert, GitBranch } from 'lucide-react'
import type { GitStatusResponse } from '@shared/types'
import type { GitSessionStatus } from '@/store/workspace'
import { cn } from '@/lib/utils'
import {
  formatGitCount,
  gitStatusAccessibleLabel,
  gitStatusBranchLabel
} from '@/lib/git'

interface SessionGitStatusProps {
  status?: GitSessionStatus
  className?: string
}

function changeIndicators(status: GitStatusResponse): JSX.Element | null {
  if (status.additions === 0 && status.deletions === 0 && !(status.commitsAhead && status.commitsAhead > 0)) {
    return null
  }

  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[10px]">
      {status.additions > 0 && (
        <span className="text-ok">+{formatGitCount(status.additions)}</span>
      )}
      {status.deletions > 0 && (
        <span className="text-danger">−{formatGitCount(status.deletions)}</span>
      )}
      {status.commitsAhead !== null && status.commitsAhead > 0 && (
        <span className="text-accent">↑{formatGitCount(status.commitsAhead)}</span>
      )}
    </span>
  )
}

export function SessionGitStatus({ status, className }: SessionGitStatusProps): JSX.Element | null {
  if (status?.error) {
    return (
      <div
        data-testid="session-git-error"
        className={cn('flex min-w-0 items-center gap-1 text-[10px] text-danger', className)}
        aria-label={`Git status error: ${status.error}`}
        title={status.error}
      >
        <CircleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">Git error</span>
      </div>
    )
  }

  const response = status?.response
  if (!response?.repository) return null

  return (
    <div
      data-testid="session-git-status"
      className={cn('flex min-w-0 items-center gap-1.5 text-[11px] leading-tight text-fg-subtle', className)}
      aria-label={gitStatusAccessibleLabel(response)}
      title={gitStatusAccessibleLabel(response)}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <GitBranch className="h-3 w-3 shrink-0 text-accent" aria-hidden="true" />
        <span className="truncate">{gitStatusBranchLabel(response)}</span>
      </span>
      {changeIndicators(response)}
    </div>
  )
}
