import { useState } from 'react'
import { Braces, ChartColumn, LayoutDashboard } from 'lucide-react'
import type { ChatPart } from '@shared/types'
import type { View } from '@shared/view-spec'
import { ActivityRow } from '@/components/inbox/chat-ui'
import { ViewRenderer } from '@/components/views/ViewRenderer'
import { viewEntries, type ViewEntry } from '@/lib/chat-views'
import { cn } from '@/lib/utils'

type ToolPart = Extract<ChatPart, { kind: 'tool' }>

const PRE = 'inbox-code-font max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-bg px-2.5 py-2 text-[12px] leading-snug text-fg-muted'

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function Problem({ part, entry, testId }: { part: ToolPart; entry: ViewEntry; testId: string }): JSX.Element {
  const errors = typeof entry.state === 'object' && !entry.state.ok ? entry.state.errors : []
  const reason = entry.state === 'cut'
    ? 'The view is larger than MDE keeps, so it cannot be drawn.'
    : part.error ?? errors.join('\n')
  return (
    <ActivityRow
      testId={testId}
      icon={ChartColumn}
      status="error"
      verb="Could not show"
      subject="a view"
      attrs={{ 'data-view-state': 'error' }}
      detail={(
        <div className="flex min-w-0 flex-col gap-2">
          {reason && <pre className={cn(PRE, 'border-danger/40 text-danger')}>{reason}</pre>}
          {entry.input && <pre className={PRE}>{prettyJson(entry.input)}</pre>}
        </div>
      )}
    />
  )
}

function ViewCard({ entry, view, testId }: { entry: ViewEntry; view: View; testId: string }): JSX.Element {
  const [json, setJson] = useState(false)
  return (
    <section
      data-testid={testId}
      data-view-state="shown"
      aria-label={view.title ? `View: ${view.title}` : 'View from the agent'}
      className="view-frame my-1 min-w-0 rounded-lg border border-line bg-panel/40"
    >
      <header className="flex min-w-0 items-center gap-2 border-b border-line/70 px-3 py-1.5">
        <LayoutDashboard aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
        <h3 className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-fg">{view.title ?? 'View'}</h3>
        <span className="shrink-0 text-[11px] text-fg-subtle" title="The agent sent this view as data; MDE drew it.">From the agent</span>
        <button
          type="button"
          aria-pressed={json}
          onClick={() => setJson((value) => !value)}
          title={json ? 'Show the view' : 'Show the JSON the agent sent'}
          className={cn('inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-fg-subtle hover:bg-hover hover:text-fg', json && 'bg-hover text-fg')}
        >
          <Braces aria-hidden className="h-3 w-3" />
          JSON
        </button>
      </header>
      <div className="min-w-0 p-3">
        {json ? <pre className={PRE}>{prettyJson(entry.input)}</pre> : <ViewRenderer view={view} />}
      </div>
    </section>
  )
}

/** The views a tool part shows the person: drawn in place, or a row that says why one cannot be. */
export function ChatViewCall({ part }: { part: ToolPart }): JSX.Element {
  const entries = viewEntries(part)
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {entries.map((entry, index) => {
        const testId = `chat-view-${part.id}${entries.length > 1 ? `-${index}` : ''}`
        if (entry.state === 'pending') {
          return <ActivityRow key={index} testId={testId} icon={ChartColumn} status="running" verb="Preparing" subject="a view" attrs={{ 'data-view-state': 'pending' }} />
        }
        if (entry.status === 'error' || entry.state === 'cut' || !entry.state.ok) return <Problem key={index} part={part} entry={entry} testId={testId} />
        return <ViewCard key={index} entry={entry} view={entry.state.view} testId={testId} />
      })}
    </div>
  )
}
