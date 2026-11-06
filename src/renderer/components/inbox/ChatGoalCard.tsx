import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Hourglass, LoaderCircle, MessageCircleQuestionMark, Pause, Play, Search, Target, X } from 'lucide-react'
import type { ChatGoal } from '@shared/types'
import type { GoalPhase } from '@/lib/chat'
import { ipcErrorMessage } from '@/lib/ipc-error'
import { cn } from '@/lib/utils'

export type GoalAction = 'pause' | 'resume' | 'clear'

/** How long the thread has to look like the reviewer's turn before the card says so; a step ending between two steps is not it. */
export const GOAL_REVIEW_DELAY_MS = 900
/**
 * How long nothing may be running before the card says the goal is waiting. A thread that is just being opened, or a goal
 * that was just set, has not been told it is running yet; that is not waiting.
 */
export const GOAL_WAIT_DELAY_MS = 2500

/** An objective longer than this, or on several lines, can be opened to read in full. */
const LONG_OBJECTIVE = 160

/** OpenCode's own reason when the person paused the goal; the status already says it. */
const PAUSED_BY_PERSON = 'Paused by the user'

const ACTION =
  'flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-50'
const PRIMARY =
  'flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[12px] font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-60'

interface Look {
  border: string
  mark: string
  text: string
  dot: string
  label: string
}

const ACTIVE: Look = { border: 'border-accent/45', mark: 'bg-accent/15 text-accent', text: 'text-accent', dot: 'bg-accent', label: 'Working toward the goal' }
const LOOKS = {
  working: ACTIVE,
  reviewing: { ...ACTIVE, label: 'Checking whether the goal is met…' },
  waiting: { ...ACTIVE, label: 'Waiting for background work' },
  attention: { border: 'border-warn/50', mark: 'bg-warn/15 text-warn', text: 'text-warn', dot: 'bg-warn', label: 'Waiting for your answer' },
  paused: { border: 'border-warn/40', mark: 'bg-warn/15 text-warn', text: 'text-warn', dot: 'bg-warn', label: 'Paused' },
  complete: { border: 'border-ok/45', mark: 'bg-ok/15 text-ok', text: 'text-ok', dot: 'bg-ok', label: 'Goal met' },
} satisfies Record<string, Look>

/**
 * The phase to show. The reviewer's turn and waiting are only told once they have lasted a moment: until then the goal
 * is working, which is what it nearly always is, so the card does not flicker through states that last a blink.
 */
export function useSettledPhase(phase: GoalPhase): GoalPhase {
  const delayed = phase === 'reviewing' || phase === 'waiting'
  const [settled, setSettled] = useState<GoalPhase>(delayed ? 'working' : phase)
  useEffect(() => {
    if (!delayed) {
      setSettled(phase)
      return undefined
    }
    const timer = setTimeout(() => setSettled(phase), phase === 'reviewing' ? GOAL_REVIEW_DELAY_MS : GOAL_WAIT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [phase, delayed])
  return settled
}

function Mark({ status, phase, look }: { status: ChatGoal['status']; phase: GoalPhase; look: Look }): JSX.Element {
  const icon = status === 'complete' ? <Check className="h-4 w-4" />
    : status === 'paused' ? <Pause className="h-3.5 w-3.5" />
      : phase === 'attention' ? <MessageCircleQuestionMark className="h-4 w-4" />
        : phase === 'reviewing' ? <Search className="h-4 w-4" />
          : phase === 'waiting' ? <Hourglass className="h-3.5 w-3.5" />
            : <Target className="h-4 w-4" />
  return (
    <span aria-hidden className={cn('mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-full', look.mark)}>
      {icon}
    </span>
  )
}

/**
 * The goal of a thread (`/goal`), above the message box. It says what the goal is and what it is doing now
 * (working, being checked, waiting for an answer, paused, met), what the reviewer last found missing, and offers
 * the actions that fit: pause while it runs, resume once it has stopped, clear (dismiss, once it is met). The
 * state is OpenCode's; the card changes it only by asking, and shows the new state when the service tells it.
 * Another goal is another card: the thread view keys it by the goal's ID, so nothing of the last one carries over.
 */
export function ChatGoalCard({
  goal,
  phase,
  running,
  onAction,
}: {
  goal: ChatGoal
  /** What an active goal is doing; the card shows the reviewer's turn only once it has lasted a moment. */
  phase: GoalPhase
  /** Whether the agent is still busy, which for a paused goal means it is finishing the step it was on. */
  running: boolean
  /** Asks OpenCode to pause, resume or clear the goal. A rejection is shown on the card. */
  onAction: (action: GoalAction) => Promise<void>
}): JSX.Element {
  const [busy, setBusy] = useState<GoalAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const settled = useSettledPhase(phase)
  const active = goal.status === 'active'
  const look: Look = goal.status === 'active' ? LOOKS[settled] : LOOKS[goal.status]
  const live = active && (settled === 'working' || settled === 'reviewing')
  const long = goal.objective.length > LONG_OBJECTIVE || goal.objective.includes('\n')
  const round = goal.rounds + 1
  const left = goal.maxRounds - goal.rounds
  const nearLimit = active && left <= 5
  const reason = goal.status === 'paused' && goal.reason === PAUSED_BY_PERSON ? undefined : goal.reason

  const run = (action: GoalAction): void => {
    if (busy) return
    setBusy(action)
    setError(null)
    onAction(action).then(
      () => setBusy(null),
      (failure: unknown) => {
        setBusy(null)
        setError(ipcErrorMessage(failure, `Could not ${action} the goal.`))
      },
    )
  }
  // A click on a button must not take the caret out of the message box.
  const keepFocus = (event: { preventDefault: () => void }): void => event.preventDefault()

  const status = goal.status === 'paused' && goal.reason === PAUSED_BY_PERSON ? 'Paused by you' : look.label
  const meta = goal.status === 'complete'
    ? `Met in ${round} ${round === 1 ? 'round' : 'rounds'}`
    : goal.status === 'paused' ? `Stopped in round ${round}` : `Round ${round}`

  let note: ReactNode = null
  if (reason) {
    const heading = goal.status === 'active' ? 'Last check' : goal.status === 'complete' ? 'Evidence' : 'Why'
    note = (
      <p data-testid="chat-goal-reason" title={reason} className="chat-selectable flex gap-1.5 text-[12px] leading-[18px] text-fg-muted">
        <span className="shrink-0 text-fg-subtle">{heading}</span>
        <span className="line-clamp-3 min-w-0 whitespace-pre-wrap break-words">{reason}</span>
      </p>
    )
  }

  return (
    <section
      role="region"
      aria-label="Goal"
      data-testid="chat-goal"
      data-status={goal.status}
      data-phase={active ? settled : undefined}
      className={cn('chat-goal relative mb-2 overflow-hidden rounded-2xl border bg-elevated shadow-lg shadow-black/20', look.border)}
    >
      {live && (
        <span aria-hidden data-testid="chat-goal-sweep" className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden">
          <span className="chat-goal-sweep absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-accent to-transparent" />
        </span>
      )}
      <div className="flex items-start gap-3 px-3.5 pb-3 pt-3">
        <Mark status={goal.status} phase={settled} look={look} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Goal</span>
            <span role="status" data-testid="chat-goal-status" className={cn('flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium', look.text)}>
              {live && (
                <span aria-hidden className="relative flex h-2 w-2 shrink-0">
                  <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:hidden', look.dot)} />
                  <span className={cn('relative inline-flex h-2 w-2 rounded-full', look.dot)} />
                </span>
              )}
              <span className="min-w-0">{status}</span>
            </span>
            <span
              data-testid="chat-goal-round"
              title={`${goal.rounds} of ${goal.maxRounds} follow-up rounds used. OpenCode pauses the goal when they run out.`}
              className="text-[12px] text-fg-subtle"
            >
              {meta}
            </span>
            <div className="-mr-1 ml-auto flex shrink-0 items-center gap-0.5">
              {goal.status === 'active' && (
                <button type="button" data-testid="chat-goal-pause" disabled={busy !== null} onMouseDown={keepFocus} onClick={() => run('pause')} className={ACTION}>
                  {busy === 'pause' ? <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Pause aria-hidden className="h-3.5 w-3.5" />}
                  Pause
                </button>
              )}
              {goal.status === 'paused' && (
                <button type="button" data-testid="chat-goal-resume" disabled={busy !== null} onMouseDown={keepFocus} onClick={() => run('resume')} className={PRIMARY}>
                  {busy === 'resume' ? <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Play aria-hidden className="h-3.5 w-3.5 fill-current" />}
                  Resume
                </button>
              )}
              {goal.status === 'complete' ? (
                <button type="button" data-testid="chat-goal-clear" disabled={busy !== null} onMouseDown={keepFocus} onClick={() => run('clear')} className={ACTION}>
                  {busy === 'clear' ? <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <X aria-hidden className="h-3.5 w-3.5" />}
                  Dismiss
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="chat-goal-clear"
                  aria-label="Clear goal"
                  title="Clear the goal"
                  disabled={busy !== null}
                  onMouseDown={keepFocus}
                  onClick={() => run('clear')}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-50"
                >
                  {busy === 'clear' ? <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <X aria-hidden className="h-3.5 w-3.5" />}
                </button>
              )}
            </div>
          </div>

          <p
            data-testid="chat-goal-objective"
            className={cn(
              'chat-selectable whitespace-pre-wrap break-words text-[13.5px] leading-5 text-fg',
              open ? 'max-h-48 overflow-y-auto' : 'line-clamp-3',
            )}
            tabIndex={open ? 0 : undefined}
          >
            {goal.objective}
          </p>
          {long && (
            <button
              type="button"
              data-testid="chat-goal-toggle"
              aria-expanded={open}
              onMouseDown={keepFocus}
              onClick={() => setOpen((value) => !value)}
              className="-mt-0.5 w-fit text-[12px] text-accent hover:underline"
            >
              {open ? 'Show less' : 'Show all'}
            </button>
          )}

          {note}
          {goal.status === 'paused' && running && (
            <p role="status" data-testid="chat-goal-finishing" className="flex items-center gap-1.5 text-[12px] text-fg-subtle">
              <LoaderCircle aria-hidden className="h-3 w-3 shrink-0 animate-spin motion-reduce:animate-none" />
              The agent is finishing its current step. Stop it to end the step now.
            </p>
          )}
          {active && (goal.stalls ?? 0) > 0 && (
            <p data-testid="chat-goal-stalled" className="flex items-center gap-1.5 text-[12px] text-warn">
              <AlertTriangle aria-hidden className="h-3 w-3 shrink-0" />
              No progress in the last round. OpenCode pauses the goal if that keeps up.
            </p>
          )}
          {nearLimit && (
            <p data-testid="chat-goal-limit" className="flex items-center gap-1.5 text-[12px] text-warn">
              <AlertTriangle aria-hidden className="h-3 w-3 shrink-0" />
              {left <= 0 ? 'This is the last round.' : `${left} ${left === 1 ? 'round' : 'rounds'} left before OpenCode pauses the goal.`}
            </p>
          )}
          {error && (
            <p role="alert" data-testid="chat-goal-error" className="flex items-start gap-1.5 text-[12px] text-danger">
              <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
