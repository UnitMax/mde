import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { LoaderCircle, RefreshCw } from 'lucide-react'
import type { ChatTokens, ChatUsageState, ChatUsageStats, InboxFolder, OpenCodeTarget } from '@shared/types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { hoverScrollbar } from '@/lib/hover-scrollbar'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { cn } from '@/lib/utils'
import { useInboxChat } from '@/store/inbox-chat'

export const USAGE_RANGES = [
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: 'all', label: 'All time', days: null },
] as const
export type UsageRange = (typeof USAGE_RANGES)[number]['id']

/** Midnight, local time, `days - 1` days before today: a range of 7 days ends today and holds 7 dates. */
export function usageSince(range: UsageRange, now = Date.now()): number | undefined {
  const days = USAGE_RANGES.find((entry) => entry.id === range)?.days
  if (!days) return undefined
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  return start.getTime()
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseDay(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year!, month! - 1, day!)
}

export interface UsageBucket {
  /** The first day of the bucket, `YYYY-MM-DD`. */
  date: string
  steps: number
  /** True for a week rather than a day. */
  week: boolean
}

/**
 * The activity as bars: a bar per day for a range of up to 90 days, days without any included, and a bar per week
 * (starting Monday) for all time, from the first week with activity to this one.
 */
export function usageBuckets(activity: ChatUsageStats['activity'], since: number | undefined, now = Date.now()): UsageBucket[] {
  const steps = new Map(activity.map((entry) => [entry.date, entry.steps]))
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  if (since !== undefined) {
    const result: UsageBucket[] = []
    for (const day = new Date(since); day <= today; day.setDate(day.getDate() + 1)) {
      const key = dateKey(day)
      result.push({ date: key, steps: steps.get(key) ?? 0, week: false })
    }
    return result
  }
  if (activity.length === 0) return []
  const monday = (date: Date): Date => {
    const start = new Date(date)
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    return start
  }
  const weeks = new Map<string, number>()
  for (const entry of activity) {
    const key = dateKey(monday(parseDay(entry.date)))
    weeks.set(key, (weeks.get(key) ?? 0) + entry.steps)
  }
  const result: UsageBucket[] = []
  const last = monday(today)
  for (const week = monday(parseDay(activity[0]!.date)); week <= last; week.setDate(week.getDate() + 7)) {
    const key = dateKey(week)
    result.push({ date: key, steps: weeks.get(key) ?? 0, week: true })
  }
  return result
}

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat()

export function formatTokens(value: number): string {
  return value < 10_000 ? whole.format(value) : compact.format(value)
}

export function formatCost(value: number): string {
  if (value === 0) return '$0'
  if (value < 0.01) return '<$0.01'
  return `$${value.toFixed(value < 100 ? 2 : 0)}`
}

function totalTokens(tokens: ChatTokens): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite
}

function targetKey(target: OpenCodeTarget): string {
  return target.kind === 'native' ? 'native' : `wsl:${target.distro}`
}

/** One folder per OpenCode service the Inbox uses, the project in view's first: each service counts its own sessions. */
export function usageServices(folders: readonly InboxFolder[], preferred: InboxFolder | null): { key: string; label: string; folder: InboxFolder }[] {
  const ordered = preferred ? [preferred, ...folders.filter((folder) => folder.id !== preferred.id)] : folders
  const services = new Map<string, { key: string; label: string; folder: InboxFolder }>()
  for (const folder of ordered) {
    const key = targetKey(folder.target)
    if (!services.has(key)) services.set(key, { key, label: folder.target.kind === 'wsl' ? folder.target.distro : 'This computer', folder })
  }
  return [...services.values()]
}

/** The token kinds, in the order they are stacked: what was sent (fresh, then cached), then what came back. */
const TOKEN_KINDS = [
  { key: 'input', label: 'Input', color: 'var(--color-accent)' },
  { key: 'cacheRead', label: 'Cache read', color: 'color-mix(in oklab, var(--color-accent) 45%, var(--color-elevated))' },
  { key: 'cacheWrite', label: 'Cache write', color: 'color-mix(in oklab, var(--color-accent) 70%, var(--color-fg))' },
  { key: 'output', label: 'Output', color: 'var(--color-ok)' },
  { key: 'reasoning', label: 'Reasoning', color: 'color-mix(in oklab, var(--color-ok) 50%, var(--color-elevated))' },
] as const satisfies readonly { key: keyof ChatTokens; label: string; color: string }[]

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <section className="rounded-lg border border-line bg-panel/60 p-3.5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">{title}</h3>
        {aside && <span className="truncate text-[11px] text-fg-subtle">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

function Stat({ label, value, detail, testId }: { label: string; value: string; detail?: string; testId: string }): JSX.Element {
  return (
    <div data-testid={testId} className="min-w-0 rounded-lg border border-line bg-panel/60 px-3.5 py-3">
      <div className="truncate text-[11px] text-fg-subtle">{label}</div>
      <div className="mt-1 truncate text-xl font-semibold tabular-nums text-fg">{value}</div>
      {detail && <div className="mt-0.5 truncate text-[11px] text-fg-muted">{detail}</div>}
    </div>
  )
}

function percent(part: number, whole: number): string {
  const value = (part / Math.max(1, whole)) * 100
  return value > 0 && value < 1 ? '<1%' : `${Math.round(value)}%`
}

function TokenMix({ tokens }: { tokens: ChatTokens }): JSX.Element {
  const total = totalTokens(tokens)
  const kinds = TOKEN_KINDS.filter((kind) => tokens[kind.key] > 0)
  return (
    <div data-testid="usage-token-mix">
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-hover">
        {kinds.map((kind) => (
          <div
            key={kind.key}
            title={`${kind.label}: ${whole.format(tokens[kind.key])} tokens`}
            style={{ width: `${(tokens[kind.key] / total) * 100}%`, background: kind.color, minWidth: 3 }}
          />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {kinds.map((kind) => (
          <div key={kind.key} className="flex min-w-0 items-center gap-2 text-xs">
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: kind.color }} />
            <dt className="truncate text-fg-muted">{kind.label}</dt>
            <dd className="ml-auto tabular-nums text-fg">
              {formatTokens(tokens[kind.key])}
              <span className="ml-1.5 text-fg-subtle">{percent(tokens[kind.key], total)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function formatBucket(bucket: UsageBucket): string {
  const date = parseDay(bucket.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(bucket.week ? { year: 'numeric' } : { weekday: 'short' }) })
  return bucket.week ? `Week of ${date}` : date
}

function Activity({ buckets }: { buckets: UsageBucket[] }): JSX.Element {
  const [hovered, setHovered] = useState<number | null>(null)
  const max = Math.max(1, ...buckets.map((bucket) => bucket.steps))
  const shown = hovered !== null ? buckets[hovered] : undefined
  return (
    <div data-testid="usage-activity">
      <div className="mb-2 h-4 text-[11px] text-fg-muted" aria-live="polite">
        {shown ? (
          <><span className="text-fg">{whole.format(shown.steps)}</span> model calls · {formatBucket(shown)}</>
        ) : (
          <>Peak {whole.format(max === 1 && buckets.every((bucket) => bucket.steps === 0) ? 0 : max)} model calls {buckets[0]?.week ? 'a week' : 'a day'}</>
        )}
      </div>
      <div className="flex h-24 items-end gap-0.5 border-b border-line" onMouseLeave={() => setHovered(null)}>
        {buckets.map((bucket, index) => (
          <div
            key={bucket.date}
            data-testid="usage-activity-bar"
            title={`${formatBucket(bucket)}: ${whole.format(bucket.steps)} model calls`}
            onMouseEnter={() => setHovered(index)}
            className="flex h-full min-w-0 flex-1 items-end"
          >
            <div
              className={cn('w-full rounded-t-[3px] transition-opacity', hovered !== null && hovered !== index && 'opacity-50')}
              style={{
                height: bucket.steps > 0 ? `max(3px, ${(bucket.steps / max) * 100}%)` : '1px',
                background: bucket.steps > 0 ? 'var(--color-accent)' : 'var(--color-line)',
              }}
            />
          </div>
        ))}
      </div>
      {buckets.length > 0 && (
        <div className="mt-1.5 flex justify-between text-[10px] text-fg-subtle">
          <span>{formatBucket(buckets[0]!)}</span>
          <span>{buckets[buckets.length - 1]!.week ? 'This week' : 'Today'}</span>
        </div>
      )}
    </div>
  )
}

function Models({ stats }: { stats: ChatUsageStats }): JSX.Element {
  const models = stats.models.slice(0, 6)
  const rest = stats.models.slice(6)
  const max = Math.max(1, ...models.map((entry) => totalTokens(entry.tokens)))
  const all = Math.max(1, totalTokens(stats.tokens))
  return (
    <ul className="flex flex-col gap-2.5" data-testid="usage-models">
      {models.map((entry) => {
        const tokens = totalTokens(entry.tokens)
        return (
          <li key={`${entry.model.providerId}/${entry.model.id}`} data-testid="usage-model" className="min-w-0">
            <div className="flex items-baseline gap-2 text-xs">
              <span className="min-w-0 truncate text-fg" title={`${entry.model.providerId}/${entry.model.id}`}>{entry.model.id}</span>
              <span className="ml-auto shrink-0 tabular-nums text-fg">{formatTokens(tokens)}</span>
              <span className="w-14 shrink-0 text-right tabular-nums text-fg-muted">{formatCost(entry.cost)}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(1, (tokens / max) * 100)}%` }} />
              </div>
            </div>
            <div className="mt-1 flex gap-2 text-[10px] text-fg-subtle">
              <span className="min-w-0 truncate">{entry.model.providerId}</span>
              <span className="ml-auto shrink-0 tabular-nums">{percent(tokens, all)} · {whole.format(entry.steps)} calls</span>
            </div>
          </li>
        )
      })}
      {rest.length > 0 && (
        <li className="text-[11px] text-fg-subtle">
          and {rest.length} more, {formatTokens(rest.reduce((sum, entry) => sum + totalTokens(entry.tokens), 0))} tokens
        </li>
      )}
    </ul>
  )
}

function Tools({ stats }: { stats: ChatUsageStats }): JSX.Element {
  const tools = stats.tools.slice(0, 10)
  const max = Math.max(1, ...tools.map((tool) => tool.calls))
  return (
    <ul className="flex flex-col gap-1.5" data-testid="usage-tools">
      {tools.map((tool) => (
        <li key={tool.name} data-testid="usage-tool" className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 text-xs">
          <span className="truncate font-mono text-[11px] text-fg-muted" title={tool.name}>{tool.name}</span>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-hover" title={`${whole.format(tool.calls)} calls, ${whole.format(tool.failed)} failed`}>
            <div className="h-full bg-accent" style={{ width: `${((tool.calls - tool.failed) / max) * 100}%` }} />
            {tool.failed > 0 && <div className="h-full bg-danger" style={{ width: `max(2px, ${(tool.failed / max) * 100}%)` }} />}
          </div>
          <span className="w-20 text-right tabular-nums text-fg">
            {whole.format(tool.calls)}
            {tool.failed > 0 && <span className="ml-1 text-[10px] text-danger">{whole.format(tool.failed)} failed</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Overview({ stats, range }: { stats: ChatUsageStats; range: UsageRange }): JSX.Element {
  const since = usageSince(range)
  const buckets = useMemo(() => usageBuckets(stats.activity, since), [stats.activity, since])
  const total = totalTokens(stats.tokens)
  const successRate = stats.toolCalls > 0 ? Math.round(((stats.toolCalls - stats.toolFailures) / stats.toolCalls) * 100) : null
  if (stats.steps === 0 && stats.sessions === 0) {
    return <p data-testid="usage-empty" className="py-10 text-center text-sm text-fg-muted">No OpenCode activity in this time.</p>
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat testId="usage-total-tokens" label="Tokens" value={formatTokens(total)} detail={`${formatTokens(stats.tokens.output + stats.tokens.reasoning)} output`} />
        <Stat testId="usage-cost" label="Cost" value={formatCost(stats.cost)} detail={stats.cost === 0 ? 'Free or local models' : 'Reported by OpenCode'} />
        <Stat testId="usage-sessions" label="Sessions" value={whole.format(stats.sessions)} detail={`${whole.format(stats.prompts)} prompts`} />
        <Stat testId="usage-days" label="Active days" value={whole.format(stats.activeDays)} detail={stats.streak > 0 ? `${stats.streak}-day streak` : 'No current streak'} />
      </div>
      <Section title="Tokens" aside={`${whole.format(total)} in total`}>
        <TokenMix tokens={stats.tokens} />
      </Section>
      <Section title="Activity" aside={`${whole.format(stats.steps)} model calls`}>
        <Activity buckets={buckets} />
      </Section>
      <div className="grid gap-3 md:grid-cols-2">
        {stats.models.length > 0 && (
          <Section title="Models" aside="Tokens · cost">
            <Models stats={stats} />
          </Section>
        )}
        {stats.tools.length > 0 && (
          <Section title="Tools" aside={successRate !== null ? `${whole.format(stats.toolCalls)} calls · ${successRate}% succeeded` : undefined}>
            <Tools stats={stats} />
          </Section>
        )}
      </div>
    </div>
  )
}

function timezone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return /^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/.test(zone) ? zone : undefined
  } catch {
    return undefined
  }
}

/** Whole seconds since it was put on screen, counted once a second. */
function useElapsedSeconds(): number {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return elapsed
}

/**
 * Says the statistics are on their way. OpenCode counts them afresh from every message on each request, so a long
 * history (All time most of all) can take a while: the seconds and, after a few, why show the app is not stuck.
 */
function UsageLoading(): JSX.Element {
  const elapsed = useElapsedSeconds()
  return (
    <div role="status" data-testid="usage-loading" className="flex flex-col items-center gap-2 text-center">
      <div className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-fg-muted shadow-sm">
        <LoaderCircle className="h-3.5 w-3.5 animate-spin text-fg-subtle" />
        <span>Reading OpenCode&rsquo;s statistics&hellip;</span>
        {elapsed >= 2 && <span data-testid="usage-loading-seconds" className="tabular-nums text-fg-subtle">{elapsed} s</span>}
      </div>
      {elapsed >= 5 && (
        <p data-testid="usage-loading-hint" className="max-w-xs rounded-md bg-panel/90 px-2 py-1 text-[11px] text-fg-subtle">
          OpenCode counts every session again each time, so a long history takes a while.
        </p>
      )}
    </div>
  )
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'done'; state: ChatUsageState }

/**
 * OpenCode's usage overview, like `opencode stats`: tokens, cost, activity over time, and the models and tools used.
 * It counts every session the OpenCode service holds, the ones started outside MDE too. Read when opened and on
 * Refresh; nothing is kept.
 */
export function InboxUsageDialog({ open, onOpenChange, project }: { open: boolean; onOpenChange: (open: boolean) => void; project: InboxFolder | null }): JSX.Element {
  const folders = useInboxChat((state) => state.folders)
  const services = useMemo(() => usageServices(folders, project), [folders, project])
  const [range, setRange] = useState<UsageRange>('30d')
  const [serviceKey, setServiceKey] = useState<string | null>(null)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [shown, setShown] = useState<{ stats: ChatUsageStats; range: UsageRange } | null>(null)
  const [reload, setReload] = useState(0)
  const service = services.find((entry) => entry.key === serviceKey) ?? services[0]

  useEffect(() => {
    if (!open || !service) return
    let current = true
    setLoad({ status: 'loading' })
    window.api.chat.usage({ folderId: service.folder.id, since: usageSince(range), timezone: timezone() })
      .then((state) => {
        if (!current) return
        setLoad({ status: 'done', state })
        setShown(state.stats ? { stats: state.stats, range } : null)
      })
      .catch((error: unknown) => { if (current) setLoad({ status: 'error', message: ipcErrorMessage(error, 'Could not read OpenCode’s usage.') }) })
    return () => { current = false }
  }, [open, service?.folder.id, range, reload])

  const loading = load.status === 'loading'
  // A new count starts the seconds again.
  const loadKey = `${service?.key}:${range}:${reload}`
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        {...hoverScrollbar}
        className="hover-scrollbar max-h-[calc(100vh-2rem)] max-w-3xl overflow-y-auto focus:outline-none"
        data-testid="inbox-usage"
        // Not the first range button: its focus ring would read as the chosen range.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement | null)?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>Usage</DialogTitle>
          <DialogDescription>
            What OpenCode has used, from its own statistics. It counts every OpenCode session, not only the Inbox&rsquo;s threads.
          </DialogDescription>
        </DialogHeader>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Time range" className="flex gap-0.5 rounded-md border border-line bg-panel p-0.5">
            {USAGE_RANGES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={range === entry.id}
                data-testid={`usage-range-${entry.id}`}
                onClick={() => setRange(entry.id)}
                className={cn(
                  'rounded px-2.5 py-1 text-xs transition-colors',
                  range === entry.id ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
          {services.length > 1 && (
            <div role="tablist" aria-label="OpenCode" className="flex gap-0.5 rounded-md border border-line bg-panel p-0.5">
              {services.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  role="tab"
                  aria-selected={service?.key === entry.key}
                  data-testid={`usage-service-${entry.key}`}
                  onClick={() => setServiceKey(entry.key)}
                  className={cn(
                    'max-w-40 truncate rounded px-2.5 py-1 text-xs transition-colors',
                    service?.key === entry.key ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            data-testid="usage-refresh"
            aria-label="Refresh"
            title="Refresh"
            disabled={loading || !service}
            onClick={() => setReload((value) => value + 1)}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-hover hover:text-fg disabled:opacity-50"
          >
            {loading && service ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        </div>

        {!service ? (
          <p className="py-10 text-center text-sm text-fg-muted">Add a project to see OpenCode&rsquo;s usage.</p>
        ) : load.status === 'error' ? (
          <p role="alert" className="py-10 text-center text-sm text-danger">{load.message}</p>
        ) : load.status === 'done' && !load.state.supported ? (
          <p data-testid="usage-unsupported" className="py-10 text-center text-sm text-fg-muted">
            This OpenCode has no usage statistics. Update OpenCode to see them.
          </p>
        ) : shown ? (
          <div className="relative" aria-busy={loading}>
            <div className={cn('transition-opacity', loading && 'pointer-events-none opacity-40')}>
              <Overview stats={shown.stats} range={shown.range} />
            </div>
            {loading && (
              <div className="absolute inset-x-0 top-8 flex justify-center">
                <UsageLoading key={loadKey} />
              </div>
            )}
          </div>
        ) : (
          <div className="py-12"><UsageLoading key={loadKey} /></div>
        )}
      </DialogContent>
    </Dialog>
  )
}
