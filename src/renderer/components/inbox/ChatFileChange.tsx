import { useEffect, useMemo, useState } from 'react'
import { FilePen, FilePlus, FileX, type LucideIcon } from 'lucide-react'
import type { ChatPart } from '@shared/types'
import { ActivityRow, TruncatedNote } from '@/components/inbox/chat-ui'
import { displayPath } from '@/lib/chat'
import { splitPath } from '@/lib/chat-tools'
import { emphasisIn, type DiffHunk, type FileChange } from '@/lib/diff'
import { highlightHunks, withEmphasis, type StyledSpan } from '@/lib/diff-highlight'
import { cn } from '@/lib/utils'

type ToolPart = Extract<ChatPart, { kind: 'tool' }>

/** A diff longer than this starts cut short, with the rest a click away. */
export const DIFF_LONG_LINES = 40
export const DIFF_SHORT_LINES = 28

const VERBS: Record<FileChange['action'], { doing: string; done: string }> = {
  edit: { doing: 'Editing', done: 'Edited' },
  create: { doing: 'Creating', done: 'Created' },
  overwrite: { doing: 'Overwriting', done: 'Overwrote' },
  write: { doing: 'Writing', done: 'Wrote' },
  delete: { doing: 'Deleting', done: 'Deleted' },
}

const ICONS: Record<FileChange['action'], LucideIcon> = {
  edit: FilePen,
  create: FilePlus,
  overwrite: FilePen,
  write: FilePen,
  delete: FileX,
}

/** Colors for the lines of a diff, once the file's language has loaded; the diff shows plain until then. */
export function useSyntaxColors(path: string, hunks: readonly DiffHunk[]): StyledSpan[][][] | null {
  const [colors, setColors] = useState<StyledSpan[][][] | null>(null)
  useEffect(() => {
    let current = true
    void highlightHunks(path, hunks).then((result) => {
      if (current) setColors(result)
    })
    return () => {
      current = false
    }
  }, [path, hunks])
  return colors
}

function lineNumber(line: DiffHunk['lines'][number]): number | undefined {
  return line.kind === 'del' ? line.oldNo : line.newNo
}

/**
 * The lines of a change. `bare` is for a diff that hangs from a row of the conversation: no padding of its own, so that
 * the tint of a changed line reaches the edge of the block, which is rounded instead of boxed in.
 */
export function DiffBody({
  change,
  expanded,
  onExpand,
  bare = false,
}: {
  change: FileChange
  expanded: boolean
  onExpand: () => void
  bare?: boolean
}): JSX.Element {
  const colors = useSyntaxColors(change.path, change.hunks)
  const marks = useMemo(() => change.hunks.map(emphasisIn), [change.hunks])
  const total = change.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0)
  const limit = expanded || total <= DIFF_LONG_LINES ? Infinity : DIFF_SHORT_LINES
  const width = change.numbered
    ? String(Math.max(0, ...change.hunks.flatMap((hunk) => hunk.lines.map((line) => lineNumber(line) ?? 0)))).length
    : 0

  if (total === 0) {
    return <p className={cn('text-[12px] text-fg-subtle', bare ? 'px-1 py-1' : 'px-3 py-2')}>{change.action === 'delete' ? 'The file was deleted' : 'Empty file'}</p>
  }

  let shown = 0
  return (
    <>
      <div className={cn('overflow-x-auto', bare && 'rounded-md')} data-testid="chat-diff-scroll">
        <div className={cn('file-diff file-diff-lines', !bare && 'py-1')} data-quiet={change.action === 'edit' ? undefined : ''}>
          {change.hunks.map((hunk, hunkIndex) => {
            if (shown >= limit) return null
            const lines = hunk.lines.slice(0, limit - shown)
            shown += lines.length
            return (
              <div key={hunkIndex}>
                {hunkIndex > 0 && <div className="file-diff-gap" aria-hidden>⋯</div>}
                {lines.map((line, lineIndex) => {
                  const spans = withEmphasis(colors?.[hunkIndex]?.[lineIndex] ?? [{ text: line.text }], marks[hunkIndex]?.get(lineIndex))
                  const number = lineNumber(line)
                  return (
                    <div key={lineIndex} className="file-diff-row" data-kind={line.kind}>
                      {change.numbered && (
                        <span className="file-diff-gutter" style={{ width: `calc(${width}ch + 1rem)` }}>{number ?? ''}</span>
                      )}
                      <span className="file-diff-sign" aria-hidden>{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}</span>
                      <span className="file-diff-code">
                        {spans.map((span, spanIndex) => (
                          <span key={spanIndex} style={span.style} className={span.emphasis ? 'file-diff-emphasis' : undefined}>{span.text}</span>
                        ))}
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      {total > shown && (
        <button
          type="button"
          onClick={onExpand}
          className={cn(
            'w-full text-left text-[12px] text-accent transition-colors',
            bare ? 'mt-0.5 rounded-md px-2 py-1.5 hover:bg-hover/70' : 'border-t border-line px-3 py-1.5 hover:bg-hover',
          )}
        >
          Show {total - shown} more {total - shown === 1 ? 'line' : 'lines'}
        </button>
      )}
    </>
  )
}

/**
 * One file's change, as a row like any other step (what was done to which file, how many lines) with the diff open
 * under it, hung from the rail. The row shuts the diff, and a long diff starts cut short.
 */
function FileDiffCard({ change, status, directory }: { change: FileChange; status: ToolPart['status']; directory: string }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const shown = displayPath(change.path, directory)
  const { dir, base } = splitPath(shown)
  const verb = VERBS[change.action][status === 'completed' ? 'done' : 'doing']
  return (
    <ActivityRow
      testId="chat-diff"
      attrs={{ 'data-path': change.path }}
      label={`${verb} ${shown}`}
      icon={ICONS[change.action]}
      status={status}
      verb={verb}
      subject={
        <span className="inbox-code-font text-[12px]" title={change.path}>
          <span className="text-fg-subtle">{dir}</span>
          {base}
        </span>
      }
      meta={
        (change.additions > 0 || change.deletions > 0) && (
          <span className="inbox-code-font flex items-center gap-2" data-testid="chat-diff-stats">
            {change.additions > 0 && <span className="text-ok">+{change.additions}</span>}
            {change.deletions > 0 && <span className="text-danger">−{change.deletions}</span>}
          </span>
        )
      }
      defaultOpen
      detail={<DiffBody bare change={change} expanded={expanded} onExpand={() => setExpanded(true)} />}
    />
  )
}

/** What an edit, write or patch tool changed, drawn as diffs: one row, with its diff, per file. */
export function FileChangeView({
  part,
  changes,
  directory,
}: {
  part: ToolPart
  changes: FileChange[]
  directory: string
}): JSX.Element {
  return (
    <div data-testid={`chat-tool-${part.id}`} className="flex min-w-0 flex-col">
      {changes.map((change) => (
        <FileDiffCard key={change.path} change={change} status={part.status} directory={directory} />
      ))}
      {part.truncated && <TruncatedNote />}
    </div>
  )
}
