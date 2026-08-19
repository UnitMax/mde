import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, GitBranch, RefreshCw } from 'lucide-react'
import type { GitInfoResponse, Session } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { formatGitTimestamp, shortGitHash } from '@/lib/git'

interface GitDialogProps {
  open: boolean
  session: Session | null
  onOpenChange: (open: boolean) => void
}

export function GitDialog({ open, session, onOpenChange }: GitDialogProps): JSX.Element {
  const [info, setInfo] = useState<GitInfoResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSequence = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    if (!session) return
    const sequence = ++requestSequence.current
    setLoading(true)
    setInfo(null)
    setError(null)
    try {
      const result = await window.api.git.info({ sessionId: session.id })
      if (sequence !== requestSequence.current) return
      setInfo(result)
    } catch (reason) {
      if (sequence !== requestSequence.current) return
      setError(reason instanceof Error ? reason.message : 'Could not load Git history.')
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [session])

  useEffect(() => {
    if (!open || !session) {
      requestSequence.current += 1
      setLoading(false)
      return
    }

    void load()
    return () => {
      requestSequence.current += 1
    }
  }, [load, open, session])

  const branchLabel = info?.repository ? info.branch ?? 'Detached HEAD' : '—'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent animated={false} className="flex max-h-[85vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>Git history</DialogTitle>
          <DialogDescription>
            {session ? `${session.name} · ${session.path}` : 'Session Git history'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 items-center justify-between gap-3 rounded border border-line bg-panel px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">Branch</div>
            <div data-testid="git-branch" className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-sm text-fg">
              <GitBranch className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="truncate">{loading ? 'Loading…' : branchLabel}</span>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            data-testid="git-refresh"
            disabled={!session || loading}
            onClick={() => void load()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        <section className="mt-4 flex min-h-0 flex-1 flex-col">
          <h3 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
            Recent commits
          </h3>

          {loading && (
            <p className="rounded border border-line bg-panel p-4 text-xs text-fg-muted">
              Loading Git history…
            </p>
          )}

          {!loading && error && (
            <div data-testid="git-error" className="flex gap-2 rounded border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && info && !info.repository && (
            <p data-testid="git-non-repository" className="rounded border border-line bg-panel p-4 text-xs text-fg-muted">
              This session folder is not a Git repository.
            </p>
          )}

          {!loading && !error && info?.repository && info.commits.length === 0 && (
            <p data-testid="git-empty" className="rounded border border-line bg-panel p-4 text-xs text-fg-muted">
              This repository has no commits yet.
            </p>
          )}

          {!loading && !error && info?.repository && info.commits.length > 0 && (
            <div className="min-h-0 flex-1 overflow-auto rounded border border-line bg-panel">
              <table className="w-full table-fixed border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-elevated text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                  <tr>
                    <th className="w-24 px-3 py-2">Hash</th>
                    <th className="px-3 py-2">Message</th>
                    <th className="w-44 px-3 py-2">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {info.commits.map((commit) => (
                    <tr key={commit.hash} data-testid="git-commit" className="border-t border-line align-top">
                      <td className="px-3 py-2 font-mono text-fg-muted" title={commit.hash}>
                        {shortGitHash(commit.hash)}
                      </td>
                      <td className="break-words px-3 py-2 text-fg">{commit.message}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-fg-muted">
                        {formatGitTimestamp(commit.timestamp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  )
}
