import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GitTerminalInfoResponse, InboxChangedFile, InboxChangesResponse } from '@shared/types'
import { GitGraphPanel, WorkingPane } from '@/components/inbox/GitGraphView'
import { ChangeDiffViewer } from '@/components/inbox/InboxChanges'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { useSessionGitGraph } from '@/store/session-git-graph'

const REFRESH_INTERVAL_MS = 10_000

/**
 * The uncommitted files of the terminal's checkout, read when the dashed row is chosen. Choosing one
 * reviews its diff over the graph.
 */
function SessionWorking({ terminalId, summary, onOpen, onClose }: {
  terminalId: string
  summary?: string
  onOpen: (file: InboxChangedFile) => void
  onClose: () => void
}): JSX.Element {
  const [value, setValue] = useState<InboxChangesResponse>()
  useEffect(() => {
    let current = true
    window.api.git.changes({ terminalId }).then(
      (next) => { if (current) setValue(next) },
      (error) => {
        if (current) setValue({
          available: false, reason: ipcErrorMessage(error, 'Could not read Git changes.'), branch: null, worktree: null,
          additions: 0, deletions: 0, fileCount: 0,
        })
      },
    )
    return () => { current = false }
  }, [terminalId, summary])
  return (
    <WorkingPane
      value={value}
      onOpen={(path) => { const file = value?.files?.find((f) => f.path === path); if (file) onOpen(file) }}
      onClose={onClose}
    />
  )
}

/**
 * The Git graph of a Sessions terminal's checkout, opened from the Git chip in the terminal's
 * header and laid over the session's terminals, which stay mounted beneath it. It reads the folder
 * the terminal is in when it opens, and closes when that terminal goes or another session is shown.
 * A file's diff opens over the graph, which keeps its place beneath for when the diff closes.
 */
export function SessionGitGraph({ sessionId, terminalIds, filePath }: {
  sessionId: string
  terminalIds: readonly string[]
  /** The file open in the viewer over the terminals; opening one closes the graph. */
  filePath?: string
}): JSX.Element | null {
  const terminalId = useSessionGitGraph((s) => s.terminalId)
  const mine = terminalId !== null && terminalIds.includes(terminalId)
  const [info, setInfo] = useState<GitTerminalInfoResponse | null>(null)
  const [diff, setDiff] = useState<InboxChangedFile | null>(null)
  const source = useMemo(() => (terminalId ? { terminalId } : null), [terminalId])

  const shownFile = useRef(filePath)
  useEffect(() => {
    if (filePath !== undefined && filePath !== shownFile.current) useSessionGitGraph.getState().close()
    shownFile.current = filePath
  }, [filePath])

  // A pane that was closed, or a graph left open in another session, does not follow here.
  useEffect(() => {
    if (terminalId !== null && !mine) useSessionGitGraph.getState().close()
  }, [terminalId, mine, sessionId])

  useEffect(() => setDiff(null), [terminalId])

  // The same summary the header chip reads, for the dashed row and to notice a commit (an agent in
  // another pane can make one while the graph is open).
  useEffect(() => {
    if (!mine || !terminalId) return
    let current = true
    const refresh = (): void => {
      window.api.git.terminalInfo({ terminalId }).then(
        (next) => { if (current) setInfo(next) },
        () => { if (current) setInfo(null) },
      )
    }
    refresh()
    const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      current = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [mine, terminalId])

  const readDiff = useCallback((path: string) => window.api.git.changeDiff({ terminalId: terminalId ?? '', path }), [terminalId])
  if (!mine || !terminalId || !source) return null
  const summary = info ? JSON.stringify([info.directory, info.branch, info.changedFiles, info.additions, info.deletions, info.commitsAhead]) : undefined
  return (
    <>
      <GitGraphPanel
        open
        identity={terminalId}
        source={source}
        onClose={() => useSessionGitGraph.getState().close()}
        workingCount={info?.changedFiles ?? 0}
        refreshKey={summary}
        renderWorking={(close) => <SessionWorking terminalId={terminalId} summary={summary} onOpen={setDiff} onClose={close} />}
      />
      {diff && (
        <ChangeDiffViewer
          identity={terminalId}
          file={diff}
          branch={info?.repository ? info.branch : undefined}
          reloadKey={summary}
          readDiff={readDiff}
          onClose={() => setDiff(null)}
        />
      )}
    </>
  )
}
