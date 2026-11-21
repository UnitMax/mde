import { CircleSlash, Split } from 'lucide-react'
import type { ChatModel, ChatPart, ChatToolStatus } from '@shared/types'
import { ElapsedTime } from '@/components/ElapsedTime'
import { ChatMarkdown } from '@/components/inbox/ChatMarkdown'
import { ProviderMark } from '@/components/inbox/ProviderMark'
import { ActivityRow, Glyph, Rail } from '@/components/inbox/chat-ui'
import { formatDuration } from '@/lib/duration'
import { findModel, modelKey, modelName, subagentAnswer, subagentDuration, subagentInfo, type SubagentInfo } from '@/lib/chat'
import { cn } from '@/lib/utils'

type ToolPart = Extract<ChatPart, { kind: 'tool' }>

/** How each state draws: the row spins while it works and turns red on failure; done needs no word. */
const ROW_STATUS: Record<SubagentInfo['state'], ChatToolStatus> = {
  starting: 'pending',
  running: 'running',
  done: 'completed',
  interrupted: 'completed',
  failed: 'error',
  unreported: 'completed',
}

/** The kind of subagent and that it is one: OpenCode's agent name alone ("general") does not say it is a subagent. */
export function subagentLabel(agent: string | null): string {
  if (!agent) return 'Subagent'
  return `${agent.charAt(0).toUpperCase()}${agent.slice(1)} subagent`
}

/** A task as one plain line: the model writes it for the model, with Markdown code marks and line breaks. */
function taskLine(task: string): string {
  return task.replace(/`+/g, '').replace(/\s+/g, ' ').trim()
}

/** The small print at the right: the model, then how long it has run or ran. */
function SubagentMeta({ part, info, models }: { part: ToolPart; info: SubagentInfo; models: readonly ChatModel[] }): JSX.Element | null {
  const model = part.subagent?.model
  const modelLabel = model ? `${modelName(models, model)}${model.variant ? ` · ${model.variant}` : ''}` : null
  const modelDetails = model ? `${modelKey(model)}${model.variant ? `#${model.variant}` : ''}` : undefined
  const provider = model ? findModel(models, model)?.providerName : undefined
  const duration = subagentDuration(part)
  const time = info.state === 'running'
    ? <ElapsedTime since={part.startedAt ?? null} />
    : duration !== undefined && info.state !== 'starting'
      ? <span>{formatDuration(duration)}</span>
      : null
  const items = [
    part.subagent && (
      <span key="model" className="flex min-w-0 items-center gap-1.5">
        {/* The provider is its lettered badge, as in the model picker; its full name is in the tooltip. */}
        {model && <span className="flex" title={provider ?? model.providerId}><ProviderMark name={provider ?? model.providerId} /></span>}
        <span
          className="min-w-0 max-w-[14rem] truncate"
          title={modelDetails ?? 'OpenCode did not provide this subagent’s model.'}
          aria-label={`Model: ${modelLabel ?? 'unavailable'}`}
        >
          {modelLabel ?? 'Model unavailable'}
        </span>
      </span>
    ),
    info.state === 'interrupted' && <span key="state">Stopped</span>,
    info.state === 'unreported' && <span key="state">No answer</span>,
    info.state === 'failed' && <span key="state" className="text-danger/90">Failed</span>,
    time && <span key="time">{time}</span>,
  ].filter(Boolean)
  if (items.length === 0) return null
  return (
    <>
      {items.flatMap((item, index) => index === 0
        ? [item]
        : [<span key={`dot-${index}`} aria-hidden className="opacity-60">·</span>, item])}
    </>
  )
}

/** What the row opens onto: the answer first, as that is what one opens it for, then the task it was given. */
function SubagentDetail({ part, info }: { part: ToolPart; info: SubagentInfo }): JSX.Element {
  const result = subagentAnswer(part)
  return (
    <div className="flex min-w-0 flex-col gap-2.5 py-1">
      {result && <div className="min-w-0 max-h-96 overflow-auto"><ChatMarkdown text={result} /></div>}
      {info.problem && info.state !== 'interrupted' && (
        <p role="alert" className="whitespace-pre-wrap break-words text-[12.5px] text-danger">{info.problem}</p>
      )}
      {info.task && (
        <div className="min-w-0">
          <p className="mb-0.5 text-[11.5px] text-fg-subtle">Task</p>
          <p className="max-h-60 overflow-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-fg-subtle">{info.task}</p>
        </div>
      )}
      {part.truncated && <p className="text-[11px] text-fg-subtle">Shortened; the full text is in OpenCode.</p>}
    </div>
  )
}

/**
 * One subagent, as a line among the others: which kind ("General subagent"), what it was asked to do, and at the right
 * its provider and model and how long it ran. It shimmers and counts while it works; done is the ordinary end and needs no word.
 */
function SubagentRow({ part, models }: { part: ToolPart; models: readonly ChatModel[] }): JSX.Element {
  const info = subagentInfo(part)
  const active = info.state === 'running' || info.state === 'starting'
  const title = info.title ?? (info.task ? taskLine(info.task) : null) ?? (info.state === 'starting' ? 'Starting…' : null)
  const hasMore = Boolean(info.task || subagentAnswer(part) || info.problem)
  return (
    <ActivityRow
      testId={`chat-subagent-${part.id}`}
      label={`Subagent: ${title ?? 'untitled'}`}
      icon={info.state === 'interrupted' || info.state === 'unreported' ? CircleSlash : Split}
      status={ROW_STATUS[info.state]}
      quiet={info.state === 'interrupted' || info.state === 'unreported'}
      verb={subagentLabel(info.agent)}
      subject={title ? <span className={cn(active ? 'chat-shimmer' : 'text-fg-muted')}>{title}</span> : undefined}
      meta={<SubagentMeta part={part} info={info} models={models} />}
      detail={hasMore ? <SubagentDetail part={part} info={info} /> : undefined}
      attrs={{ 'data-subagent-state': info.state }}
    />
  )
}

/** Subagents started together: one row each, under a line with the count when there is more than one. */
export function SubagentGroup({ parts, models = [] }: { parts: ToolPart[]; models?: readonly ChatModel[] }): JSX.Element {
  if (parts.length === 1) {
    return (
      <div className="min-w-0" data-testid="chat-subagents">
        <SubagentRow part={parts[0]!} models={models} />
      </div>
    )
  }
  const states = parts.map((part) => subagentInfo(part).state)
  const running = states.filter((state) => state === 'running' || state === 'starting').length
  const failed = states.filter((state) => state === 'failed').length
  const status = running > 0 ? `${running} working` : failed > 0 ? `${failed} failed` : 'all done'
  return (
    <div className="min-w-0" data-testid="chat-subagents">
      <div className="flex min-w-0 items-center gap-2 px-1.5 py-[5px] text-[12.5px] leading-5">
        <Glyph icon={Split} status={running > 0 ? 'running' : 'completed'} failed={failed > 0 && running === 0} />
        <span className={cn('text-fg-muted', running > 0 && 'chat-shimmer')}>{parts.length} subagents</span>
        <span className="text-fg-subtle"> · {status}</span>
      </div>
      <Rail tight>
        {parts.map((part) => <SubagentRow key={part.id} part={part} models={models} />)}
      </Rail>
    </div>
  )
}
