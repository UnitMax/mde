import { useContext, useMemo, useState, type ReactNode } from 'react'
import {
  BookOpen,
  Check,
  Circle,
  CircleCheck,
  CircleDot,
  CircleX,
  Code,
  ExternalLink,
  FilePen,
  FileText,
  Folder,
  FolderSearch,
  Globe,
  ListChecks,
  MessageCircleQuestion,
  Search,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { ChatPart } from '@shared/types'
import { FileChangeView, useSyntaxColors } from '@/components/inbox/ChatFileChange'
import { McpCallView, Arguments } from '@/components/inbox/ChatMcpCall'
import { McpServerNamesContext } from '@/components/inbox/mcp-context'
import {
  ActivityRow,
  Chip,
  Clamped,
  CodeText,
  CopyButton,
  Label,
  Surface,
  SurfaceHeader,
  TruncatedNote,
} from '@/components/inbox/chat-ui'
import { displayPath, skillCall } from '@/lib/chat'
import {
  answeredQuestions,
  humanizeTool,
  inputNumber,
  inputText,
  markMatches,
  parseGlobOutput,
  parseGrepOutput,
  parseReadOutput,
  parseWebSearch,
  patchFileChanges,
  plural,
  searchRegExp,
  shellInfo,
  shellOutput,
  splitPath,
  todoView,
  toolInputOf,
  toolKind,
  toolPath,
  urlParts,
  type GrepView,
  type ReadLine,
  type TodoState,
} from '@/lib/chat-tools'
import { toolFileChanges, type DiffHunk } from '@/lib/diff'
import type { StyledSpan } from '@/lib/diff-highlight'
import { externalLinkUrl } from '@/lib/file-viewer'
import { argsPreview, mcpCalls, scriptDuration, scriptOf } from '@/lib/mcp'
import { cn } from '@/lib/utils'

type ToolPart = Extract<ChatPart, { kind: 'tool' }>

interface ViewProps {
  part: ToolPart
  directory: string
}

const MONO = 'inbox-code-font text-[12px]'

/** A tool that has started and not ended: it still carries a verb in the present tense. */
function finished(part: ToolPart): boolean {
  return part.status === 'completed' || part.status === 'error'
}

function testIdOf(part: ToolPart): string {
  return `chat-tool-${part.id}`
}

/** What went wrong, after the row's subject. */
function Reason({ part }: { part: ToolPart }): JSX.Element | null {
  return part.error ? <span className="text-danger"> — {part.error}</span> : null
}

function PathText({ path, directory }: { path: string; directory: string }): JSX.Element {
  const { dir, base } = splitPath(displayPath(path, directory))
  return (
    <span className={MONO} title={path}>
      <span className="text-fg-subtle">{dir}</span>
      <span className="text-fg">{base}</span>
    </span>
  )
}

function duration(part: ToolPart): ReactNode {
  return part.durationMs !== undefined && finished(part) ? <span title="How long it took">{scriptDuration(part.durationMs)}</span> : null
}

function openLink(url: string): void {
  const safe = externalLinkUrl(url)
  if (safe) window.open(safe, '_blank', 'noopener,noreferrer')
}

/** The failure of a tool, as the panel under its row shows it. */
function ErrorBlock({ text }: { text: string }): JSX.Element {
  return (
    <Surface tone="danger" testId="chat-tool-error" className="bg-danger/5">
      <p className="px-2.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-danger">Error</p>
      <CodeText text={text} className="max-h-48 pt-0.5 text-danger" />
    </Surface>
  )
}

/** The input, output and error of a tool, for the ones that have no view of their own. */
function RawDetail({ part }: { part: ToolPart }): JSX.Element {
  const outputLines = useMemo(() => (part.output ?? '').split('\n'), [part.output])
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {part.input && (
        <div className="min-w-0">
          <Label>Input</Label>
          <Surface>
            <CodeText text={part.input} className="max-h-60" />
          </Surface>
        </div>
      )}
      {part.output && (
        <div className="min-w-0">
          <Label>Output</Label>
          <Surface>
            <Clamped items={outputLines} limit={30} flush>
              {(shown) => <CodeText text={shown.join('\n')} className="max-h-80" />}
            </Clamped>
          </Surface>
        </div>
      )}
      {part.error && <ErrorBlock text={part.error} />}
      {part.truncated && <TruncatedNote />}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Commands

function ShellCall({ part, directory }: ViewProps): JSX.Element {
  const info = shellInfo(part, directory)
  const lines = info.command.split('\n')
  const output = useMemo(() => (part.output ? shellOutput(part.output) : ''), [part.output])
  const outputLines = useMemo(() => (output ? output.split('\n') : []), [output])
  const hasDetail = Boolean(info.command || output || part.error)
  return (
    <ActivityRow
      testId={testIdOf(part)}
      icon={SquareTerminal}
      status={part.status}
      failed={info.failed}
      verb={finished(part) ? 'Ran' : 'Running'}
      title={info.description ?? undefined}
      subject={(
        <>
          <span className={MONO}>{lines[0] || '…'}</span>
          {lines.length > 1 && <span className="text-fg-subtle"> …</span>}
          <Reason part={part} />
        </>
      )}
      meta={(
        <>
          {info.exitCode !== null && info.exitCode !== 0 && <Chip tone="danger" title="The exit code of the command">exit {info.exitCode}</Chip>}
          {duration(part)}
        </>
      )}
      detail={hasDetail ? (
        <Surface testId="chat-shell">
          <div className="flex items-start gap-2 px-2.5 py-1.5">
            <span aria-hidden className="inbox-code-font select-none text-[12px] leading-[1.55] text-accent">$</span>
            <pre className="inbox-code-font min-w-0 flex-1 whitespace-pre-wrap break-words text-[12px] leading-[1.55] text-fg">{info.command}</pre>
            {info.command && <CopyButton text={info.command} label="Copy command" className="mt-px" />}
          </div>
          {info.description && <p className="-mt-1 px-2.5 pb-1.5 pl-[26px] text-[11.5px] text-fg-subtle">{info.description}</p>}
          {outputLines.length > 0 && (
            <div className="group/output relative border-t border-line bg-bg">
              <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/output:opacity-100">
                <CopyButton text={output} label="Copy output" className="bg-bg/80" />
              </div>
              <Clamped items={outputLines} limit={20} flush>
                {(shown) => <CodeText text={shown.join('\n')} className="max-h-80 pr-8" />}
              </Clamped>
            </div>
          )}
          {outputLines.length === 0 && part.status === 'completed' && !part.error && (
            <p className="border-t border-line bg-bg px-2.5 py-1.5 text-[11.5px] text-fg-subtle">No output</p>
          )}
          {part.error && <CodeText text={part.error} className="max-h-48 border-t border-danger/30 bg-danger/5 text-danger" />}
          {info.exitCode !== null && info.exitCode !== 0 && !part.error && (
            <p className="border-t border-danger/30 bg-danger/5 px-2.5 py-1.5 text-[11.5px] text-danger">The command exited with code {info.exitCode}.</p>
          )}
          {part.truncated && <p className="border-t border-line px-2.5 py-1.5 text-[11px] text-fg-subtle">Shortened; the full text is in OpenCode.</p>}
        </Surface>
      ) : undefined}
    />
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Files

const READ_LINES = 24

/** Numbered lines of code, drawn as the lines of a diff are but without a change to mark. */
function CodeRows({ lines, colors }: { lines: readonly ReadLine[]; colors: StyledSpan[][] | undefined }): JSX.Element {
  const width = String(lines[lines.length - 1]?.no ?? 0).length
  return (
    <div className="overflow-x-auto" data-testid="chat-code-scroll">
      <div className="file-diff file-diff-lines py-1" data-code>
        {lines.map((line, index) => (
          <div key={line.no} className="file-diff-row" data-kind="context">
            <span className="file-diff-gutter" style={{ width: `calc(${width}ch + 1.25rem)` }}>{line.no}</span>
            <span className="file-diff-code pl-2">
              {(colors?.[index] ?? [{ text: line.text }]).map((span, spanIndex) => (
                <span key={spanIndex} style={span.style}>{span.text}</span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ReadCall({ part, directory }: ViewProps): JSX.Element {
  const path = toolPath(part)
  const input = toolInputOf(part)
  const view = useMemo(() => (part.output ? parseReadOutput(part.output) : null), [part.output])
  const hunks = useMemo<DiffHunk[]>(() => (view ? [{ lines: view.lines.map((line) => ({ kind: 'context' as const, text: line.text })) }] : []), [view])
  const colors = useSyntaxColors(path ?? '', hunks)
  const first = view?.lines[0]?.no
  const last = view?.lines[view.lines.length - 1]?.no
  const offset = inputNumber(input, 'offset')
  // Everything from the top reads as the file; a range is told.
  const range = view && first !== undefined && last !== undefined && (first > 1 || offset !== null || inputNumber(input, 'limit') !== null)
    ? `lines ${first}–${last}`
    : view ? plural(view.lines.length, 'line') : null
  const plain = useMemo(() => (part.output ?? '').split('\n'), [part.output])
  return (
    <ActivityRow
      testId={testIdOf(part)}
      icon={FileText}
      status={part.status}
      verb={finished(part) ? 'Read' : 'Reading'}
      subject={<>{path ? <PathText path={path} directory={directory} /> : <span className="text-fg-muted">a file</span>}<Reason part={part} /></>}
      meta={range ?? duration(part)}
      detail={part.output || part.error ? (
        <div className="flex min-w-0 flex-col gap-2">
          {part.output && (
            <Surface testId="chat-read">
              {view ? (
                <>
                  <SurfaceHeader actions={<CopyButton text={view.lines.map((line) => line.text).join('\n')} label="Copy text" />}>
                    <FileText aria-hidden className="h-3 w-3 shrink-0" />
                    <span className="inbox-code-font min-w-0 truncate text-fg-muted" title={path ?? undefined}>{splitPath(path ?? '').base || 'File'}</span>
                    {range && <Chip>{range}</Chip>}
                  </SurfaceHeader>
                  <div className="bg-bg">
                    <Clamped items={view.lines} limit={READ_LINES} noun="line" flush>
                      {(shown) => <CodeRows lines={shown} colors={colors?.[0]} />}
                    </Clamped>
                  </div>
                  {view.notes.length > 0 && <p className="border-t border-line px-2.5 py-1.5 text-[11.5px] text-fg-subtle">{view.notes.join(' ')}</p>}
                </>
              ) : (
                <Clamped items={plain} limit={30} flush>
                  {(shown) => <CodeText text={shown.join('\n')} className="max-h-80" />}
                </Clamped>
              )}
            </Surface>
          )}
          {part.error && <ErrorBlock text={part.error} />}
          {part.truncated && <TruncatedNote />}
        </div>
      ) : undefined}
    />
  )
}

/** A write or edit that has no diff to show (it failed, or has not begun to say what it changes). */
function FileToolCall({ part, directory }: ViewProps): JSX.Element {
  const path = toolPath(part)
  const kind = toolKind(part.name)
  const noun = kind === 'write' ? ['Wrote', 'Writing'] : kind === 'patch' ? ['Applied the patch', 'Applying the patch'] : ['Edited', 'Editing']
  return (
    <ActivityRow
      testId={testIdOf(part)}
      icon={FilePen}
      status={part.status}
      verb={finished(part) ? noun[0]! : noun[1]!}
      subject={<>{path && <PathText path={path} directory={directory} />}<Reason part={part} /></>}
      meta={duration(part)}
      detail={part.input || part.output || part.error ? <RawDetail part={part} /> : undefined}
    />
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Searching

const MATCH_LINES = 40

function GrepResults({ view, pattern, directory }: { view: GrepView; pattern: string; directory: string }): JSX.Element {
  const [limit, setLimit] = useState(MATCH_LINES)
  const regexp = useMemo(() => searchRegExp(pattern), [pattern])
  let budget = limit
  const total = view.files.reduce((sum, file) => sum + file.lines.length, 0)
  const rows = view.files.map((file) => {
    const lines = file.lines.slice(0, Math.max(0, budget))
    budget -= lines.length
    return { file, lines }
  })
  const shown = rows.reduce((sum, row) => sum + row.lines.length, 0)
  return (
    <Surface testId="chat-grep">
      {rows.map(({ file, lines }) => {
        // A file with budget left is listed even when only its name was found.
        if (lines.length === 0 && file.lines.length > 0) return null
        const width = String(Math.max(0, ...lines.map((line) => line.no ?? 0))).length
        return (
          <div key={file.path} className="border-b border-line last:border-b-0">
            <div className="flex min-w-0 items-center gap-1.5 px-2.5 py-1 text-[11.5px]">
              <FileText aria-hidden className="h-3 w-3 shrink-0 text-fg-subtle" />
              <PathText path={file.path} directory={directory} />
              {file.lines.length > 0 && <span className="ml-auto shrink-0 tabular-nums text-fg-subtle">{file.lines.length}</span>}
            </div>
            {lines.length > 0 && (
              <div className="overflow-x-auto bg-bg">
                <div className="file-diff file-diff-lines py-1">
                  {lines.map((line, index) => (
                    <div key={`${line.no}-${index}`} className="file-diff-row" data-kind="context">
                      <span className="file-diff-gutter" style={{ width: `calc(${width}ch + 1.25rem)` }}>{line.no ?? ''}</span>
                      <span className="file-diff-code pl-2">
                        {markMatches(line.text, regexp).map((run, runIndex) =>
                          run.match
                            ? <mark key={runIndex} className="rounded-sm bg-accent/25 text-fg">{run.text}</mark>
                            : <span key={runIndex}>{run.text}</span>)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
      {shown < total && (
        <button
          type="button"
          onClick={() => setLimit((value) => value + 100)}
          className="block w-full border-t border-line px-2.5 py-1.5 text-left text-[11.5px] text-accent transition-colors hover:bg-hover"
        >
          Show {plural(total - shown, 'match', 'matches')} more
        </button>
      )}
      {view.notes.length > 0 && <p className="border-t border-line px-2.5 py-1.5 text-[11.5px] text-fg-subtle">{view.notes.join(' ')}</p>}
    </Surface>
  )
}

function insideThread(path: string, directory: string): boolean {
  const trim = (value: string): string => value.replace(/[\\/]+$/, '')
  return trim(path) === trim(directory)
}

function GrepCall({ part, directory }: ViewProps): JSX.Element {
  const input = toolInputOf(part)
  const pattern = inputText(input, 'pattern', 'query') ?? ''
  const where = inputText(input, 'path')
  const include = inputText(input, 'include', 'glob')
  const view = useMemo(() => (part.output ? parseGrepOutput(part.output) : null), [part.output])
  const plain = useMemo(() => (part.output ?? '').split('\n'), [part.output])
  const matches = view?.matches
  return (
    <ActivityRow
      testId={testIdOf(part)}
      icon={Search}
      status={part.status}
      verb={finished(part) ? 'Searched' : 'Searching'}
      subject={(
        <>
          <span className={MONO}>{pattern || '…'}</span>
          {where && !insideThread(where, directory) && <span className="text-fg-subtle"> in {displayPath(where, directory)}</span>}
          {include && <span className="text-fg-subtle"> ({include})</span>}
          <Reason part={part} />
        </>
      )}
      meta={matches === 0 ? 'No matches' : matches != null ? plural(matches, 'match', 'matches') : duration(part)}
      detail={part.output || part.error ? (
        <div className="flex min-w-0 flex-col gap-2">
          {view && view.files.length > 0 && <GrepResults view={view} pattern={pattern} directory={directory} />}
          {view && view.files.length === 0 && <p className="px-1 text-[12px] text-fg-subtle">Nothing matched.</p>}
          {!view && part.output && (
            <Surface>
              <Clamped items={plain} limit={30} flush>
                {(shown) => <CodeText text={shown.join('\n')} className="max-h-80" />}
              </Clamped>
            </Surface>
          )}
          {part.error && <ErrorBlock text={part.error} />}
          {part.truncated && <TruncatedNote />}
        </div>
      ) : undefined}
    />
  )
}

function GlobCall({ part, directory }: ViewProps): JSX.Element {
  const input = toolInputOf(part)
  const pattern = inputText(input, 'pattern') ?? ''
  const where = inputText(input, 'path')
  const paths = useMemo(() => (part.output ? parseGlobOutput(part.output) : null), [part.output])
  const plain = useMemo(() => (part.output ?? '').split('\n'), [part.output])
  return (
    <ActivityRow
      testId={testIdOf(part)}
      icon={FolderSearch}
      status={part.status}
      verb={finished(part) ? 'Found files' : 'Finding files'}
      subject={(
        <>
          <span className={MONO}>{pattern || '…'}</span>
          {where && !insideThread(where, directory) && <span className="text-fg-subtle"> in {displayPath(where, directory)}</span>}
          <Reason part={part} />
        </>
      )}
      meta={paths ? (paths.length === 0 ? 'No files' : plural(paths.length, 'file')) : duration(part)}
      detail={part.output || part.error ? (
        <div className="flex min-w-0 flex-col gap-2">
          {paths && paths.length > 0 && (
            <Surface testId="chat-glob">
              <Clamped items={paths} limit={20} flush>
                {(shown) => (
                  <ul className="py-1">
                    {shown.map((path) => (
                      <li key={path} className="flex min-w-0 items-center gap-1.5 px-2.5 py-0.5 text-[12px]">
                        <FileText aria-hidden className="h-3 w-3 shrink-0 text-fg-subtle" />
                        <span className="min-w-0 truncate"><PathText path={path} directory={directory} /></span>
                      </li>
                    ))}
                  </ul>
                )}
              </Clamped>
            </Surface>
          )}
          {paths && paths.length === 0 && <p className="px-1 text-[12px] text-fg-subtle">No files matched.</p>}
          {!paths && part.output && (
            <Surface>
              <Clamped items={plain} limit={30} flush>
                {(shown) => <CodeText text={shown.join('\n')} className="max-h-80" />}
              </Clamped>
            </Surface>
          )}
          {part.error && <ErrorBlock text={part.error} />}
        </div>
      ) : undefined}
    />
  )
}

/** A listing of a folder, or any tool that answers with a block of text and nothing better to say about it. */
function ListCall({ part, directory }: ViewProps): JSX.Element {
  const path = toolPath(part)
  const lines = useMemo(() => (part.output ?? '').split('\n'), [part.output])
  return (
    <ActivityRow
      testId={testIdOf(part)}
      icon={Folder}
      status={part.status}
      verb={finished(part) ? 'Listed' : 'Listing'}
      subject={<>{path ? <PathText path={path} directory={directory} /> : <span className="text-fg-muted">files</span>}<Reason part={part} /></>}
      meta={duration(part)}
      detail={part.output || part.error ? (
        <div className="flex min-w-0 flex-col gap-2">
          {part.output && (
            <Surface>
              <Clamped items={lines} limit={30} flush>
                {(shown) => <CodeText text={shown.join('\n')} className="max-h-80" />}
              </Clamped>
            </Surface>
          )}
          {part.error && <ErrorBlock text={part.error} />}
        </div>
      ) : undefined}
    />
  )
}

// ---------------------------------------------------------------------------------------------------------------
// The web

function WebFetchCall({ part }: ViewProps): JSX.Element {
  const input = toolInputOf(part)
  const url = inputText(input, 'url')
  const parts = url ? urlParts(url) : null
  const lines = useMemo(() => (part.output ?? '').split('\n'), [part.output])
  return (
    <ActivityRow
      testId={testIdOf(part)}
      icon={Globe}
      status={part.status}
      verb={finished(part) ? 'Fetched' : 'Fetching'}
      subject={(
        <>
          {parts ? (
            <span className={MONO} title={url ?? undefined}>
              <span className="text-fg">{parts.host}</span>
              <span className="text-fg-subtle">{parts.rest}</span>
            </span>
          ) : <span className="text-fg-muted">a page</span>}
          <Reason part={part} />
        </>
      )}
      meta={duration(part)}
      detail={part.output || part.error ? (
        <div className="flex min-w-0 flex-col gap-2">
          {part.output && (
            <Surface testId="chat-webfetch">
              {url && (
                <SurfaceHeader
                  actions={(
                    <>
                      <CopyButton text={url} label="Copy address" />
                      {externalLinkUrl(url) && (
                        <button
                          type="button"
                          aria-label="Open in the browser"
                          title="Open in the browser"
                          onClick={() => openLink(url)}
                          className="flex h-5 w-5 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
                        >
                          <ExternalLink aria-hidden className="h-3 w-3" />
                        </button>
                      )}
                    </>
                  )}
                >
                  <span className="inbox-code-font min-w-0 truncate" title={url}>{url}</span>
                </SurfaceHeader>
              )}
              <Clamped items={lines} limit={16} flush>
                {(shown) => <CodeText text={shown.join('\n')} className="max-h-80" />}
              </Clamped>
            </Surface>
          )}
          {part.error && <ErrorBlock text={part.error} />}
          {part.truncated && <TruncatedNote />}
        </div>
      ) : undefined}
    />
  )
}

function WebSearchCall({ part }: ViewProps): JSX.Element {
  const query = inputText(toolInputOf(part), 'query', 'q') ?? ''
  const results = useMemo(() => (part.output ? parseWebSearch(part.output) : null), [part.output])
  const lines = useMemo(() => (part.output ?? '').split('\n'), [part.output])
  return (
    <ActivityRow
      testId={testIdOf(part)}
      icon={Globe}
      status={part.status}
      verb={finished(part) ? 'Searched the web' : 'Searching the web'}
      subject={<><span>{query || '…'}</span><Reason part={part} /></>}
      meta={results ? (results.length === 0 ? 'No results' : plural(results.length, 'result')) : duration(part)}
      detail={part.output || part.error ? (
        <div className="flex min-w-0 flex-col gap-2">
          {results && results.length > 0 && (
            <Surface testId="chat-websearch">
              <Clamped items={results} limit={6} flush>
                {(shown) => (
                  <ul className="divide-y divide-line">
                    {shown.map((result) => {
                      const { host } = urlParts(result.url)
                      const openable = externalLinkUrl(result.url) !== null
                      return (
                        <li key={result.url}>
                          <button
                            type="button"
                            disabled={!openable}
                            onClick={() => openLink(result.url)}
                            title={result.url}
                            className="block w-full min-w-0 px-2.5 py-1.5 text-left transition-colors enabled:hover:bg-hover"
                          >
                            <span className="flex min-w-0 items-baseline gap-2">
                              <span className="min-w-0 truncate text-[12.5px] font-medium text-fg">{result.title}</span>
                              <span className="shrink-0 text-[11px] text-fg-subtle">{host}</span>
                            </span>
                            {result.snippet && <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-fg-muted">{result.snippet}</span>}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Clamped>
            </Surface>
          )}
          {!results && part.output && (
            <Surface>
              <Clamped items={lines} limit={20} flush>
                {(shown) => <CodeText text={shown.join('\n')} className="max-h-80" />}
              </Clamped>
            </Surface>
          )}
          {part.error && <ErrorBlock text={part.error} />}
          {part.truncated && <TruncatedNote />}
        </div>
      ) : undefined}
    />
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Plans, questions, skills, scripts

const TODO_MARK: Record<TodoState, { icon: LucideIcon; className: string }> = {
  done: { icon: CircleCheck, className: 'text-ok' },
  active: { icon: CircleDot, className: 'text-accent' },
  pending: { icon: Circle, className: 'text-fg-subtle' },
  cancelled: { icon: CircleX, className: 'text-fg-subtle' },
}

function Progress({ done, total }: { done: number; total: number }): JSX.Element {
  return (
    <span className="flex items-center gap-1.5" title={`${done} of ${total} done`}>
      <span aria-hidden className="h-1 w-8 overflow-hidden rounded-full bg-line-strong/60">
        <span className={cn('block h-full rounded-full', done === total ? 'bg-ok' : 'bg-accent')} style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
      </span>
      <span>{done}/{total}</span>
    </span>
  )
}

function TodoCall({ part }: ViewProps): JSX.Element {
  const view = useMemo(() => todoView(part), [part.input])
  const total = view.items.length
  return (
    <ActivityRow
      testId={testIdOf(part)}
      icon={ListChecks}
      status={part.status}
      verb={finished(part) ? 'Updated the to-do list' : 'Updating the to-do list'}
      subject={<>{view.current && <><span className="text-fg-subtle">· </span><span>{view.current.text}</span></>}<Reason part={part} /></>}
      meta={total > 0 ? <Progress done={view.done} total={total} /> : duration(part)}
      detail={total > 0 || part.error ? (
        <div className="flex min-w-0 flex-col gap-2">
          {total > 0 && (
            <Surface testId="chat-todos">
              <ul className="py-1">
                {view.items.map((item, index) => {
                  const mark = TODO_MARK[item.state]
                  const Icon = mark.icon
                  return (
                    <li key={index} data-state={item.state} className="flex items-start gap-2 px-2.5 py-[3px] text-[12.5px] leading-5">
                      <Icon aria-hidden className={cn('mt-[3px] h-3.5 w-3.5 shrink-0', mark.className)} />
                      <span
                        className={cn(
                          'min-w-0 flex-1',
                          item.state === 'done' || item.state === 'cancelled' ? 'text-fg-subtle line-through decoration-fg-subtle/50' : item.state === 'active' ? 'font-medium text-fg' : 'text-fg-muted',
                        )}
                      >
                        {item.text}
                      </span>
                      {item.priority === 'high' && item.state !== 'done' && <Chip tone="danger" className="mt-0.5">high</Chip>}
                    </li>
                  )
                })}
              </ul>
            </Surface>
          )}
          {part.error && <ErrorBlock text={part.error} />}
        </div>
      ) : undefined}
    />
  )
}

/** A question the person has answered: what was asked, and what they chose. */
function AnsweredQuestions({ part }: { part: ToolPart }): JSX.Element {
  const questions = answeredQuestions(part)
  return (
    <Surface testId={testIdOf(part)} className="divide-y divide-line">
      {questions.map((entry, index) => (
        <div key={index} data-testid="chat-answered-question" className="px-3 py-2">
          <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-medium text-fg-subtle">
            <MessageCircleQuestion aria-hidden className="h-3.5 w-3.5 text-accent" />
            <span>{entry.header ?? 'Question'}</span>
          </div>
          <p className="text-[13px] leading-snug text-fg-muted">{entry.question}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {entry.answers.length > 0
              ? entry.answers.map((answer, answerIndex) => (
                <span
                  key={answerIndex}
                  className="inline-flex max-w-full items-center gap-1 rounded-md bg-accent/12 px-2 py-0.5 text-[12.5px] font-medium text-fg"
                >
                  <Check aria-hidden className="h-3 w-3 shrink-0 text-accent" />
                  <span className="min-w-0 break-words">{answer}</span>
                </span>
              ))
              : <span className="text-[12px] text-fg-subtle">No answer</span>}
          </div>
        </div>
      ))}
    </Surface>
  )
}

function QuestionCall({ part }: ViewProps): JSX.Element {
  const [first] = answeredQuestions(part)
  return (
    <ActivityRow
      testId={testIdOf(part)}
      icon={MessageCircleQuestion}
      status={part.status}
      verb={finished(part) ? 'Asked' : 'Asking'}
      subject={<>{first?.question ?? 'a question'}<Reason part={part} /></>}
      meta={duration(part)}
      detail={part.error ? <ErrorBlock text={part.error} /> : undefined}
    />
  )
}

function SkillCall({ part }: ViewProps): JSX.Element {
  const skill = skillCall(part)
  const failed = part.status === 'error'
  const body = useMemo(() => (skill.body ?? '').split('\n'), [skill.body])
  const hasDetail = Boolean(skill.body || part.output || skill.files.length > 0 || part.error)
  return (
    <ActivityRow
      testId={testIdOf(part)}
      icon={BookOpen}
      status={part.status}
      verb={failed ? 'Could not load' : finished(part) ? 'Loaded' : 'Loading'}
      subject={<>{skill.name ? `the ${skill.name} skill` : 'a skill'}<Reason part={part} /></>}
      meta={duration(part)}
      detail={hasDetail ? (
        <div className="flex min-w-0 flex-col gap-2">
          {skill.body && (
            <div className="min-w-0">
              <Label>Instructions</Label>
              <Surface>
                <Clamped items={body} limit={30} flush>
                  {(shown) => <CodeText text={shown.join('\n')} className="max-h-80" />}
                </Clamped>
              </Surface>
            </div>
          )}
          {/* Output that is not in the usual shape is shown as it came rather than hidden. */}
          {!skill.body && part.output && (
            <div className="min-w-0">
              <Label>Output</Label>
              <Surface><CodeText text={part.output} className="max-h-80" /></Surface>
            </div>
          )}
          {skill.files.length > 0 && (
            <div className="min-w-0">
              <Label>Files</Label>
              <Surface><CodeText text={skill.files.join('\n')} className="max-h-40" /></Surface>
            </div>
          )}
          {part.error && <ErrorBlock text={part.error} />}
          {part.truncated && <TruncatedNote />}
        </div>
      ) : undefined}
    />
  )
}

/** A Code Mode script that listed no calls: the script, and what it printed. */
function ScriptCall({ part }: ViewProps): JSX.Element {
  const code = scriptOf(part)
  return (
    <ActivityRow
      testId={testIdOf(part)}
      icon={Code}
      status={part.status}
      verb={finished(part) ? 'Ran a script' : 'Running a script'}
      subject={part.error ? <Reason part={part} /> : undefined}
      meta={duration(part)}
      detail={code || part.output || part.error ? (
        <div className="flex min-w-0 flex-col gap-2">
          {code && (
            <div className="min-w-0">
              <Label>Script</Label>
              <Surface><CodeText text={code} className="max-h-60" /></Surface>
            </div>
          )}
          {part.output && (
            <div className="min-w-0">
              <Label>Output</Label>
              <Surface><CodeText text={part.output} className="max-h-60" /></Surface>
            </div>
          )}
          {part.error && <ErrorBlock text={part.error} />}
          {part.truncated && <TruncatedNote />}
        </div>
      ) : undefined}
    />
  )
}

/** Code Mode's `search`, which looks up the tools of a group; or, with a pattern, a search of files. */
function LookupCall({ part }: ViewProps): JSX.Element {
  const input = toolInputOf(part)
  const group = inputText(input, 'namespace')
  const pattern = inputText(input, 'pattern', 'query')
  return (
    <ActivityRow
      testId={testIdOf(part)}
      icon={Search}
      status={part.status}
      verb={group ? (finished(part) ? 'Looked up' : 'Looking up') : finished(part) ? 'Searched' : 'Searching'}
      subject={<>{group ? `${group} tools` : <span className={MONO}>{pattern ?? '…'}</span>}<Reason part={part} /></>}
      meta={duration(part)}
      detail={part.input || part.output || part.error ? <RawDetail part={part} /> : undefined}
    />
  )
}

/** Whether the input is a JSON object, whatever it holds: an empty one has nothing to open for. */
function hasArguments(part: ToolPart): boolean {
  try {
    const value: unknown = JSON.parse(part.input)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  } catch {
    return false
  }
}

/** Any other tool: its name as words, a preview of what it was given, and the input and output when opened. */
function GenericCall({ part }: ViewProps): JSX.Element {
  const pairs = useMemo(() => toolInputOf(part), [part.input])
  return (
    <ActivityRow
      testId={testIdOf(part)}
      icon={Wrench}
      status={part.status}
      verb={humanizeTool(part.name)}
      subject={<><span className={MONO}>{argsPreview(part.input, 90)}</span><Reason part={part} /></>}
      meta={duration(part)}
      detail={Object.keys(pairs).length > 0 || (!hasArguments(part) && part.input) || part.output || part.error ? (
        <div className="flex min-w-0 flex-col gap-2">
          {Object.keys(pairs).length > 0 && (
            <div className="min-w-0">
              <Label>Input</Label>
              <Surface className="px-2.5 py-2"><Arguments input={part.input} /></Surface>
            </div>
          )}
          {Object.keys(pairs).length === 0 && part.input && (
            <div className="min-w-0">
              <Label>Input</Label>
              <Surface><CodeText text={part.input} className="max-h-60" /></Surface>
            </div>
          )}
          {part.output && (
            <div className="min-w-0">
              <Label>Output</Label>
              <Surface><CodeText text={part.output} className="max-h-80" /></Surface>
            </div>
          )}
          {part.error && <ErrorBlock text={part.error} />}
          {part.truncated && <TruncatedNote />}
        </div>
      ) : undefined}
    />
  )
}

/** One tool call of the agent, drawn the way that kind of call is best read. */
export function ToolCallView({ part, directory }: ViewProps): JSX.Element {
  const kind = toolKind(part.name)
  // A fresh fetch brings new objects with the same content; the diff is only worked out again when the content changes.
  const patches = part.patches?.map((patch) => `${patch.path}\u0000${patch.patch}`).join('\u0001')
  const changes = useMemo(
    () => (kind === 'edit' || kind === 'write' ? toolFileChanges(part) : kind === 'patch' ? patchFileChanges(part) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, part.name, part.status, part.input, patches, part.existed],
  )
  // Which of a script's calls went to an MCP server is told by the server names; the card does not wait for them.
  const servers = useContext(McpServerNamesContext)
  const calls = useMemo(
    () => mcpCalls(part, servers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [part.name, part.status, part.input, part.calls, servers],
  )
  // A failed edit keeps the plain row, which carries OpenCode's reason.
  if (changes && part.status !== 'error') return <FileChangeView part={part} changes={changes} directory={directory} />
  if (calls.length > 0) return <McpCallView part={part} calls={calls} />
  switch (kind) {
    case 'shell':
      return <ShellCall part={part} directory={directory} />
    case 'read':
      return <ReadCall part={part} directory={directory} />
    case 'edit':
    case 'write':
    case 'patch':
      return <FileToolCall part={part} directory={directory} />
    case 'grep':
      return <GrepCall part={part} directory={directory} />
    case 'glob':
      return <GlobCall part={part} directory={directory} />
    case 'list':
      return <ListCall part={part} directory={directory} />
    case 'webfetch':
      return <WebFetchCall part={part} directory={directory} />
    case 'websearch':
      return <WebSearchCall part={part} directory={directory} />
    case 'todo':
      return <TodoCall part={part} directory={directory} />
    case 'question':
      return answeredQuestions(part).some((entry) => entry.answers.length > 0) && part.status === 'completed'
        ? <AnsweredQuestions part={part} />
        : <QuestionCall part={part} directory={directory} />
    case 'skill':
      return <SkillCall part={part} directory={directory} />
    case 'execute':
      return <ScriptCall part={part} directory={directory} />
    case 'lookup':
      return <LookupCall part={part} directory={directory} />
    default:
      return <GenericCall part={part} directory={directory} />
  }
}
