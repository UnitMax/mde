import type { ReactNode } from 'react'
import { Clock3 } from 'lucide-react'
import { ElapsedTime } from '@/components/ElapsedTime'
import { flowAttrs } from '@/components/inbox/chat-ui'
import { formatDuration, formatRate, spokenDuration } from '@/lib/duration'

/**
 * The line under a turn, while the agent works on it and once it is done. It is laid out as the activity rows above it
 * (the same icon column, icon size and text size), so that the two read as one list. It never moves: the rows above
 * carry the motion, and this line only counts, so that when the turn ends nothing changes but the words.
 */
function TurnLine({ testId, title, children }: { testId: string; title?: string; children: ReactNode }): JSX.Element {
  return (
    <div
      className="flex items-center gap-2 px-1.5 text-[12.5px] leading-5 text-fg-muted"
      data-testid={testId}
      {...flowAttrs('footer', 'footer', true)}
      title={title}
    >
      <Clock3 aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
      {children}
      <span aria-hidden className="h-px min-w-6 flex-1 bg-gradient-to-r from-line-strong/70 to-transparent" />
    </div>
  )
}

/**
 * The line under a finished turn: how long the agent worked on it and, when OpenCode's numbers allow
 * it, how fast the model generated, as OpenCode's own interface shows.
 */
export function TurnDuration({ ms, tokensPerSecond = null }: { ms: number; tokensPerSecond?: number | null }): JSX.Element {
  return (
    <TurnLine testId="chat-turn-duration" title={spokenDuration(ms)}>
      <span className="shrink-0">
        Worked for <span className="tabular-nums text-fg/90">{formatDuration(ms)}</span>
      </span>
      {tokensPerSecond !== null && (
        <>
          <span aria-hidden className="shrink-0 opacity-60">
            ·
          </span>
          <span
            className="shrink-0"
            data-testid="chat-turn-rate"
            title="Output and reasoning tokens per second while the model was generating, not counting the time tools ran"
          >
            <span className="tabular-nums text-fg/90">{formatRate(tokensPerSecond)}</span> tok/s
          </span>
        </>
      )}
    </TurnLine>
  )
}

/** The same line while the agent is still going, the time so far counting up. `since` is where the count starts; null starts it now. */
export function WorkingFor({ since }: { since: number | null }): JSX.Element {
  return (
    <TurnLine testId="chat-working">
      <span className="shrink-0">
        Working for <ElapsedTime since={since} className="tabular-nums text-fg/90" />
      </span>
    </TurnLine>
  )
}
