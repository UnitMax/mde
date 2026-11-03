import { useEffect, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ChatPart } from '@shared/types'
import { ToolIcon } from '@/components/inbox/ToolIcon'
import { displayPath } from '@/lib/chat'
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
}

/** Colors for the lines of a diff, once the file's language has loaded; the diff shows plain until then. */
function useSyntaxColors(path: string, hunks: readonly DiffHunk[]): StyledSpan[][][] | null {
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

export function DiffBody({ change, expanded, onExpand }: { change: FileChange; expanded: boolean; onExpand: () => void }): JSX.Element {
  const colors = useSyntaxColors(change.path, change.hunks)
  const marks = useMemo(() => change.hunks.map(emphasisIn), [change.hunks])
  const total = change.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0)
  const limit = expanded || total <= DIFF_LONG_LINES ? Infinity : DIFF_SHORT_LINES
  const width = change.numbered
    ? String(Math.max(0, ...change.hunks.flatMap((hunk) => hunk.lines.map((line) => lineNumber(line) ?? 0)))).length
    : 0

  if (total === 0) return <p className="px-3 py-2 text-[12px] text-fg-subtle">Empty file</p>

  let shown = 0
  return (
    <>
      <div className="overflow-x-auto" data-testid="chat-diff-scroll">
        <div className="file-diff file-diff-lines py-1" data-quiet={change.action === 'edit' ? undefined : ''}>
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
          className="w-full border-t border-line px-3 py-1.5 text-left text-[12px] text-accent transition-colors hover:bg-hover"
        >
          Show {total - shown} more {total - shown === 1 ? 'line' : 'lines'}
        </button>
      )}
    </>
  )
}

function FileDiffCard({ change, status, directory }: { change: FileChange; status: ToolPart['status']; directory: string }): JSX.Element {
  const [open, setOpen] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const shown = displayPath(change.path, directory)
  const split = Math.max(shown.lastIndexOf('/'), shown.lastIndexOf('\\')) + 1
  const verb = VERBS[change.action][status === 'completed' ? 'done' : 'doing']
  return (
    <section
      data-testid="chat-diff"
      data-path={change.path}
      className="min-w-0 overflow-hidden rounded-lg border border-line bg-bg"
      aria-label={`${verb} ${shown}`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-w-0 items-center gap-1.5 bg-panel px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-hover"
      >
        <ChevronRight className={cn('h-3 w-3 shrink-0 text-fg-subtle transition-transform', open && 'rotate-90')} />
        <ToolIcon status={status} />
        <span className="shrink-0 text-fg-muted">{verb}</span>
        <span className="inbox-code-font min-w-0 flex-1 truncate text-[11.5px]" title={change.path}>
          <span className="text-fg-subtle">{shown.slice(0, split)}</span>
          <span className="text-fg">{shown.slice(split)}</span>
        </span>
        <span className="inbox-code-font flex shrink-0 items-center gap-2 text-[11.5px] tabular-nums" data-testid="chat-diff-stats">
          {change.additions > 0 && <span className="text-ok">+{change.additions}</span>}
          {change.deletions > 0 && <span className="text-danger">−{change.deletions}</span>}
        </span>
      </button>
      {open && (
        <div className="border-t border-line">
          <DiffBody change={change} expanded={expanded} onExpand={() => setExpanded(true)} />
        </div>
      )}
    </section>
  )
}

/** What an edit or write tool changed, drawn as diffs: one card per file. */
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
    <div data-testid={`chat-tool-${part.id}`} className="flex min-w-0 flex-col gap-1.5">
      {changes.map((change) => (
        <FileDiffCard key={change.path} change={change} status={part.status} directory={directory} />
      ))}
      {part.truncated && <p className="px-1.5 text-[11px] text-fg-subtle">Shortened; the full text is in OpenCode.</p>}
    </div>
  )
}
