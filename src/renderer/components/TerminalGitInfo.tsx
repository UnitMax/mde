import { useEffect, useMemo, useState } from 'react'
import { FolderGit2, GitBranch } from 'lucide-react'
import type { GitTerminalInfoResponse } from '@shared/types'
import type { TerminalDirectoryRequest } from '@shared/ipc'
import { useWorkspace } from '@/store/workspace'
import { GitDialog } from '@/components/GitDialog'
import { formatGitCount, gitStatusAccessibleLabel, gitStatusBranchLabel } from '@/lib/git'

const REFRESH_INTERVAL_MS = 10_000

export function TerminalGitInfo({ terminalId }: { terminalId: string }): JSX.Element | null {
  const directory = useWorkspace((state) => state.terminalDirectories[terminalId])
  const status = useWorkspace((state) => state.statuses[terminalId] ?? 'none')
  const [info, setInfo] = useState<GitTerminalInfoResponse | null>(null)
  const [open, setOpen] = useState(false)
  const target = useMemo<TerminalDirectoryRequest | null>(
    () => info ? { terminalId, directory: info.directory } : null,
    [terminalId, info?.directory]
  )

  useEffect(() => {
    let cancelled = false
    let inFlight = false

    const refresh = async (): Promise<void> => {
      if (inFlight || status === 'none') return
      inFlight = true
      try {
        const next = await window.api.git.terminalInfo({ terminalId })
        if (!cancelled) setInfo(next)
      } catch {
        if (!cancelled) setInfo(null)
      } finally {
        inFlight = false
      }
    }

    setInfo(null)
    setOpen(false)
    void refresh()
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    const refreshOnFocus = (): void => void refresh()
    window.addEventListener('focus', refreshOnFocus)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [directory, status, terminalId])

  if (!info?.repository) return null

  const accessibleLabel = [
    gitStatusAccessibleLabel(info),
    `${info.changedFiles} changed ${info.changedFiles === 1 ? 'entry' : 'entries'}`,
    info.worktree ? `Git worktree ${info.worktree}` : null,
    'Open Git changes and history',
  ].filter(Boolean).join(' · ')

  return (
    <>
      <button
        type="button"
        className="flex min-w-0 max-w-[60%] shrink items-center gap-1.5 rounded px-1 text-[10px] text-fg-subtle hover:bg-hover hover:text-fg focus-visible:outline focus-visible:outline-accent"
        data-testid={`terminal-git-info-${terminalId}`}
        aria-label={accessibleLabel}
        title={accessibleLabel}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
      >
        <span className="flex min-w-0 max-w-[45%] shrink-0 items-center gap-0.5">
          <GitBranch className="h-3 w-3 shrink-0 text-accent" aria-hidden="true" />
          <span className="truncate">{gitStatusBranchLabel(info)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 font-mono" data-testid="terminal-git-changes">
          {info.additions > 0 && <span className="text-ok">+{formatGitCount(info.additions)}</span>}
          {info.deletions > 0 && <span className="text-danger">−{formatGitCount(info.deletions)}</span>}
          {info.additions === 0 && info.deletions === 0 && (
            <span>{info.changedFiles > 0 ? `${formatGitCount(info.changedFiles)} changed` : 'Clean'}</span>
          )}
          {info.commitsAhead !== null && info.commitsAhead > 0 && (
            <span className="text-accent">↑{formatGitCount(info.commitsAhead)}</span>
          )}
        </span>
        {info.worktree && (
          <span className="flex min-w-0 items-center gap-0.5 font-mono">
            <FolderGit2 className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{info.worktree}</span>
          </span>
        )}
      </button>
      <GitDialog open={open} terminal={target} onOpenChange={setOpen} />
    </>
  )
}
