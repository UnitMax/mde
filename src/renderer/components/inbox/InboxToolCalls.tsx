import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  BookOpen,
  Bot,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Code,
  FilePen,
  FileText,
  Folder,
  FolderSearch,
  Globe,
  ListChecks,
  LoaderCircle,
  MessageCircleQuestion,
  Plug,
  Search,
  SquareTerminal,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { InboxThread } from '@shared/types'
import { Arguments, Badge, Result } from '@/components/inbox/ChatMcpCall'
import { Chip, CodeText, CopyButton, Glyph, Label, Surface, SurfaceHeader, TruncatedNote } from '@/components/inbox/chat-ui'
import { hideReverted } from '@/lib/chat'
import { shellOutput, type ToolKind } from '@/lib/chat-tools'
import { mcpKey, scriptDuration, scriptOf } from '@/lib/mcp'
import { filterTurns, toolCounts, toolTurns, type ToolEntry, type ToolFilter, type ToolTurn } from '@/lib/tool-review'
import { cn } from '@/lib/utils'
import { useInboxChat } from '@/store/inbox-chat'
import { useInboxMcp } from '@/store/inbox-mcp'

const NO_SERVERS: readonly string[] = []

const ICONS: Record<ToolKind, LucideIcon> = {
  read: FileText,
  write: FilePen,
  edit: FilePen,
  patch: FilePen,
  shell: SquareTerminal,
  grep: Search,
  glob: FolderSearch,
  list: Folder,
  webfetch: Globe,
  websearch: Globe,
  todo: ListChecks,
  question: MessageCircleQuestion,
  skill: BookOpen,
  subagent: Bot,
  execute: Code,
  lookup: Search,
  other: Wrench,
}

const FILTERS: Array<{ value: ToolFilter; label: string; title: string }> = [
  { value: 'actions', label: 'Actions', title: 'Shell commands and MCP calls: what reached beyond reading and editing files' },
  { value: 'mcp', label: 'MCP', title: 'Calls to MCP servers' },
  { value: 'failed', label: 'Failed', title: 'Calls that failed, and commands that exited with an error' },
  { value: 'all', label: 'All', title: 'Every tool call, file reads, edits, searches and questions included' },
]

const ROW = '[data-tool-row]'

/** Up and Down (and Home and End) walk the rows of the list, the way a list in a sidebar is read with the keyboard. */
function walkRows(event: ReactKeyboardEvent<HTMLElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const target = event.target as HTMLElement
  if (!target.matches(ROW)) return
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ROW))
  const at = rows.indexOf(target)
  const next = event.key === 'Home' ? rows[0]
    : event.key === 'End' ? rows[rows.length - 1]
      : rows[at + (event.key === 'ArrowDown' ? 1 : -1)]
  if (!next) return
  event.preventDefault()
  next.focus()
}

/** What an opened row shows: what went in, what came out, and what went wrong. */
function EntryDetail({ entry }: { entry: ToolEntry }): JSX.Element {
  const { part } = entry
  const script = entry.kind === 'execute' ? scriptOf(part) : null
  const output = part.output ? (entry.kind === 'shell' ? shellOutput(part.output) : part.output) : ''
  const viaMcp = entry.calls.length > 0
  return (
    <div className="flex min-w-0 flex-col gap-2.5 pb-2 pl-[26px] pr-2 pt-1" data-testid="inbox-tool-detail">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
        <span className="inbox-code-font truncate" title="The tool's name in OpenCode">{part.name}</span>
        {part.exitCode !== undefined && (
          <Chip tone={part.exitCode === 0 ? 'ok' : 'danger'} title="Exit code">exit {part.exitCode}</Chip>
        )}
        {part.durationMs !== undefined && <span className="tabular-nums">{scriptDuration(part.durationMs)}</span>}
      </div>
      {entry.calls.length > 0 && (entry.kind === 'execute' || entry.calls.length > 1) && (
        <div className="min-w-0">
          <Label>Calls</Label>
          <div className="flex min-w-0 flex-col gap-2">
            {entry.calls.map((call, index) => (
              <div key={index} data-testid="inbox-tool-subcall" className="min-w-0">
                <div className="mb-1 flex min-w-0 items-center gap-1.5 text-[12px]">
                  <Glyph icon={Plug} status={call.status} />
                  <Badge call={call} />
                  <span className="truncate font-medium text-fg">{call.tool}</span>
                </div>
                <div className="ml-5"><Arguments input={call.input} /></div>
              </div>
            ))}
          </div>
        </div>
      )}
      {script && (
        <div className="min-w-0">
          <Surface>
            <SurfaceHeader actions={<CopyButton text={script} label="Copy script" />}>Script</SurfaceHeader>
            <CodeText text={script} className="max-h-60" />
          </Surface>
        </div>
      )}
      {!script && part.input && part.input !== '{}' && (
        <div className="min-w-0">
          <Surface>
            <SurfaceHeader actions={<CopyButton text={part.input} label="Copy input" />}>Input</SurfaceHeader>
            <div className="max-h-72 overflow-auto px-2.5 py-2"><Arguments input={part.input} /></div>
          </Surface>
        </div>
      )}
      {output && (viaMcp ? <Result text={output} /> : (
        <div className="min-w-0">
          <Surface>
            <SurfaceHeader actions={<CopyButton text={output} label="Copy output" />}>Output</SurfaceHeader>
            <CodeText text={output} className="max-h-80" testId="inbox-tool-output" />
          </Surface>
        </div>
      ))}
      {part.error && (
        <Surface tone="danger" className="bg-danger/5">
          <SurfaceHeader className="text-danger" actions={<CopyButton text={part.error} label="Copy error" />}>Error</SurfaceHeader>
          <CodeText text={part.error} className="max-h-48 text-danger" />
        </Surface>
      )}
      {!output && !part.error && !entry.active && <p className="text-[11.5px] text-fg-subtle">No output.</p>}
      {part.truncated && <TruncatedNote />}
    </div>
  )
}

function EntryRow({ entry, open, onToggle }: { entry: ToolEntry; open: boolean; onToggle: () => void }): JSX.Element {
  const { part } = entry
  const direct = entry.kind !== 'execute' && entry.calls.length === 1 ? entry.calls[0]! : null
  const icon = entry.calls.length > 0 ? Plug : ICONS[entry.kind]
  const time = part.durationMs !== undefined ? scriptDuration(part.durationMs) : ''
  return (
    <li data-testid={`inbox-tool-${part.id}`} data-status={part.status} data-failed={entry.failed || undefined} className="min-w-0">
      <button
        type="button"
        data-tool-row
        aria-expanded={open}
        onClick={onToggle}
        title={entry.subject || entry.title}
        className={cn(
          'group/row flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-[5px] text-left text-[12.5px] leading-5 transition-colors',
          'hover:bg-hover/70 focus-visible:bg-hover/70 focus-visible:outline-none',
          open && 'bg-hover/50',
        )}
      >
        <Glyph icon={icon} status={part.status} failed={entry.failed} />
        {direct && (
          <Chip tone={direct.server ? 'accent' : 'neutral'} title={direct.server ? `MCP server ${direct.server}` : direct.namespace} className="max-w-[35%] px-1 text-[10.5px]">
            <span className="truncate">{direct.server ?? direct.namespace}</span>
          </Chip>
        )}
        <span className={cn('font-medium', direct ? 'min-w-0 truncate' : 'shrink-0', entry.failed ? 'text-danger' : 'text-fg-muted', entry.active && 'chat-shimmer')}>
          {entry.title}
        </span>
        {entry.kind === 'execute' && entry.calls.length > 0 && (
          <Chip tone={entry.mcp ? 'accent' : 'neutral'} className="px-1 text-[10.5px]">{entry.calls.length}</Chip>
        )}
        <span className={cn('inbox-code-font min-w-0 flex-1 basis-0 truncate text-[11.5px]', entry.failed ? 'text-danger/80' : 'text-fg-subtle group-hover/row:text-fg-muted')}>
          {entry.subject}
        </span>
        {time && <span className="shrink-0 pl-1 text-[11px] tabular-nums text-fg-subtle">{time}</span>}
        <ChevronRight
          aria-hidden
          className={cn('h-3.5 w-3.5 shrink-0 text-fg-subtle transition-transform duration-150', open ? 'rotate-90' : 'opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100')}
        />
      </button>
      {open && <EntryDetail entry={entry} />}
    </li>
  )
}

function TurnSection({
  turn,
  folded,
  onFold,
  opened,
  onOpen,
}: {
  turn: ToolTurn
  folded: boolean
  onFold: () => void
  opened: ReadonlySet<string>
  onOpen: (id: string) => void
}): JSX.Element {
  const failed = turn.entries.filter((entry) => entry.failed).length
  return (
    <section data-testid={`inbox-tool-turn-${turn.id}`} aria-label={turn.prompt ? `Turn ${turn.number}: ${turn.prompt}` : 'Earlier calls'} className="min-w-0">
      <button
        type="button"
        data-tool-row
        aria-expanded={!folded}
        onClick={onFold}
        title={turn.prompt ?? 'Calls before the first loaded message'}
        className="sticky top-0 z-10 flex w-full min-w-0 items-center gap-2 border-b border-line/60 bg-panel/95 px-3 py-1.5 text-left backdrop-blur transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
      >
        <ChevronRight aria-hidden className={cn('h-3 w-3 shrink-0 text-fg-subtle transition-transform duration-150', !folded && 'rotate-90')} />
        {turn.number > 0 && <span className="shrink-0 text-[10.5px] font-semibold tabular-nums text-fg-subtle">#{turn.number}</span>}
        <span className="min-w-0 flex-1 truncate text-[12px] text-fg">{turn.prompt ?? 'Earlier calls'}</span>
        {failed > 0 && <Chip tone="danger" className="px-1 text-[10.5px]" title={`${failed} failed`}>{failed}</Chip>}
        <span className="shrink-0 text-[11px] tabular-nums text-fg-subtle" title={`${turn.entries.length} tool calls`}>{turn.entries.length}</span>
      </button>
      {!folded && (
        <ul className="flex min-w-0 flex-col px-1.5 py-1">
          {turn.entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} open={opened.has(entry.id)} onToggle={() => onOpen(entry.id)} />
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * The Tools tab of a GUI thread: every tool call the agent made, MCP ones included, under the message it answered.
 * The list can be narrowed to MCP calls or failures and searched; a row opens onto its input, output and error.
 */
export function InboxToolCalls({ thread }: { thread: InboxThread }): JSX.Element {
  const state = useInboxChat((store) => store.threads[thread.id])
  const loadOlder = useInboxChat((store) => store.loadOlder)
  const servers = useInboxMcp((store) => store.entries[mcpKey(thread.target, thread.directory)]?.names) ?? NO_SERVERS
  const [filter, setFilter] = useState<ToolFilter>('actions')
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const messages = state?.messages
  const revert = state?.revert
  const turns = useMemo(
    () => toolTurns(hideReverted(messages ?? [], revert), servers, thread.directory),
    [messages, revert, servers, thread.directory],
  )
  const counts = useMemo(() => toolCounts(turns), [turns])
  const shown = useMemo(() => filterTurns(turns, filter, query), [turns, filter, query])
  const searching = query.trim() !== ''
  // Another thread starts with its own list, nothing opened or folded.
  useEffect(() => {
    setOpened(new Set())
    setFolded(new Set())
    setQuery('')
    setFilter('actions')
  }, [thread.id])
  const toggle = (set: ReadonlySet<string>, id: string): Set<string> => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }
  const allOpen = shown.length > 0 && shown.every((turn) => turn.entries.every((entry) => opened.has(entry.id)))
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="inbox-tools-list">
      <div className="flex shrink-0 flex-col gap-2 border-b border-line px-3 py-2">
        {/* Expand all sits beside the search box, whose input gives way to it: the filters below need the whole
            width of a narrow sidebar. */}
        <div className="flex min-w-0 items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
          <input
            type="search"
            value={query}
            aria-label="Search tool calls"
            placeholder="Search tools, files, commands…"
            data-testid="inbox-tools-search"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query) {
                event.stopPropagation()
                setQuery('')
              }
            }}
            className="h-7 w-full min-w-0 rounded-md border border-line bg-bg pl-7 pr-7 text-[12px] text-fg placeholder:text-fg-subtle focus:border-accent/60 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded text-fg-subtle hover:bg-hover hover:text-fg"
            >
              <X aria-hidden className="h-3 w-3" />
            </button>
          )}
        </div>
          <button
            type="button"
            aria-label={allOpen ? 'Collapse all calls' : 'Expand all calls'}
            title={allOpen ? 'Collapse all calls' : 'Expand all calls'}
            disabled={shown.length === 0}
            onClick={() => setOpened(allOpen ? new Set() : new Set(shown.flatMap((turn) => turn.entries.map((entry) => entry.id))))}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40"
          >
            {allOpen ? <ChevronsDownUp aria-hidden className="h-3.5 w-3.5" /> : <ChevronsUpDown aria-hidden className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className="flex min-w-0 items-center">
          <div role="radiogroup" aria-label="Show" className="flex min-w-0 flex-1 items-center gap-0.5 rounded-md bg-fg/5 p-0.5">
            {FILTERS.map((item) => {
              const count = counts[item.value]
              const selected = filter === item.value
              return (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  title={item.title}
                  data-testid={`inbox-tools-filter-${item.value}`}
                  onClick={() => setFilter(item.value)}
                  className={cn(
                    // Sized by what each says and sharing the row, so the four fit the narrowest sidebar.
                    'flex min-w-0 flex-auto items-center justify-center gap-1 whitespace-nowrap rounded px-1 py-0.5 text-[11.5px] transition-colors',
                    selected ? 'bg-panel text-fg shadow-sm' : 'text-fg-subtle hover:text-fg-muted',
                  )}
                >
                  <span className="min-w-0 truncate">{item.label}</span>
                  <span className={cn('shrink-0 tabular-nums text-[10.5px]', item.value === 'failed' && count > 0 ? 'text-danger' : 'text-fg-subtle')}>{count}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" onKeyDown={walkRows}>
        {state?.older && (
          <div className="px-3 py-2">
            <button
              type="button"
              data-testid="inbox-tools-load-older"
              disabled={state.loadingOlder}
              onClick={() => void loadOlder(thread.id)}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line px-2 py-1.5 text-[11.5px] text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-60"
            >
              {state.loadingOlder && <LoaderCircle aria-hidden className="h-3 w-3 motion-safe:animate-spin" />}
              Load earlier messages for more calls
            </button>
          </div>
        )}
        {!state || (state.loading && turns.length === 0) ? (
          <p role="status" className="flex items-center gap-2 px-3 py-4 text-[12px] text-fg-muted">
            <LoaderCircle aria-hidden className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" />
            Loading tool calls…
          </p>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="inbox-tools-empty">
            <Wrench aria-hidden className="h-5 w-5 text-fg-subtle" />
            <p className="text-[12.5px] text-fg-muted">
              {searching ? 'No tool calls match.'
                : counts.all === 0 ? 'No tool calls yet.'
                  : filter === 'actions' ? 'No commands or MCP calls yet.'
                    : filter === 'mcp' ? 'No MCP calls yet.' : 'No failed calls.'}
            </p>
            <p className="text-[11.5px] text-fg-subtle">
              {searching ? 'Try another search.'
                : counts.all === 0 ? 'Commands the agent runs and MCP tools it calls are listed here.' : null}
            </p>
            {filter !== 'all' && counts.all > 0 && (
              <button
                type="button"
                data-testid="inbox-tools-show-all"
                onClick={() => setFilter('all')}
                className="text-[11.5px] text-accent hover:underline"
              >
                Show all {counts.all} {counts.all === 1 ? 'call' : 'calls'}
              </button>
            )}
          </div>
        ) : (
          shown.map((turn) => (
            <TurnSection
              key={turn.id}
              turn={turn}
              folded={folded.has(turn.id)}
              onFold={() => setFolded((current) => toggle(current, turn.id))}
              opened={opened}
              onOpen={(id) => setOpened((current) => toggle(current, id))}
            />
          ))
        )}
      </div>
    </div>
  )
}
