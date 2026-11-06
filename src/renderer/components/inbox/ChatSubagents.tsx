import { useState } from 'react'
import { AlertTriangle, Bot, Check, ChevronRight, CircleSlash, Cpu, LoaderCircle } from 'lucide-react'
import type { ChatModel, ChatPart } from '@shared/types'
import { ChatMarkdown } from '@/components/inbox/ChatMarkdown'
import { modelKey, modelName, subagentInfo, subagentResult, type SubagentInfo } from '@/lib/chat'
import { cn } from '@/lib/utils'

type ToolPart = Extract<ChatPart, { kind: 'tool' }>

const STATE_LABEL: Record<SubagentInfo['state'], string> = {
  starting: 'Starting',
  running: 'Working',
  done: 'Done',
  interrupted: 'Stopped',
  failed: 'Failed',
}

function StateBadge({ state }: { state: SubagentInfo['state'] }): JSX.Element {
  const icon = state === 'done'
    ? <Check className="h-3.5 w-3.5" />
    : state === 'failed'
      ? <AlertTriangle className="h-3.5 w-3.5" />
      : state === 'interrupted'
        ? <CircleSlash className="h-3.5 w-3.5" />
        : <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1 text-[12px]',
        state === 'done' && 'text-ok',
        state === 'failed' && 'text-danger',
        state === 'interrupted' && 'text-fg-subtle',
        (state === 'running' || state === 'starting') && 'text-accent',
      )}
    >
      {icon}
      {STATE_LABEL[state]}
    </span>
  )
}

/** One subagent: who it is, what it was asked, and how it went. Opens to the full task and its answer. */
function SubagentCard({ part, models }: { part: ToolPart; models: readonly ChatModel[] }): JSX.Element {
  const [open, setOpen] = useState(false)
  const info = subagentInfo(part)
  const active = info.state === 'running' || info.state === 'starting'
  const title = info.title ?? (info.state === 'starting' ? 'Starting a subagent…' : 'Subagent')
  const result = part.output ? subagentResult(part.output) : ''
  const hasMore = Boolean(info.task || result || info.problem)
  const model = part.subagent?.model
  const modelLabel = model ? `${modelName(models, model)}${model.variant ? ` · ${model.variant}` : ''}` : null
  const modelDetails = model ? `${modelKey(model)}${model.variant ? `#${model.variant}` : ''}` : undefined

  return (
    <section
      data-testid={`chat-subagent-${part.id}`}
      aria-label={`Subagent: ${title}`}
      className={cn(
        'min-w-0 overflow-hidden rounded-xl border bg-panel/60 transition-colors',
        active ? 'border-accent/40' : info.state === 'failed' ? 'border-danger/40' : 'border-line',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        disabled={!hasMore}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-w-0 items-start gap-2.5 px-3 py-2.5 text-left transition-colors enabled:hover:bg-hover/60"
      >
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-active text-fg-muted">
          <Bot className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{title}</span>
            <StateBadge state={info.state} />
          </span>
          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-subtle">
            {info.agent && (
              <span className="shrink-0 rounded bg-active px-1.5 py-px font-mono text-[11px] text-fg-muted">{info.agent}</span>
            )}
            {part.subagent && (
              <span
                className="inline-flex min-w-0 max-w-full items-center gap-1 text-[11px] text-fg-muted"
                title={modelDetails ?? 'OpenCode did not provide this subagent’s model.'}
                aria-label={`Model: ${modelLabel ?? 'unavailable'}`}
              >
                <Cpu aria-hidden="true" className="h-3 w-3 shrink-0" />
                <span className="truncate">{modelLabel ?? 'Model unavailable'}</span>
              </span>
            )}
          </span>
          {!open && info.task && <span className="mt-1 block truncate text-[12px] text-fg-subtle">{info.task.replace(/\s+/g, ' ')}</span>}
        </span>
        {hasMore && (
          <ChevronRight className={cn('mt-1 h-3.5 w-3.5 shrink-0 text-fg-subtle transition-transform', open && 'rotate-90')} />
        )}
      </button>
      {active && (
        <div className="h-0.5 w-full overflow-hidden bg-line" aria-hidden="true">
          <div className="h-full w-1/3 animate-pulse rounded bg-accent/70" />
        </div>
      )}
      {open && (
        <div className="flex flex-col gap-3 border-t border-line px-3 py-3">
          {info.task && (
            <div className="min-w-0">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">Task</p>
              <p className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-fg-muted">
                {info.task}
              </p>
            </div>
          )}
          {result && (
            <div className="min-w-0">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">Result</p>
              <div className="max-h-96 overflow-auto rounded-md border border-line bg-bg px-3 py-2">
                <ChatMarkdown text={result} />
              </div>
            </div>
          )}
          {info.problem && info.state !== 'interrupted' && (
            <p role="alert" className="whitespace-pre-wrap break-words text-[12.5px] text-danger">{info.problem}</p>
          )}
          {part.truncated && <p className="text-[11px] text-fg-subtle">Shortened; the full text is in OpenCode.</p>}
        </div>
      )}
    </section>
  )
}

/** Subagents started together, shown as one block with a count. */
export function SubagentGroup({ parts, models = [] }: { parts: ToolPart[]; models?: readonly ChatModel[] }): JSX.Element {
  const states = parts.map((part) => subagentInfo(part).state)
  const running = states.filter((state) => state === 'running' || state === 'starting').length
  const label = parts.length === 1 ? 'Subagent' : `${parts.length} subagents`
  const status = running > 0
    ? `${running} working`
    : states.every((state) => state === 'done') ? 'all done' : null
  return (
    <div className="flex min-w-0 flex-col gap-1.5 py-1" data-testid="chat-subagents">
      <p className="px-0.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
        {label}
        {status && <span className="font-normal normal-case tracking-normal"> · {status}</span>}
      </p>
      {parts.map((part) => <SubagentCard key={part.id} part={part} models={models} />)}
    </div>
  )
}
