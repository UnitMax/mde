import type { CSSProperties } from 'react'
import { FoldVertical, Gauge, LoaderCircle } from 'lucide-react'
import type { ChatTokens } from '@shared/types'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  CONTEXT_SEGMENTS,
  formatCost,
  formatExactTokens,
  formatPercent,
  formatTokens,
  segmentFill,
  stepContext,
  type CompactionState,
  type ContextTone,
  type ContextUsage,
} from '@/lib/chat'
import { cn } from '@/lib/utils'

const TONE_COLOR: Record<ContextTone, string> = {
  normal: 'var(--color-accent)',
  warn: 'var(--color-warn)',
  danger: 'var(--color-danger)',
}

/** In the order the model reads them: the cached prompt, the new prompt, then what it wrote. */
const KINDS: { key: keyof ChatTokens; label: string; color: string }[] = [
  { key: 'cacheRead', label: 'Cache read', color: 'var(--color-syntax-type)' },
  { key: 'cacheWrite', label: 'Cache write', color: 'color-mix(in srgb, var(--color-syntax-type) 55%, transparent)' },
  { key: 'input', label: 'New input', color: 'var(--color-accent)' },
  { key: 'output', label: 'Output', color: 'var(--color-syntax-keyword)' },
  { key: 'reasoning', label: 'Reasoning', color: 'color-mix(in srgb, var(--color-syntax-keyword) 55%, transparent)' },
]

/** What the menu needs to offer compacting: whether it is under way, and how to ask for it. */
export interface ContextCompact {
  state: CompactionState
  onRun: () => void
}

function describe(usage: ContextUsage): string {
  if (usage.compacted) return 'Context: compacted. Its new size shows after the next reply'
  const used = formatTokens(usage.used)
  return usage.limit && usage.ratio !== null
    ? `Context: ${used} of ${formatTokens(usage.limit)} tokens used (${formatPercent(usage.ratio)})`
    : `Context: ${used} tokens used`
}

function Segments({ usage, running }: { usage: ContextUsage; running: boolean }): JSX.Element {
  const lit = Math.min(CONTEXT_SEGMENTS, Math.ceil(Math.min(usage.ratio ?? 0, 1) * CONTEXT_SEGMENTS))
  return (
    <span aria-hidden className="flex items-center gap-[3px] @max-[30rem]:hidden">
      {Array.from({ length: CONTEXT_SEGMENTS }, (_, index) => {
        const fill = segmentFill(usage.ratio, index)
        return (
          <span key={index} className="relative h-1.5 w-[11px] rounded-full bg-line-strong">
            {fill > 0 && (
              // A partly filled segment is lit more dimly instead of cut short, which would read as a stray tick.
              <span
                className={cn('absolute inset-0 rounded-full', running && index === lit - 1 && 'motion-safe:animate-pulse')}
                style={{
                  opacity: 0.4 + 0.6 * fill,
                  background: 'linear-gradient(90deg, color-mix(in srgb, var(--meter) 60%, transparent), var(--meter))',
                  boxShadow: '0 0 6px color-mix(in srgb, var(--meter) 55%, transparent)',
                }}
              />
            )}
          </span>
        )
      })}
    </span>
  )
}

/** Where the window goes: one bar split by kind of token, with the free space left over. */
function Composition({ usage }: { usage: ContextUsage }): JSX.Element {
  const whole = Math.max(usage.limit ?? 0, usage.used)
  return (
    <div className="flex h-2 gap-px overflow-hidden rounded-full bg-line-strong/70" data-testid="chat-context-composition">
      {KINDS.map((kind) => {
        const value = usage.step[kind.key]
        if (value <= 0) return null
        return (
          <span
            key={kind.key}
            title={`${kind.label}: ${formatExactTokens(value)}`}
            style={{ width: `${(value / whole) * 100}%`, minWidth: 3, background: kind.color }}
          />
        )
      })}
    </div>
  )
}

function Row({ dot, label, value, title }: { dot?: string; label: string; value: string; title?: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2 py-[3px] text-xs" title={title}>
      {dot ? <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} /> : null}
      <span className="min-w-0 flex-1 truncate text-fg-muted">{label}</span>
      <span className="tabular-nums text-fg">{value}</span>
    </div>
  )
}

/** The action under the breakdown: summarizes the conversation to free up context. */
function CompactAction({ compact, usage, running }: { compact: ContextCompact; usage: ContextUsage; running: boolean }): JSX.Element {
  const busy = compact.state === 'running'
  const waiting = compact.state === 'held'
  // A second one straight after the first has nothing new to summarize, and would only fail.
  const disabled = compact.state !== null || usage.compacted !== null
  const title = busy ? 'Compacting…' : waiting ? 'Compaction waiting' : 'Compact conversation'
  const hint = busy ? 'Summarizing the conversation.'
    : waiting ? 'It starts when the agent finishes.'
      : usage.compacted ? 'Just compacted. Nothing new to compact yet.'
        : running ? 'The agent is working. It compacts when the agent finishes.'
          : 'Summarize it to free up context.'
  return (
    <div className="border-t border-line p-1">
      <DropdownMenuItem
        disabled={disabled}
        onSelect={() => compact.onRun()}
        data-testid="chat-context-compact"
        data-state-of-compaction={compact.state ?? (usage.compacted ? 'done' : 'idle')}
        className="items-start gap-2.5 px-2 py-2 data-[disabled]:opacity-70"
      >
        {busy
          ? <LoaderCircle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-accent motion-reduce:animate-none" />
          : <FoldVertical aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted" />}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] leading-tight">{title}</span>
          <span className="text-[11px] leading-snug text-fg-subtle">{hint}</span>
        </span>
      </DropdownMenuItem>
    </div>
  )
}

function Details({ usage }: { usage: ContextUsage }): JSX.Element {
  const facts = [
    usage.modelName,
    usage.limit ? `${formatTokens(usage.limit)} window` : 'window size unknown',
    usage.outputLimit ? `${formatTokens(usage.outputLimit)} max reply` : null,
  ].filter((fact): fact is string => fact !== null)
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="chat-context-details">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">Context window</p>
          {usage.compacted ? (
            <>
              <p className="mt-1 text-[22px] font-semibold leading-none text-fg" data-testid="chat-context-compacted">Compacted</p>
              <p className="mt-1.5 text-xs text-fg-muted">The new size shows after the next reply.</p>
            </>
          ) : (
            <p className="mt-1 flex items-baseline gap-1.5" title={`${formatExactTokens(usage.used)} tokens`}>
              <span className="text-[22px] font-semibold leading-none tabular-nums text-fg">{formatTokens(usage.used)}</span>
              {usage.limit ? <span className="text-xs text-fg-muted">of {formatTokens(usage.limit)} tokens</span> : <span className="text-xs text-fg-muted">tokens</span>}
            </p>
          )}
        </div>
        {usage.ratio !== null && (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums"
            style={{ background: 'color-mix(in srgb, var(--meter) 16%, transparent)', color: 'var(--meter)' }}
          >
            {formatPercent(usage.ratio)}
          </span>
        )}
      </div>

      {usage.compacted ? (
        <div>
          <Row label="Before compacting" value={formatTokens(usage.used)} title={`${formatExactTokens(usage.used)} tokens`} />
          {usage.compacted.summaryTokens !== null && (
            <Row
              label="Summary"
              value={`about ${formatTokens(usage.compacted.summaryTokens)}`}
              title={`${formatExactTokens(usage.compacted.summaryTokens)} tokens written, which is about what the summary takes`}
            />
          )}
        </div>
      ) : (
        <>
          <Composition usage={usage} />

          <div>
            {KINDS.map((kind) => {
              const value = usage.step[kind.key]
              return value > 0
                ? <Row key={kind.key} dot={kind.color} label={kind.label} value={formatTokens(value)} title={`${formatExactTokens(value)} tokens`} />
                : null
            })}
          </div>
        </>
      )}

      {usage.thread && (
        <div className="border-t border-line pt-2">
          <Row
            label="Thread total"
            value={formatTokens(stepContext(usage.thread.tokens))}
            title="Every token sent and received over all steps of this thread, cached ones included"
          />
          <Row label="Reported cost" value={formatCost(usage.thread.cost)} title="The cost OpenCode reports; some providers report none" />
        </div>
      )}

      <p className="border-t border-line pt-2 text-[11px] leading-snug text-fg-subtle first-letter:uppercase">{facts.join(' · ')}</p>
    </div>
  )
}

/**
 * A pill for the composer's toolbar showing how full the model's context window is, as a gauge and
 * a token count. It turns amber and then red as the window fills; clicking it opens the breakdown.
 */
export function ContextMeter({ usage, running = false, compact }: { usage: ContextUsage; running?: boolean; compact?: ContextCompact }): JSX.Element {
  const label = describe(usage)
  const style = { '--meter': TONE_COLOR[usage.tone] } as CSSProperties
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          data-testid="chat-context-meter"
          data-tone={usage.tone}
          style={style}
          className={cn(
            'mr-1 flex h-7 shrink-0 items-center gap-2 rounded-full border border-line bg-panel/70 px-2.5 text-[11.5px] tabular-nums',
            'text-fg-muted transition-colors hover:border-line-strong hover:bg-hover hover:text-fg',
            'data-[state=open]:border-line-strong data-[state=open]:bg-hover data-[state=open]:text-fg',
          )}
        >
          {usage.limit && <Segments usage={usage} running={running} />}
          {/* Stands in for the gauge when the composer is too narrow to spare its width. */}
          <Gauge
            aria-hidden
            className={cn('h-3 w-3', usage.limit && 'hidden @max-[30rem]:block')}
            style={usage.tone === 'normal' ? undefined : { color: 'var(--meter)' }}
          />
          <span className="font-medium" style={usage.tone === 'normal' ? undefined : { color: 'var(--meter)' }}>
            {usage.compacted ? 'Compacted' : formatTokens(usage.used)}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-80 p-0" style={style}>
        <Details usage={usage} />
        {compact && <CompactAction compact={compact} usage={usage} running={running} />}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
