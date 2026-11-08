import { useEffect, useState } from 'react'
import { GitBranch } from 'lucide-react'
import type { GitTerminalInfoResponse } from '@shared/types'
import { useWorkspace } from '@/store/workspace'
import { formatGitCount, gitStatusAccessibleLabel, gitStatusBranchLabel } from '@/lib/git'

const REFRESH_INTERVAL_MS = 10_000

export function TerminalGitInfo({ terminalId }: { terminalId: string }): JSX.Element | null {
  const directory = useWorkspace((state) => state.terminalDirectories[terminalId])
  const status = useWorkspace((state) => state.statuses[terminalId] ?? 'none')
  const [info, setInfo] = useState<GitTerminalInfoResponse | null>(null)

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

  const dirty = info.changedFiles > 0 || info.additions > 0 || info.deletions > 0
  const accessibleLabel = [
    gitStatusAccessibleLabel(info),
    info.changedFiles > 0
      ? `${info.changedFiles} changed ${info.changedFiles === 1 ? 'entry' : 'entries'}`
      : dirty ? null : 'Working tree clean',
    info.worktree ? `Git worktree ${info.worktree}` : null,
  ].filter(Boolean).join(' · ')

  // The chip never shrinks (the title is the one flexible item in the header, so it is the one that
  // gets an ellipsis). Instead, in a narrow pane (`@container/pane` is the header) the text goes and
  // only the icon and a dot for uncommitted changes remain. The label and tooltip always carry the
  // detail the chip leaves out (ahead, worktree, clean).
  return (
    <div
      role="img"
      className="flex h-5 shrink-0 items-center gap-1.5 rounded px-1.5 text-[11px] text-fg-muted"
      data-testid={`terminal-git-info-${terminalId}`}
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      <GitBranch className="h-3 w-3 shrink-0 text-accent" aria-hidden="true" />
      <span className="max-w-[8rem] truncate @max-[22rem]/pane:hidden">{gitStatusBranchLabel(info)}</span>
      {dirty && (
        <>
          <span className="flex shrink-0 items-center gap-1 font-mono @max-[22rem]/pane:hidden" data-testid="terminal-git-changes">
            {info.additions > 0 && <span className="text-ok">+{formatGitCount(info.additions)}</span>}
            {info.deletions > 0 && <span className="text-danger">−{formatGitCount(info.deletions)}</span>}
            {info.additions === 0 && info.deletions === 0 && (
              <span>{formatGitCount(info.changedFiles)} changed</span>
            )}
          </span>
          <span
            aria-hidden="true"
            className="hidden h-1.5 w-1.5 shrink-0 rounded-full bg-warn @max-[22rem]/pane:block"
          />
        </>
      )}
    </div>
  )
}
