import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import {
  AlertCircle, ArrowDown, ArrowUp, Check, Cloud, CloudDownload, Copy, Crosshair, GitBranch, GitCommitHorizontal,
  GitGraph, LoaderCircle, RefreshCw, Search, Tag, X,
} from 'lucide-react'
import type { GitGraphCommit, GitGraphRef, GitGraphScope, GitRootRequest, InboxChangesResponse, InboxGitCommitDetails, InboxGitCommitFile, InboxGitGraph } from '@shared/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { layoutGitGraph, relativeCommitTime, type GraphRow } from '@/lib/git-graph'
import { useInboxChanges, inboxChangesKey } from '@/store/inbox-changes'
import { useWorkspace } from '@/store/workspace'
import { codeViewerFontFamily, getTerminalSettings, subscribeTerminalSettings } from '@/terminal/terminal-settings'
import { ChangeCounts, ChangeDiffViewer, StatusMark } from './InboxChanges'

/** Commits read at first, and added each time the list nears its end. */
export const GRAPH_PAGE = 400
const GRAPH_MAX = 5000
const ROW_HEIGHT = 28
const LANE_WIDTH = 14
/** Lanes drawn before the graph column stops growing; wider history is cut at its edge. */
const MAX_DRAWN_LANES = 18
const OVERSCAN = 12
/** The pseudo-commit for uncommitted changes, which no real object name can equal. */
const WORKING = 'working-tree'
const SCOPE_KEY = 'mde.inbox.gitGraph.scope'
const SCOPES: Array<{ value: GitGraphScope; label: string; title: string }> = [
  { value: 'all', label: 'All', title: 'Local branches, remote branches and tags' },
  { value: 'local', label: 'Local', title: 'Local branches and tags' },
  { value: 'head', label: 'Current', title: 'Only the history of the checked-out commit' },
]

/** Theme colors the lanes take in turn, so a graph matches the chosen theme. */
const LANE_COLORS = [
  'var(--color-accent)',
  'var(--color-syntax-type)',
  'var(--color-syntax-keyword)',
  'var(--color-warn)',
  'var(--color-ok)',
  'var(--color-danger)',
  'var(--color-syntax-function)',
  'var(--color-syntax-string)',
]
export const laneColor = (index: number): string => LANE_COLORS[index % LANE_COLORS.length]!

function storedScope(): GitGraphScope {
  try {
    const value = localStorage.getItem(SCOPE_KEY)
    return value === 'local' || value === 'head' ? value : 'all'
  } catch {
    return 'all'
  }
}

function saveScope(scope: GitGraphScope): void {
  try { localStorage.setItem(SCOPE_KEY, scope) } catch { /* the choice is only a convenience */ }
}

const short = (hash: string): string => hash.slice(0, 7)

/**
 * A commit body as paragraphs: Git messages are usually wrapped at 72 columns, which reads badly in
 * a narrower or wider pane, so the lines of a plain paragraph are joined. Lists, indented text
 * (code, quotes) and trailers keep their lines.
 */
export function commitBodyParagraphs(body: string): string[] {
  return body.split(/\n\s*\n/).map((paragraph) => {
    const lines = paragraph.split('\n')
    const structured = lines.some((line) => /^\s*(?:[-*+•]|\d+[.)])\s/.test(line) || /^\s{2,}|^\t|^>/.test(line) || /^[A-Z][\w-]+: /.test(line))
    return structured ? paragraph : lines.map((line) => line.trim()).join(' ')
  }).filter((paragraph) => paragraph.trim())
}

/** A local branch, with the remote branches of the same name that point at the same commit. */
interface RefChip {
  key: string
  kind: 'head' | 'branch' | 'remote' | 'tag'
  name: string
  current: boolean
  remotes: string[]
}

/**
 * The chips a commit shows: the checked-out branch first, then other branches, remote branches and
 * tags. A remote branch that names the same branch at the same commit (`origin/main` beside `main`)
 * joins the local chip, which then shows a cloud for it.
 */
export function refChips(refs: readonly GitGraphRef[], branch: string | null, detachedHead: boolean): RefChip[] {
  const chips: RefChip[] = []
  if (detachedHead) chips.push({ key: 'HEAD', kind: 'head', name: 'HEAD', current: true, remotes: [] })
  const remotes = refs.filter((ref) => ref.kind === 'remote')
  const joined = new Set<string>()
  const locals = refs.filter((ref) => ref.kind === 'branch')
    .sort((a, b) => Number(b.name === branch) - Number(a.name === branch))
  for (const ref of locals) {
    const same = remotes.filter((remote) => remote.name.slice(remote.name.indexOf('/') + 1) === ref.name)
    for (const remote of same) joined.add(remote.name)
    chips.push({
      key: `b:${ref.name}`, kind: 'branch', name: ref.name, current: ref.name === branch,
      remotes: same.map((remote) => remote.name.slice(0, remote.name.indexOf('/'))),
    })
  }
  for (const ref of remotes) {
    if (!joined.has(ref.name)) chips.push({ key: `r:${ref.name}`, kind: 'remote', name: ref.name, current: false, remotes: [] })
  }
  for (const ref of refs) {
    if (ref.kind === 'tag') chips.push({ key: `t:${ref.name}`, kind: 'tag', name: ref.name, current: false, remotes: [] })
  }
  return chips
}

function Chip({ chip, color }: { chip: RefChip; color: string }): JSX.Element {
  const tone = chip.kind === 'tag' ? 'var(--color-warn)' : chip.kind === 'remote' ? 'var(--color-fg-muted)' : color
  const Icon = chip.kind === 'tag' ? Tag : chip.kind === 'remote' ? Cloud : chip.kind === 'head' ? GitCommitHorizontal : GitBranch
  const label = chip.kind === 'tag' ? `Tag ${chip.name}`
    : chip.kind === 'remote' ? `Remote branch ${chip.name}`
      : chip.kind === 'head' ? 'Detached HEAD'
        : `${chip.current ? 'Current branch' : 'Branch'} ${chip.name}${chip.remotes.length ? `, same as ${chip.remotes.map((r) => `${r}/${chip.name}`).join(', ')}` : ''}`
  return (
    <span
      title={label}
      aria-label={label}
      data-testid="git-graph-ref"
      data-kind={chip.kind}
      data-current={chip.current || undefined}
      className={cn(
        'inline-flex h-[18px] max-w-[220px] shrink-0 items-center gap-1 rounded-full border px-1.5 text-[11px] leading-none',
        chip.current && 'font-semibold',
      )}
      style={{
        color: tone,
        borderColor: `color-mix(in oklab, ${tone} ${chip.current ? 70 : 38}%, transparent)`,
        background: `color-mix(in oklab, ${tone} ${chip.current ? 22 : 10}%, transparent)`,
      }}
    >
      {chip.current && chip.kind === 'branch' ? <Check className="h-3 w-3" aria-hidden /> : <Icon className="h-3 w-3" aria-hidden />}
      <span className="truncate">{chip.name}</span>
      {chip.remotes.length > 0 && <Cloud className="h-3 w-3 opacity-70" aria-hidden />}
    </span>
  )
}

const laneX = (lane: number): number => LANE_WIDTH / 2 + lane * LANE_WIDTH + 4

function segmentPath(from: number, to: number, half: 'top' | 'bottom'): string {
  const middle = ROW_HEIGHT / 2
  const x1 = laneX(from)
  const x2 = laneX(to)
  const [y1, y2] = half === 'top' ? [0, middle] : [middle, ROW_HEIGHT]
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`
  // A line changing lanes bends within its half-row, leaving and arriving vertically.
  return `M ${x1} ${y1} C ${x1} ${y1 + middle * 0.9}, ${x2} ${y1 + middle * 0.1}, ${x2} ${y2}`
}

function GraphCell({ row, width, kind }: { row: GraphRow; width: number; kind: 'commit' | 'merge' | 'head' | 'working' }): JSX.Element {
  const color = laneColor(row.color)
  const x = laneX(row.column)
  const y = ROW_HEIGHT / 2
  return (
    <svg width={width} height={ROW_HEIGHT} className="shrink-0 overflow-hidden" aria-hidden>
      {row.segments.map((segment, index) => (
        <path
          key={index}
          d={segmentPath(segment.from, segment.to, segment.half)}
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={segment.dashed ? '3 3' : undefined}
          style={{ stroke: laneColor(segment.color) }}
        />
      ))}
      {kind === 'working' ? (
        <circle cx={x} cy={y} r={4.5} strokeWidth={1.75} strokeDasharray="2.5 2" style={{ stroke: 'var(--color-fg-muted)', fill: 'var(--color-bg)' }} />
      ) : kind === 'head' ? (
        <>
          <circle cx={x} cy={y} r={6} strokeWidth={2} style={{ stroke: color, fill: 'var(--color-bg)' }} />
          <circle cx={x} cy={y} r={2.75} style={{ fill: color }} />
        </>
      ) : kind === 'merge' ? (
        <circle cx={x} cy={y} r={3.75} strokeWidth={2} style={{ stroke: color, fill: 'var(--color-bg)' }} />
      ) : (
        <circle cx={x} cy={y} r={4} strokeWidth={1.5} style={{ fill: color, stroke: 'var(--color-bg)' }} />
      )}
    </svg>
  )
}

function matches(commit: GitGraphCommit, refs: readonly GitGraphRef[] | undefined, query: string): boolean {
  if (!query) return true
  return commit.subject.toLowerCase().includes(query)
    || commit.author.toLowerCase().includes(query)
    || commit.hash.startsWith(query)
    || Boolean(refs?.some((ref) => ref.name.toLowerCase().includes(query)))
}

interface GraphState {
  value?: InboxGitGraph
  loading: boolean
  error?: string
}

function UpstreamSummary({ value }: { value: InboxGitGraph }): JSX.Element {
  const upstream = value.upstream
  return (
    <span className="flex min-w-0 items-center gap-2 text-[11.5px] text-fg-muted" data-testid="git-graph-head">
      <span
        className="flex min-w-0 items-center gap-1 rounded-full border border-accent/50 bg-accent/15 px-2 py-0.5 font-medium text-accent"
        title={value.branch ? `Checked out: ${value.branch}` : value.head ? `Detached HEAD at ${short(value.head)}` : 'No commits yet'}
      >
        {value.branch ? <GitBranch className="h-3 w-3 shrink-0" aria-hidden /> : <GitCommitHorizontal className="h-3 w-3 shrink-0" aria-hidden />}
        <span className="truncate">{value.branch ?? (value.head ? `Detached at ${short(value.head)}` : 'No commits yet')}</span>
      </span>
      {upstream ? (
        upstream.ahead === 0 && upstream.behind === 0 ? (
          <span className="truncate" title={`Up to date with ${upstream.name} as of the last fetch`}>
            Up to date with <span className="text-fg">{upstream.name}</span>
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5" title={`Compared with ${upstream.name} as of the last fetch`}>
            {upstream.ahead > 0 && (
              <span className="flex items-center gap-0.5 tabular-nums text-ok" aria-label={`${upstream.ahead} ahead`}>
                <ArrowUp className="h-3 w-3" aria-hidden />{upstream.ahead}
              </span>
            )}
            {upstream.behind > 0 && (
              <span className="flex items-center gap-0.5 tabular-nums text-warn" aria-label={`${upstream.behind} behind`}>
                <ArrowDown className="h-3 w-3" aria-hidden />{upstream.behind}
              </span>
            )}
            <span className="truncate">{upstream.name}</span>
          </span>
        )
      ) : value.branch ? (
        <span className="truncate text-fg-subtle">No upstream branch</span>
      ) : null}
    </span>
  )
}

function CommitDetails({
  source, commit, chips, color, loaded, onSelect, onOpenFile, onClose,
}: {
  source: GitRootRequest
  commit: GitGraphCommit
  chips: RefChip[]
  color: string
  /** Whether a commit is in the list, so a parent past its end is shown but cannot be gone to. */
  loaded: (hash: string) => boolean
  onSelect: (hash: string) => void
  /** Reviews one of the commit's files, against the commit's first parent. */
  onOpenFile: (file: InboxGitCommitFile) => void
  onClose: () => void
}): JSX.Element {
  const [state, setState] = useState<{ hash: string; value?: InboxGitCommitDetails; error?: string } | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    let current = true
    setState({ hash: commit.hash })
    setCopied(false)
    window.api.git.commit({ ...source, hash: commit.hash }).then(
      (value) => { if (current) setState({ hash: commit.hash, value }) },
      (error) => { if (current) setState({ hash: commit.hash, error: ipcErrorMessage(error, 'Could not read the commit.') }) },
    )
    return () => { current = false }
  }, [source, commit.hash])
  const details = state?.hash === commit.hash ? state.value : undefined
  const message = details?.message ?? commit.subject
  const newline = message.indexOf('\n')
  const subject = newline >= 0 ? message.slice(0, newline) : message
  const body = newline >= 0 ? message.slice(newline + 1).replace(/^\s*\n/, '') : ''
  const copy = (): void => {
    void window.api.clipboard.writeText(commit.hash).then(() => setCopied(true), () => undefined)
  }
  const totals = details?.files.reduce((sum, file) => ({ additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions }), { additions: 0, deletions: 0 })
  return (
    <aside
      className="flex min-h-0 w-[min(400px,45%)] shrink-0 flex-col border-l border-line bg-panel"
      data-testid="git-graph-details"
      aria-label={`Commit ${short(commit.hash)}`}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line pl-3 pr-1.5">
        <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
        <span className="inbox-code-font text-[12px] text-fg">{short(commit.hash)}</span>
        <Button variant="ghost" size="icon-sm" title={copied ? 'Copied' : 'Copy full commit hash'} aria-label="Copy full commit hash" onClick={copy}>
          {copied ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
        <span className="flex-1" />
        <Button variant="ghost" size="icon-sm" title="Close commit details" aria-label="Close commit details" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3 border-b border-line px-4 py-3">
          <h3 className="select-text break-words text-[13.5px] font-semibold leading-snug text-fg">{subject}</h3>
          {body && (
            <div className="space-y-2 text-[12.5px] leading-relaxed text-fg-muted">
              {commitBodyParagraphs(body).map((paragraph, index) => (
                <p key={index} className="select-text whitespace-pre-wrap break-words">{paragraph}</p>
              ))}
            </div>
          )}
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {chips.map((chip) => <Chip key={chip.key} chip={chip} color={color} />)}
            </div>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
            <dt className="text-fg-subtle">Author</dt>
            <dd className="min-w-0 truncate text-fg">{details?.author ?? commit.author}</dd>
            <dt className="text-fg-subtle">Date</dt>
            <dd className="text-fg-muted">{new Date((details?.authorTime ?? commit.time) * 1000).toLocaleString()}</dd>
            {details && details.committer !== details.author && (
              <>
                <dt className="text-fg-subtle">Committer</dt>
                <dd className="min-w-0 truncate text-fg-muted">{details.committer}</dd>
              </>
            )}
            {commit.parents.length > 0 && (
              <>
                <dt className="text-fg-subtle">{commit.parents.length > 1 ? 'Parents' : 'Parent'}</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {commit.parents.map((parent) => (
                    <button
                      key={parent}
                      type="button"
                      disabled={!loaded(parent)}
                      className="inbox-code-font rounded px-1 text-[11.5px] text-accent hover:bg-hover hover:underline disabled:text-fg-muted disabled:no-underline disabled:hover:bg-transparent"
                      title={loaded(parent) ? `Go to ${parent}` : `${parent} (further down than the commits loaded)`}
                      onClick={() => onSelect(parent)}
                    >
                      {short(parent)}
                    </button>
                  ))}
                </dd>
              </>
            )}
          </dl>
        </div>
        <div className="px-2 py-2">
          <p className="flex items-center gap-2 px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
            {details ? `${details.files.length}${details.truncated ? '+' : ''} ${details.files.length === 1 ? 'file' : 'files'} changed` : 'Files'}
            {totals && <span className="inbox-code-font normal-case tracking-normal"><ChangeCounts additions={totals.additions} deletions={totals.deletions} /></span>}
            {commit.parents.length > 1 && <span className="normal-case tracking-normal">against the first parent</span>}
          </p>
          {state?.error ? (
            <p role="alert" className="flex items-center gap-2 px-2 py-2 text-[12px] text-danger">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />{state.error}
            </p>
          ) : !details ? (
            <p role="status" className="flex items-center gap-2 px-2 py-2 text-[12px] text-fg-muted">
              <LoaderCircle className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" aria-hidden />Loading commit…
            </p>
          ) : details.files.length === 0 ? (
            <p className="px-2 py-2 text-[12px] text-fg-muted">No file changes.</p>
          ) : (
            <ul className="space-y-px" data-testid="git-graph-files">
              {details.files.map((file) => {
                const slash = file.path.lastIndexOf('/') + 1
                return (
                  <li key={file.path}>
                    <button
                      type="button"
                      data-testid="git-graph-commit-file"
                      title={`${file.from ? `${file.from} → ${file.path}` : file.path}\nReview the change`}
                      onClick={() => onOpenFile(file)}
                      className="flex w-full min-w-0 items-center gap-2 rounded px-2 py-1 text-left hover:bg-hover focus-visible:bg-hover"
                    >
                      <StatusMark status={file.status} />
                      <span className="inbox-code-font min-w-0 flex-1 truncate text-[11.5px]">
                        <span className="text-fg">{file.path.slice(slash)}</span>
                        {slash > 0 && <span className="ml-1.5 text-fg-subtle">{file.path.slice(0, slash)}</span>}
                      </span>
                      <span className="inbox-code-font text-[11px]">
                        <ChangeCounts additions={file.additions} deletions={file.deletions} binary={file.binary} />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {details?.truncated && <p className="px-2 pt-1 text-[11px] text-fg-subtle">Only the first {details.files.length} files are listed.</p>}
        </div>
      </div>
    </aside>
  )
}

/**
 * The uncommitted changes, chosen from the dashed row above HEAD: the same files as the Changes tab.
 * With `onOpen`, choosing a file reviews its diff.
 */
export function WorkingPane({ value, onOpen, onClose }: {
  value: InboxChangesResponse | undefined
  onOpen?: (path: string) => void
  onClose: () => void
}): JSX.Element {
  const files = value?.available ? value.files : undefined
  return (
    <aside className="flex min-h-0 w-[min(400px,45%)] shrink-0 flex-col border-l border-line bg-panel" data-testid="git-graph-working" aria-label="Uncommitted changes">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line pl-3 pr-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-dashed border-fg-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-fg">Uncommitted changes</span>
        <Button variant="ghost" size="icon-sm" title="Close" aria-label="Close uncommitted changes" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <p className="flex items-center gap-2 px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
          {value?.available ? `${value.fileCount} ${value.fileCount === 1 ? 'file' : 'files'} changed` : 'Files'}
          {value?.available && <span className="inbox-code-font normal-case tracking-normal"><ChangeCounts additions={value.additions} deletions={value.deletions} /></span>}
        </p>
        <p className="px-2 pb-2 text-[11.5px] leading-snug text-fg-subtle">
          Staged, unstaged and untracked, against HEAD.{onOpen ? ' Choose a file to review its diff.' : ''}
        </p>
        {value && !value.available ? (
          <p className="px-2 py-2 text-[12px] text-fg-muted">{value.reason ?? 'Git changes are not available here.'}</p>
        ) : !files ? (
          <p role="status" className="flex items-center gap-2 px-2 py-2 text-[12px] text-fg-muted">
            <LoaderCircle className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" aria-hidden />Loading changes…
          </p>
        ) : files.length === 0 ? (
          <p className="px-2 py-2 text-[12px] text-fg-muted">No uncommitted changes.</p>
        ) : (
          <ul className="space-y-px">
            {files.map((file) => {
              const slash = file.path.lastIndexOf('/') + 1
              const content = (
                <>
                  <StatusMark status={file.status} />
                  <span className="inbox-code-font min-w-0 flex-1 truncate text-[11.5px]">
                    <span className="text-fg">{file.path.slice(slash)}</span>
                    {slash > 0 && <span className="ml-1.5 text-fg-subtle">{file.path.slice(0, slash)}</span>}
                  </span>
                  <span className="inbox-code-font text-[11px]">
                    <ChangeCounts additions={file.additions} deletions={file.deletions} binary={file.binary} />
                  </span>
                </>
              )
              return (
                <li key={file.path}>
                  {onOpen ? (
                    <button
                      type="button"
                      title={file.path}
                      data-testid="git-graph-working-file"
                      onClick={() => onOpen(file.path)}
                      className="flex w-full min-w-0 items-center gap-2 rounded px-2 py-1 text-left hover:bg-hover focus-visible:bg-hover"
                    >
                      {content}
                    </button>
                  ) : (
                    <div title={file.path} data-testid="git-graph-working-file" className="flex min-w-0 items-center gap-2 rounded px-2 py-1">
                      {content}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}

/** The Inbox thread's uncommitted changes, from the Changes store; a file opens the diff review. */
function InboxWorking({ threadId, onClose }: { threadId: string; onClose: () => void }): JSX.Element {
  const value = useInboxChanges((s) => s.entries[inboxChangesKey(threadId)]?.value)
  useEffect(() => {
    const stop = useInboxChanges.getState().watch(threadId, true)
    void useInboxChanges.getState().load(threadId, true)
    return stop
  }, [threadId])
  return <WorkingPane value={value} onOpen={(path) => useInboxChanges.getState().openFile(threadId, path, true)} onClose={onClose} />
}

export interface GitGraphPanelProps {
  open: boolean
  /** What the graph shows (a thread or a terminal); a new identity starts afresh. */
  identity: string
  source: GitRootRequest
  onClose: () => void
  /** The checkout's uncommitted files, shown as a dashed row above HEAD when there are any. */
  workingCount: number
  /** Changes when the checkout may have changed (a commit, a checkout); the graph is read again. */
  refreshKey?: string
  /** The pane shown beside the graph for the uncommitted changes. */
  renderWorking: (close: () => void) => ReactNode
}

/**
 * The Git graph of an Inbox thread's checkout, laid over the conversation like a diff review. It
 * gives way to a file opened from the tree, and closes when the thread is left.
 */
export function GitGraphView({ threadId }: { threadId: string }): JSX.Element | null {
  const open = useInboxChanges((s) => s.graphThreadId === threadId)
  const treeFile = useWorkspace((s) => s.openFiles[threadId])
  const changes = useInboxChanges((s) => s.entries[inboxChangesKey(threadId)]?.value)
  const source = useMemo(() => ({ threadId }), [threadId])
  useEffect(() => {
    if (open && treeFile !== undefined) useInboxChanges.getState().closeGraph()
  }, [open, treeFile])
  // Leaving the thread, or the Inbox, closes the graph.
  useEffect(() => () => {
    if (useInboxChanges.getState().graphThreadId === threadId) useInboxChanges.getState().closeGraph()
  }, [threadId])
  return (
    <GitGraphPanel
      open={open}
      identity={threadId}
      source={source}
      onClose={() => useInboxChanges.getState().closeGraph()}
      workingCount={changes?.available ? changes.fileCount : 0}
      // A commit made in the thread changes the working tree, which the Changes watcher notices.
      refreshKey={changes ? JSON.stringify([changes.branch, changes.fileCount, changes.additions, changes.deletions]) : undefined}
      renderWorking={(close) => <InboxWorking threadId={threadId} onClose={close} />}
    />
  )
}

/**
 * The Git graph of a checkout: every commit up to the newest with the lanes that join them, the
 * branches, remote branches and tags that point at them, and where HEAD is. Fetch brings the
 * remote branches up to date. Laid over the conversation (Inbox) or the terminals (Sessions).
 */
export function GitGraphPanel({ open, identity, source, onClose, workingCount, refreshKey, renderWorking }: GitGraphPanelProps): JSX.Element | null {
  const [scope, setScope] = useState<GitGraphScope>(storedScope)
  const [limit, setLimit] = useState(GRAPH_PAGE)
  const [state, setState] = useState<GraphState>({ loading: true })
  const [fetching, setFetching] = useState<{ busy: boolean; error?: string; at?: number }>({ busy: false })
  const [selected, setSelected] = useState<string | null>(null)
  /** A committed file under review, over the graph, which keeps its place beneath. */
  const [review, setReview] = useState<{ hash: string; parents: number; file: InboxGitCommitFile } | null>(null)
  const reviewHash = review?.hash
  const readCommitDiff = useCallback(
    (path: string) => window.api.git.commitDiff({ ...source, hash: reviewHash ?? '', path }),
    [source, reviewHash],
  )
  const [query, setQuery] = useState('')
  const [family, setFamily] = useState(() => getTerminalSettings().codeFamily)
  const [view, setView] = useState({ top: 0, height: 600 })
  const [, setTick] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const request = useRef(0)

  const load = useCallback((nextLimit = limit, nextScope = scope) => {
    const id = ++request.current
    setState((previous) => ({ ...previous, loading: true }))
    window.api.git.graph({ ...source, limit: nextLimit, scope: nextScope }).then(
      (value) => { if (id === request.current) setState({ value, loading: false }) },
      (error) => {
        if (id === request.current) setState((previous) => ({ value: previous.value, loading: false, error: ipcErrorMessage(error, 'Could not read the Git history.') }))
      },
    )
  }, [source, limit, scope])

  // Another thread or terminal starts afresh. Coming back (after a diff review opened from here)
  // keeps the chosen commit and the search, and reads the graph again.
  const shown = useRef(identity)
  useEffect(() => {
    if (!open) return
    if (shown.current !== identity) {
      shown.current = identity
      setReview(null)
      setSelected(null)
      setQuery('')
      setFetching({ busy: false })
      setState({ loading: true })
    }
    setLimit(GRAPH_PAGE)
    load(GRAPH_PAGE, scope)
  }, [open, identity])
  // The list is drawn anew on coming back, so bring the chosen row into view once there are rows.
  const revealed = useRef(false)
  useEffect(() => { if (!open) revealed.current = false }, [open])

  // Polls hand over a new object each time, so only a different summary reads the graph again.
  const refreshRef = useRef(refreshKey)
  useEffect(() => {
    const previous = refreshRef.current
    refreshRef.current = refreshKey
    if (!open || previous === undefined || previous === refreshKey) return
    load()
  }, [open, refreshKey, load])

  useEffect(() => subscribeTerminalSettings(() => setFamily(getTerminalSettings().codeFamily)), [])
  // "Fetched 2 min ago" keeps its age.
  useEffect(() => {
    if (!open || !fetching.at) return
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [open, fetching.at])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    list.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [open, identity])

  useLayoutEffect(() => {
    const element = list.current
    if (!element || !open) return
    const measure = (): void => setView({ top: element.scrollTop, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [open, state.value === undefined])

  const value = state.value?.available ? state.value : undefined
  const working = Boolean(value?.head && workingCount > 0)
  const rows = useMemo(() => {
    const commits = value?.commits ?? []
    const input = [
      ...(working && value?.head ? [{ hash: WORKING, parents: [value.head], dashed: true }] : []),
      ...commits,
    ]
    return { input, layout: layoutGitGraph(input) }
  }, [value?.commits, value?.head, working])
  const refsByCommit = useMemo(() => {
    const map = new Map<string, GitGraphRef[]>()
    for (const ref of value?.refs ?? []) map.set(ref.hash, [...(map.get(ref.hash) ?? []), ref])
    return map
  }, [value?.refs])
  const byHash = useMemo(() => new Map((value?.commits ?? []).map((commit, index) => [commit.hash, index + (working ? 1 : 0)])), [value?.commits, working])
  const lanes = Math.min(MAX_DRAWN_LANES, rows.layout.reduce((max, row) => Math.max(max, row.width), 1))
  const graphWidth = lanes * LANE_WIDTH + 8
  const needle = query.trim().toLowerCase()
  const found = useMemo(() => {
    if (!needle) return []
    return rows.input.flatMap((commit, index) =>
      commit.hash !== WORKING && matches(commit as GitGraphCommit, refsByCommit.get(commit.hash), needle) ? [index] : [])
  }, [needle, rows.input, refsByCommit])

  const scrollToRow = useCallback((index: number) => {
    const element = list.current
    if (!element) return
    const top = index * ROW_HEIGHT
    if (top < element.scrollTop) element.scrollTop = top
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW_HEIGHT - element.clientHeight
  }, [])
  const select = useCallback((hash: string | null, reveal = true) => {
    setSelected(hash)
    if (!hash || !reveal) return
    const index = hash === WORKING ? 0 : byHash.get(hash)
    if (index !== undefined) scrollToRow(index)
  }, [byHash, scrollToRow])
  const centerRow = useCallback((index: number) => {
    const element = list.current
    if (element) element.scrollTop = Math.max(0, index * ROW_HEIGHT - element.clientHeight / 2 + ROW_HEIGHT / 2)
  }, [])

  const loadMore = useCallback(() => {
    if (!value?.more || state.loading || limit >= GRAPH_MAX) return
    const next = Math.min(GRAPH_MAX, limit + GRAPH_PAGE)
    setLimit(next)
    load(next)
  }, [value?.more, state.loading, limit, load])
  useEffect(() => {
    if (!open || !value?.more) return
    if (view.top + view.height > rows.input.length * ROW_HEIGHT - ROW_HEIGHT * 40) loadMore()
  }, [open, view, rows.input.length, value?.more, loadMore])

  useLayoutEffect(() => {
    if (!open || revealed.current || !rows.input.length) return
    revealed.current = true
    const index = selected === null ? -1 : rows.input.findIndex((commit) => commit.hash === selected)
    if (index >= 0) centerRow(index)
  }, [open, rows.input, selected, centerRow])

  if (!open) return null
  const close = onClose

  const fetch = (): void => {
    if (fetching.busy) return
    setFetching((previous) => ({ busy: true, at: previous.at }))
    window.api.git.fetch(source).then(
      () => {
        setFetching({ busy: false, at: Date.now() })
        load()
      },
      (error) => setFetching((previous) => ({ busy: false, at: previous.at, error: ipcErrorMessage(error, 'Could not fetch.') })),
    )
  }
  const changeScope = (next: GitGraphScope): void => {
    if (next === scope) return
    setScope(next)
    saveScope(next)
    setLimit(GRAPH_PAGE)
    load(GRAPH_PAGE, next)
  }
  const locateHead = (): void => {
    if (!value?.head) return
    const index = byHash.get(value.head)
    if (index === undefined) return
    setSelected(value.head)
    centerRow(index)
  }
  const jumpToMatch = (backwards: boolean): void => {
    if (!found.length) return
    const at = selected === null ? -1 : rows.input.findIndex((commit) => commit.hash === selected)
    const next = backwards
      ? [...found].reverse().find((index) => index < at) ?? found[found.length - 1]!
      : found.find((index) => index > at) ?? found[0]!
    setSelected(rows.input[next]!.hash)
    centerRow(next)
  }
  const matchPosition = selected ? found.findIndex((index) => rows.input[index]?.hash === selected) : -1

  const onListKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const total = rows.input.length
    if (!total) return
    const at = selected === null ? -1 : rows.input.findIndex((commit) => commit.hash === selected)
    const page = Math.max(1, Math.floor(view.height / ROW_HEIGHT) - 1)
    const target = event.key === 'ArrowDown' ? Math.min(total - 1, at + 1)
      : event.key === 'ArrowUp' ? Math.max(0, at - 1)
        : event.key === 'PageDown' ? Math.min(total - 1, at + page)
          : event.key === 'PageUp' ? Math.max(0, at - page)
            : event.key === 'Home' ? 0
              : event.key === 'End' ? total - 1
                : null
    if (target === null) return
    event.preventDefault()
    select(rows.input[target]!.hash)
  }

  const first = Math.max(0, Math.floor(view.top / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(rows.input.length, Math.ceil((view.top + view.height) / ROW_HEIGHT) + OVERSCAN)
  const selectedCommit = selected && selected !== WORKING ? value?.commits.find((commit) => commit.hash === selected) : undefined
  const headIndex = value?.head ? byHash.get(value.head) : undefined

  let body: JSX.Element
  if (state.error && !state.value) {
    body = (
      <p role="alert" className="flex items-center justify-center gap-2 p-6 text-xs text-danger">
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />{state.error}
      </p>
    )
  } else if (!state.value) {
    body = (
      <p role="status" className="flex items-center justify-center gap-2 p-6 text-xs text-fg-muted">
        <LoaderCircle className="h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden />Reading Git history…
      </p>
    )
  } else if (!state.value.available) {
    body = <p className="p-6 text-center text-xs text-fg-muted">{state.value.reason ?? 'Git history is not available here.'}</p>
  } else if (rows.input.length === 0) {
    body = <p className="p-6 text-center text-xs text-fg-muted">No commits yet.</p>
  } else {
    body = (
      <div className="relative" style={{ height: rows.input.length * ROW_HEIGHT + (value?.more || rows.input.length > 0 ? ROW_HEIGHT * 1.5 : 0) }}>
        {rows.input.slice(first, last).map((item, offset) => {
          const index = first + offset
          const row = rows.layout[index]!
          const isWorking = item.hash === WORKING
          const commit = isWorking ? null : item as GitGraphCommit
          const isHead = item.hash === value?.head
          const refs = refsByCommit.get(item.hash) ?? []
          const chips = refChips(refs, value?.branch ?? null, isHead && !value?.branch)
          const dim = Boolean(needle) && (isWorking || !found.includes(index))
          const isSelected = selected === item.hash
          return (
            <div
              key={item.hash}
              role="option"
              id={`git-graph-row-${item.hash}`}
              aria-selected={isSelected}
              data-testid="git-graph-row"
              data-hash={item.hash}
              data-head={isHead || undefined}
              onClick={() => {
                select(isSelected ? null : item.hash, false)
              }}
              className={cn(
                'absolute inset-x-0 flex cursor-default items-center gap-3 pr-3 text-[12.5px] transition-[background-color,opacity]',
                isSelected ? 'bg-active' : 'hover:bg-hover',
                dim && 'opacity-35',
              )}
              style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
            >
              {isSelected && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" aria-hidden />}
              <GraphCell
                row={row}
                width={graphWidth}
                kind={isWorking ? 'working' : isHead ? 'head' : commit!.parents.length > 1 ? 'merge' : 'commit'}
              />
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                {chips.map((chip) => <Chip key={chip.key} chip={chip} color={laneColor(row.color)} />)}
                {isWorking ? (
                  <span className="truncate italic text-fg-muted">
                    Uncommitted changes · {workingCount} {workingCount === 1 ? 'file' : 'files'}
                  </span>
                ) : (
                  <span className={cn('truncate', isHead ? 'font-medium text-fg' : 'text-fg/90', commit!.parents.length > 1 && 'text-fg-muted')}>
                    {commit!.subject}
                  </span>
                )}
              </div>
              {commit && (
                <>
                  <span className="hidden w-36 shrink-0 truncate text-[12px] text-fg-muted @[720px]/graph:block">{commit.author}</span>
                  <span className="hidden w-24 shrink-0 truncate text-right text-[12px] tabular-nums text-fg-subtle @[520px]/graph:block" title={new Date(commit.time * 1000).toLocaleString()}>
                    {relativeCommitTime(commit.time)}
                  </span>
                  <span className="inbox-code-font w-[4.5rem] shrink-0 text-right text-[11.5px] text-fg-subtle">{short(commit.hash)}</span>
                </>
              )}
            </div>
          )
        })}
        <div
          className="absolute inset-x-0 flex items-center justify-center text-[11.5px] text-fg-subtle"
          style={{ top: rows.input.length * ROW_HEIGHT, height: ROW_HEIGHT * 1.5 }}
        >
          {value?.more ? (
            limit >= GRAPH_MAX ? (
              <span>Showing the newest {GRAPH_MAX.toLocaleString()} commits.</span>
            ) : state.loading ? (
              <span className="flex items-center gap-2"><LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />Loading more commits…</span>
            ) : (
              <Button variant="ghost" size="sm" onClick={loadMore}>Load more commits</Button>
            )
          ) : (
            <span>Beginning of history · {(value?.commits.length ?? 0).toLocaleString()} {value?.commits.length === 1 ? 'commit' : 'commits'}</span>
          )}
        </div>
      </div>
    )
  }

  const worktreeName = value?.worktree?.split(/[\\/]/).filter(Boolean).pop()

  return (
    <div
      className="absolute inset-0 z-20 flex min-h-0 flex-col bg-bg outline-none"
      data-testid="git-graph-view"
      style={{ '--inbox-code-font': codeViewerFontFamily(family) } as CSSProperties}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        if (event.target instanceof HTMLInputElement && query) { setQuery(''); return }
        if (selected) { setSelected(null); list.current?.focus(); return }
        close()
      }}
    >
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line bg-panel pl-3 pr-1.5">
        <span className="flex shrink-0 items-center gap-2">
          <GitGraph className="h-3.5 w-3.5 text-fg-subtle" aria-hidden />
          <h2 className="text-[12.5px] font-medium text-fg">Git graph</h2>
          {worktreeName && <span className="max-w-[12rem] truncate text-[12px] text-fg-subtle" title={value?.worktree ?? undefined}>{worktreeName}</span>}
        </span>
        {value && <UpstreamSummary value={value} />}
        <span className="flex-1" />
        <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label="Close Git graph" title="Close (Esc)" onClick={close}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
        <label className="relative flex min-w-[10rem] max-w-[18rem] flex-1 items-center">
          <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-fg-subtle" aria-hidden />
          <input
            type="search"
            value={query}
            placeholder="Find commits"
            title="Find by message, author, branch, tag or hash; Enter goes to the next one"
            aria-label="Find commits"
            data-testid="git-graph-search"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); jumpToMatch(event.shiftKey) }
            }}
            className="h-7 w-full rounded border border-line bg-bg pl-7 pr-14 text-[12px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent/60"
          />
          {needle && (
            <span className="pointer-events-none absolute right-2 text-[11px] tabular-nums text-fg-subtle" aria-live="polite">
              {found.length ? `${matchPosition >= 0 ? matchPosition + 1 : '–'}/${found.length}` : 'None'}
            </span>
          )}
        </label>
        <div role="radiogroup" aria-label="Branches shown" className="flex h-7 shrink-0 items-center rounded border border-line bg-bg p-0.5">
          {SCOPES.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={scope === item.value}
              title={item.title}
              data-testid={`git-graph-scope-${item.value}`}
              onClick={() => changeScope(item.value)}
              className={cn(
                'h-full rounded-[3px] px-2 text-[11.5px] transition-colors',
                scope === item.value ? 'bg-active text-fg' : 'text-fg-muted hover:text-fg',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {fetching.at && !fetching.busy && (
          <span className="text-[11px] text-fg-subtle" data-testid="git-graph-fetched">Fetched {relativeCommitTime(fetching.at / 1000)}</span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          title="Go to HEAD"
          aria-label="Go to HEAD"
          disabled={headIndex === undefined}
          onClick={locateHead}
        >
          <Crosshair className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" title="Refresh" aria-label="Refresh Git graph" disabled={state.loading} onClick={() => load()}>
          <RefreshCw className={cn('h-3.5 w-3.5', state.loading && state.value && 'motion-safe:animate-spin')} />
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          disabled={fetching.busy || !value || value.remotes.length === 0}
          title={value && value.remotes.length === 0 ? 'This repository has no remotes' : `Fetch ${value?.remotes.join(', ') ?? 'every remote'} (git fetch --all --prune)`}
          onClick={fetch}
          data-testid="git-graph-fetch"
        >
          {fetching.busy ? <LoaderCircle className="h-3.5 w-3.5 motion-safe:animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />}
          {fetching.busy ? 'Fetching…' : 'Fetch'}
        </Button>
      </div>
      {(fetching.error || (state.error && state.value)) && (
        <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-danger/30 bg-danger/10 px-3 py-1.5 text-[12px] text-danger">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 break-words">{fetching.error ?? state.error}</span>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 hover:bg-danger/15"
            aria-label="Dismiss"
            onClick={() => {
              setFetching((previous) => ({ busy: previous.busy, at: previous.at }))
              setState((previous) => ({ value: previous.value, loading: previous.loading }))
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div
          ref={list}
          tabIndex={0}
          role="listbox"
          aria-label="Commits"
          aria-activedescendant={selected ? `git-graph-row-${selected}` : undefined}
          data-testid="git-graph-list"
          className="@container/graph min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden outline-none"
          onScroll={(event) => setView({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}
          onKeyDown={onListKey}
        >
          {body}
        </div>
        {selected === WORKING && working && renderWorking(() => { setSelected(null); list.current?.focus() })}
        {selectedCommit && (
          <CommitDetails
            source={source}
            commit={selectedCommit}
            color={laneColor(rows.layout[byHash.get(selectedCommit.hash) ?? 0]?.color ?? 0)}
            loaded={(hash) => byHash.has(hash)}
            chips={refChips(refsByCommit.get(selectedCommit.hash) ?? [], value?.branch ?? null, selectedCommit.hash === value?.head && !value?.branch)}
            onSelect={(hash) => select(hash)}
            onOpenFile={(file) => setReview({ hash: selectedCommit.hash, parents: selectedCommit.parents.length, file })}
            onClose={() => { setSelected(null); list.current?.focus() }}
          />
        )}
      </div>
      {review && (
        <ChangeDiffViewer
          identity={`${identity}\n${review.hash}`}
          file={review.file}
          note={`Commit ${short(review.hash)}, ${review.parents === 0 ? 'the first commit' : review.parents > 1 ? 'against its first parent' : 'against its parent'}.`}
          readDiff={readCommitDiff}
          onClose={() => setReview(null)}
        />
      )}
    </div>
  )
}
