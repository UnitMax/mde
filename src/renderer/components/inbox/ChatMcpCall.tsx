import { useMemo, useState } from 'react'
import { ChevronRight, Code, Plug } from 'lucide-react'
import type { ChatPart } from '@shared/types'
import { ActivityRow, Glyph, TruncatedNote } from '@/components/inbox/chat-ui'
import { ChatMarkdown } from '@/components/inbox/ChatMarkdown'
import {
  argsPreview,
  callArguments,
  highlightJson,
  inlineAnswer,
  resultView,
  scriptDuration,
  scriptOf,
  type JsonToken,
  type McpCall,
} from '@/lib/mcp'
import { cn } from '@/lib/utils'

type ToolPart = Extract<ChatPart, { kind: 'tool' }>

/** A result longer than this many lines is cut, with a button for the rest. */
const RESULT_LINES = 12

const TOKEN_CLASS: Record<JsonToken['kind'], string> = {
  key: 'text-syntax-property',
  string: 'text-syntax-string',
  number: 'text-syntax-number',
  literal: 'text-syntax-keyword',
  punct: 'text-fg-subtle',
  space: '',
}

/** The group a call went to: an MCP server, marked with a plug, or one of OpenCode's own tool groups. */
function Badge({ call }: { call: McpCall }): JSX.Element {
  const known = call.server !== null
  const Icon = known ? Plug : Code
  const name = call.server ?? (call.namespace || 'tool')
  return (
    <span
      title={known ? `MCP server ${name}` : `OpenCode tools: ${name}`}
      data-kind={known ? 'mcp' : 'builtin'}
      className={cn(
        'inline-flex max-w-[40%] shrink-0 items-center gap-1 rounded px-1.5 py-px text-[11px] font-medium',
        known ? 'bg-accent/10 text-accent' : 'bg-hover text-fg-muted',
      )}
    >
      <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  )
}

function Block({ label, children, tone }: { label: string; children: React.ReactNode; tone?: 'danger' }): JSX.Element {
  return (
    <div className="min-w-0">
      <p className={cn('mb-0.5 text-[10px] font-medium uppercase tracking-wide', tone === 'danger' ? 'text-danger' : 'text-fg-subtle')}>{label}</p>
      {children}
    </div>
  )
}

const PRE = 'inbox-code-font overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-bg px-2.5 py-2 text-[12px] leading-snug'

export function Arguments({ input }: { input: string }): JSX.Element | null {
  const pairs = callArguments(input)
  if (!pairs) return input ? <pre className={cn(PRE, 'max-h-40 text-fg-muted')}>{input}</pre> : null
  if (pairs.length === 0) return <p className="text-[12px] text-fg-subtle">No arguments</p>
  return (
    <dl className="inbox-code-font grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12px] leading-snug">
      {pairs.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-syntax-property">{key}</dt>
          <dd className="min-w-0 whitespace-pre-wrap break-words text-fg-muted">
            {typeof value === 'string' ? value : JSON.stringify(value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function ResultText({ text, json }: { text: string; json: boolean }): JSX.Element {
  const [all, setAll] = useState(false)
  const lines = text.split('\n')
  const cut = !all && lines.length > RESULT_LINES
  const shown = cut ? lines.slice(0, RESULT_LINES).join('\n') : text
  const tokens = useMemo(() => (json ? highlightJson(shown) : null), [json, shown])
  return (
    <>
      <pre className={cn(PRE, 'max-h-80 text-fg-muted')}>
        {tokens
          ? tokens.map((token, index) => <span key={index} className={TOKEN_CLASS[token.kind]}>{token.text}</span>)
          : shown}
      </pre>
      {cut && (
        <button type="button" onClick={() => setAll(true)} className="mt-1 text-[12px] text-accent hover:underline">
          Show {lines.length - RESULT_LINES} more {lines.length - RESULT_LINES === 1 ? 'line' : 'lines'}
        </button>
      )}
    </>
  )
}

function Result({ text }: { text: string }): JSX.Element {
  const view = useMemo(() => resultView(text), [text])
  return (
    <Block label="Result">
      <div data-testid="chat-mcp-result" data-kind={view.kind} className="min-w-0">
        {view.kind === 'markdown'
          ? <div className="max-h-80 overflow-auto rounded-md border border-line bg-bg px-3 py-2"><ChatMarkdown text={view.text} /></div>
          : <ResultText text={view.text} json={view.kind === 'json'} />}
      </div>
    </Block>
  )
}

function Script({ code }: { code: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 text-[11px] text-fg-subtle transition-colors hover:text-fg-muted"
      >
        <ChevronRight aria-hidden="true" className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
        Script
      </button>
      {open && <pre data-testid="chat-mcp-script" className={cn(PRE, 'mt-1 max-h-60 text-fg-muted')}>{code}</pre>}
    </div>
  )
}

/**
 * Tools OpenCode ran for the agent through a Code Mode script (or, for a server whose Code Mode is off, directly):
 * which server and tool, with what arguments, how it went, and the result. The script's result and time are the
 * whole script's, because OpenCode reports no more than that per call. Collapsed, a single call reads as one line;
 * a script that made several says how many and which servers.
 */
export function McpCallView({ part, calls }: { part: ToolPart; calls: McpCall[] }): JSX.Element {
  const [first] = calls
  const code = scriptOf(part)
  const servers = [...new Set(calls.map((call) => call.server ?? call.namespace).filter(Boolean))]
  const answer = calls.length === 1 && part.status === 'completed' && part.output ? inlineAnswer(part.output) : null
  const duration = part.durationMs !== undefined ? scriptDuration(part.durationMs) : ''
  const done = part.status === 'completed' || part.status === 'error'
  const single = first && calls.length === 1
  return (
    <ActivityRow
      testId={`chat-tool-${part.id}`}
      icon={Plug}
      status={part.status}
      verb={single ? (done ? 'Called' : 'Calling') : `${done ? 'Called' : 'Calling'} ${calls.length} tools`}
      subject={single ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <Badge call={first} />
          <span className="shrink-0 font-medium">{first.tool}</span>
          <span className="inbox-code-font min-w-0 truncate text-[11.5px] text-fg-muted">{argsPreview(first.input)}</span>
          {answer && <span className="inbox-code-font max-w-[45%] shrink-0 truncate text-[11.5px]" title={answer}>→ {answer}</span>}
          {part.error && <span className="min-w-0 truncate text-danger"> — {part.error}</span>}
        </span>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-fg-muted">{servers.join(', ')}</span>
          {part.error && <span className="min-w-0 truncate text-danger"> — {part.error}</span>}
        </span>
      )}
      meta={duration ? <span title="How long the script ran">{duration}</span> : undefined}
      attrs={{ 'data-mcp-calls': calls.length }}
      detail={(
        <div className="flex min-w-0 flex-col gap-2.5">
          {calls.map((call, index) => (
            <div key={index} data-testid="chat-mcp-call" className="min-w-0">
              <div className="mb-1 flex min-w-0 items-center gap-1.5 text-[12px]">
                <Glyph icon={Plug} status={call.status} />
                <Badge call={call} />
                <span className="font-medium text-fg">{call.tool}</span>
              </div>
              <div className="ml-5"><Arguments input={call.input} /></div>
            </div>
          ))}
          {part.output && <Result text={part.output} />}
          {part.error && (
            <Block label="Error" tone="danger">
              <pre className={cn(PRE, 'max-h-40 border-danger/40 text-danger')}>{part.error}</pre>
            </Block>
          )}
          {part.truncated && <TruncatedNote />}
          {code && <Script code={code} />}
        </div>
      )}
    />
  )
}
