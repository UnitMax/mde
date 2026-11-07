import { Clock3 } from 'lucide-react'
import { ElapsedTime } from '@/components/ElapsedTime'
import { formatDuration, formatRate, spokenDuration } from '@/lib/duration'

/**
 * The line under a finished turn: how long the agent worked on it and, when OpenCode's numbers allow
 * it, how fast the model generated, as OpenCode's own interface shows.
 */
export function TurnDuration({ ms, tokensPerSecond = null }: { ms: number; tokensPerSecond?: number | null }): JSX.Element {
  return (
    <div
      className="flex items-center gap-2 px-1.5 text-[11.5px] text-fg-subtle"
      data-testid="chat-turn-duration"
      title={spokenDuration(ms)}
    >
      <Clock3 aria-hidden className="h-3 w-3 shrink-0" />
      <span className="shrink-0">
        Worked for <span className="tabular-nums text-fg-muted">{formatDuration(ms)}</span>
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
            <span className="tabular-nums text-fg-muted">{formatRate(tokensPerSecond)}</span> tok/s
          </span>
        </>
      )}
      <span aria-hidden className="h-px min-w-6 flex-1 bg-gradient-to-r from-line-strong/70 to-transparent" />
    </div>
  )
}

/**
 * The same line while the agent is still going: the same still clock, so that the line does not move when the turn
 * ends, the time so far counting up, and a rule with a light moving along it, which is the only motion (a spinner
 * here would compete with the ones on the rows above). `since` is where the count starts; null starts it now.
 */
export function WorkingFor({ since }: { since: number | null }): JSX.Element {
  return (
    <div className="flex items-center gap-2 px-1.5 text-[11.5px] text-fg-muted" data-testid="chat-working">
      <Clock3 aria-hidden className="h-3 w-3 shrink-0" />
      <span className="shrink-0">
        Working for <ElapsedTime since={since} className="text-fg" />
      </span>
      <span aria-hidden className="working-rule h-px min-w-6 flex-1" />
    </div>
  )
}
