import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, GitBranch, RefreshCw } from 'lucide-react'
import type {
  GitChange,
  GitChangeStatus,
  GitDiffResponse,
  GitInfoResponse,
  Session
} from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  formatGitTimestamp,
  parseGitDiff,
  shortGitHash,
  type GitDiffLineKind
} from '@/lib/git'

interface GitDialogProps {
  open: boolean
  session: Session | null
  onOpenChange: (open: boolean) => void
}

const changeStatusLabels: Record<GitChangeStatus, string> = {
  modified: 'Modified',
  added: 'Added',
  deleted: 'Removed',
  renamed: 'Moved',
  copied: 'Copied',
  'type-changed': 'Type changed',
  unmerged: 'Conflict',
  untracked: 'Untracked'
}

const changeStatusShortLabels: Record<GitChangeStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  'type-changed': 'T',
  unmerged: 'U',
  untracked: '?'
}

const changeStatusClasses: Record<GitChangeStatus, string> = {
  modified: 'bg-warn/15 text-warn',
  added: 'bg-ok/15 text-ok',
  deleted: 'bg-danger/15 text-danger',
  renamed: 'bg-accent/15 text-accent',
  copied: 'bg-accent/15 text-accent',
  'type-changed': 'bg-warn/15 text-warn',
  unmerged: 'bg-danger/15 text-danger',
  untracked: 'bg-ok/15 text-ok'
}

const diffLineClasses: Record<GitDiffLineKind, string> = {
  addition: 'bg-ok/10 text-ok',
  deletion: 'bg-danger/10 text-danger',
  hunk: 'bg-accent/10 text-accent',
  metadata: 'text-fg-muted',
  context: 'text-fg'
}

function changeStateLabel(change: GitChange): string {
  if (change.staged && change.unstaged) return 'Staged and unstaged'
  if (change.staged) return 'Staged'
  return 'Unstaged'
}

function changePathLabel(change: GitChange): string {
  return change.oldPath ? `${change.oldPath} → ${change.path}` : change.path
}

export function GitDialog({ open, session, onOpenChange }: GitDialogProps): JSX.Element {
  const [info, setInfo] = useState<GitInfoResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [diff, setDiff] = useState<GitDiffResponse | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)
  const requestSequence = useRef(0)
  const diffRequestSequence = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    if (!session) return
    const sequence = ++requestSequence.current
    diffRequestSequence.current += 1
    setLoading(true)
    setInfo(null)
    setError(null)
    setSelectedPath(null)
    setDiff(null)
    setDiffError(null)
    setDiffLoading(false)
    try {
      const result = await window.api.git.info({ sessionId: session.id })
      if (sequence !== requestSequence.current) return
      setInfo(result)
    } catch (reason) {
      if (sequence !== requestSequence.current) return
      setError(reason instanceof Error ? reason.message : 'Could not load Git status and history.')
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [session])

  const loadDiff = useCallback(
    async (path: string): Promise<void> => {
      if (!session) return
      const sequence = ++diffRequestSequence.current
      setDiffLoading(true)
      setDiff(null)
      setDiffError(null)
      try {
        const result = await window.api.git.diff({ sessionId: session.id, path })
        if (sequence !== diffRequestSequence.current) return
        setDiff(result)
      } catch (reason) {
        if (sequence !== diffRequestSequence.current) return
        setDiffError(reason instanceof Error ? reason.message : 'Could not load the selected Git diff.')
      } finally {
        if (sequence === diffRequestSequence.current) setDiffLoading(false)
      }
    },
    [session]
  )

  useEffect(() => {
    if (!open || !session) {
      requestSequence.current += 1
      diffRequestSequence.current += 1
      setLoading(false)
      setDiffLoading(false)
      return
    }

    void load()
    return () => {
      requestSequence.current += 1
      diffRequestSequence.current += 1
    }
  }, [load, open, session])

  useEffect(() => {
    if (!open || !session || !info?.repository) {
      diffRequestSequence.current += 1
      setDiffLoading(false)
      return
    }

    const selectedStillExists = selectedPath !== null && info.changes.some((change) => change.path === selectedPath)
    const nextPath = selectedStillExists ? selectedPath : info.changes[0]?.path ?? null
    if (nextPath !== selectedPath) {
      setSelectedPath(nextPath)
      return
    }
    if (!selectedPath) return

    void loadDiff(selectedPath)
    return () => {
      diffRequestSequence.current += 1
    }
  }, [info, loadDiff, open, selectedPath, session])

  const branchLabel = info?.repository ? info.branch ?? 'Detached HEAD' : '—'
  const selectedChange = info?.changes.find((change) => change.path === selectedPath) ?? null
  const diffLines = diff ? parseGitDiff(diff.diff) : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent animated={false} className="flex max-h-[90vh] max-w-6xl flex-col overflow-x-hidden overflow-y-auto">
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

        {loading && (
          <p className="mt-4 rounded border border-line bg-panel p-4 text-xs text-fg-muted">
            Loading Git changes and history…
          </p>
        )}

        {!loading && error && (
          <div data-testid="git-error" className="mt-4 flex gap-2 rounded border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && info && !info.repository && (
          <div className="mt-4 flex flex-col gap-3">
            <section className="shrink-0">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Changes</h3>
              <p data-testid="git-no-changes" className="rounded border border-line bg-panel p-4 text-xs text-fg-muted">
                This session folder is not a Git repository.
              </p>
            </section>
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Recent commits</h3>
              <p data-testid="git-non-repository" className="rounded border border-line bg-panel p-4 text-xs text-fg-muted">
                This session folder is not a Git repository.
              </p>
            </section>
          </div>
        )}

        {!loading && !error && info?.repository && (
          <>
            <section className="mt-4 flex shrink-0 flex-col">
              <h3 className="mb-2 flex shrink-0 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                Changes
                <span className="rounded-full bg-active px-1.5 py-0.5 text-[10px] text-fg-muted">{info.changes.length}</span>
              </h3>

              {info.changes.length === 0 ? (
                <p data-testid="git-no-changes" className="rounded border border-line bg-panel p-4 text-xs text-fg-muted">
                  Working tree clean. There are no changes compared with HEAD.
                </p>
              ) : (
                <div data-testid="git-changes" className="grid min-w-0 grid-cols-[minmax(13rem,0.32fr)_minmax(0,0.68fr)] gap-2">
                  <div className="rounded border border-line bg-panel">
                    <div className="border-b border-line bg-elevated px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                      Changed files
                    </div>
                    <div role="listbox" aria-label="Changed files">
                      {info.changes.map((change) => {
                        const selected = change.path === selectedPath
                        return (
                          <button
                            key={change.path}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            data-testid="git-change"
                            title={`${changePathLabel(change)} · ${changeStateLabel(change)}`}
                            className={cn(
                              'flex w-full min-w-0 items-start gap-2 border-b border-line px-3 py-2 text-left text-xs transition-colors last:border-b-0',
                              selected ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'
                            )}
                            onClick={() => setSelectedPath(change.path)}
                          >
                            <span className={cn('mt-0.5 flex h-4 min-w-4 items-center justify-center rounded px-1 font-mono text-[10px] font-semibold', changeStatusClasses[change.status])}>
                              {changeStatusShortLabels[change.status]}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block break-words font-mono leading-4">{changePathLabel(change)}</span>
                              <span className="mt-0.5 block text-[10px] text-fg-subtle">
                                {changeStatusLabels[change.status]} · {changeStateLabel(change)}
                              </span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div data-testid="git-change-diff" className="flex min-w-0 flex-col rounded border border-line bg-panel">
                    <div className="shrink-0 border-b border-line bg-elevated px-3 py-2 text-xs text-fg">
                      <span className="block truncate font-mono" title={selectedChange ? changePathLabel(selectedChange) : undefined}>
                        {selectedChange ? changePathLabel(selectedChange) : 'Select a changed file'}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      {diffLoading && <p className="p-4 text-xs text-fg-muted">Loading diff…</p>}

                      {!diffLoading && diffError && (
                        <div className="m-3 flex gap-2 rounded border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{diffError}</span>
                        </div>
                      )}

                      {!diffLoading && !diffError && diff?.binary && (
                        <div className="p-4 text-xs text-fg-muted">
                          Binary file changed. Git did not return a text diff.
                          <pre className="mt-3 whitespace-pre-wrap font-mono text-[11px]">{diff.diff}</pre>
                        </div>
                      )}

                      {!diffLoading && !diffError && diff && !diff.binary && diffLines.length > 0 && (
                        <pre className="m-0 min-w-max select-text font-mono text-[11px] leading-5">
                          <code>
                            {diffLines.map((line, index) => (
                              <span key={`${index}-${line.text}`} className={cn('block min-h-5 px-3', diffLineClasses[line.kind])}>
                                {line.text || ' '}
                              </span>
                            ))}
                          </code>
                        </pre>
                      )}

                      {!diffLoading && !diffError && diff && !diff.binary && diffLines.length === 0 && (
                        <p className="p-4 text-xs text-fg-muted">No text diff is available for this file.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="mt-4 shrink-0">
              <h3 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                Recent commits
              </h3>

              {info.commits.length === 0 && (
                <p data-testid="git-empty" className="rounded border border-line bg-panel p-4 text-xs text-fg-muted">
                  This repository has no commits yet.
                </p>
              )}

              {info.commits.length > 0 && (
                <div className="overflow-x-auto rounded border border-line bg-panel">
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
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
