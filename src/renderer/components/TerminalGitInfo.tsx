import { useEffect, useState } from 'react'
import { FolderGit2, GitBranch } from 'lucide-react'
import type { GitTerminalInfoResponse } from '@shared/types'
import { useWorkspace } from '@/store/workspace'

const REFRESH_INTERVAL_MS = 10_000

function gitInfoAccessibleLabel(info: GitTerminalInfoResponse): string {
  const values: string[] = []
  if (info.branch) values.push(`Git branch ${info.branch}`)
  if (info.worktree) values.push(`Git worktree ${info.worktree}`)
  return values.join(' · ')
}

export function TerminalGitInfo({ terminalId }: { terminalId: string }): JSX.Element | null {
  const directory = useWorkspace((state) => state.terminalDirectories[terminalId])
  const status = useWorkspace((state) => state.statuses[terminalId] ?? 'none')
  const [info, setInfo] = useState<GitTerminalInfoResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    let requestId = 0

    const refresh = async (): Promise<void> => {
      if (status === 'none') {
        setInfo(null)
        return
      }

      const currentRequest = ++requestId
      try {
        const next = await window.api.git.terminalInfo({ terminalId })
        if (!cancelled && currentRequest === requestId) setInfo(next)
      } catch {
        if (!cancelled && currentRequest === requestId) setInfo(null)
      }
    }

    setInfo(null)
    void refresh()
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    const refreshOnFocus = (): void => void refresh()
    window.addEventListener('focus', refreshOnFocus)

    return () => {
      cancelled = true
      requestId += 1
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [directory, status, terminalId])

  if (!info?.repository || (!info.branch && !info.worktree)) return null

  const accessibleLabel = gitInfoAccessibleLabel(info)
  return (
    <span
      className="flex min-w-0 max-w-[48%] shrink items-center gap-1.5 text-[10px] text-fg-subtle"
      data-testid={`terminal-git-info-${terminalId}`}
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      {info.branch && (
        <span className="flex min-w-0 items-center gap-0.5">
          <GitBranch className="h-3 w-3 shrink-0 text-accent" aria-hidden="true" />
          <span className="truncate">{info.branch}</span>
        </span>
      )}
      {info.worktree && (
        <span className="flex min-w-0 items-center gap-0.5 font-mono">
          <FolderGit2 className="h-3 w-3 shrink-0 text-fg-subtle" aria-hidden="true" />
          <span className="truncate">{info.worktree}</span>
        </span>
      )}
    </span>
  )
}
