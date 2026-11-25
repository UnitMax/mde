import type { InboxThread } from '@shared/types'
import type { ServiceEvent } from '../opencode/service/events'
import { serviceEventSessionId } from '../opencode/service/events'

/** How often a held thread's background work is looked at again, besides the service's job events. */
export const BACKGROUND_HOLD_POLL_MS = 5000
/**
 * How long a thread whose background work just ended waits for OpenCode to start a turn with its results, before it
 * finishes. A subagent's report starts that turn at once; a background shell may start none.
 */
export const BACKGROUND_HOLD_GRACE_MS = 3000

export interface BackgroundHoldDependencies {
  thread(id: string): InboxThread | undefined
  /** How many background tasks of the thread run, its subagents' included. Throws when that cannot be read. */
  countJobs(thread: InboxThread): Promise<number>
  /** Applies an event to the thread record, as if nothing were held. */
  apply(event: ServiceEvent): void
  /** Shows how many background tasks a held thread waits for; 0 clears it. */
  setBackground(id: string, count: number): void
  /** Defaults to the global timers; tests pass fakes. */
  setTimer?(callback: () => void, ms: number): unknown
  clearTimer?(timer: unknown): void
}

interface Hold {
  /** The finish that is held back, applied once the thread's background work is over. */
  finish: ServiceEvent
  phase: 'checking' | 'held' | 'grace'
  timer: unknown
  checking: boolean
  again: boolean
}

/**
 * OpenCode ends a turn while work it started in the background (subagents, shells) still runs, and starts another turn
 * when that work reports back. Taken as they come, the thread would be marked done and unread, then working again, then
 * done again. This holds a thread's finish back while it has background tasks running, so it stays working: the
 * finish is applied once they are over and no new turn followed. A thread without background work finishes as soon as
 * one look at its job list says so; when that list cannot be read, the finish is applied as it came.
 */
export class BackgroundHold {
  private readonly holds = new Map<string, Hold>()

  constructor(private readonly dependencies: BackgroundHoldDependencies) {}

  apply(event: ServiceEvent): void {
    const id = serviceEventSessionId(event)
    const thread = id ? this.dependencies.thread(id) : undefined
    if (!id || !thread) {
      this.dependencies.apply(event)
      return
    }
    if (event.type === 'session.execution.succeeded' && thread.status === 'working') {
      this.release(id)
      const hold: Hold = { finish: event, phase: 'checking', timer: null, checking: false, again: false }
      this.holds.set(id, hold)
      void this.check(id, hold)
      return
    }
    // A new turn, a failure or a stop takes over from whatever was held.
    if (event.type.startsWith('session.execution.')) this.release(id)
    else if (event.type === 'experimental.job.updated') {
      const hold = this.holds.get(id)
      if (hold && hold.phase !== 'checking') void this.check(id, hold)
    }
    this.dependencies.apply(event)
  }

  /** Whether a thread's finish is being held back. */
  holding(id: string): boolean {
    return this.holds.has(id)
  }

  stop(): void {
    for (const id of [...this.holds.keys()]) this.release(id)
  }

  private release(id: string): void {
    const hold = this.holds.get(id)
    if (!hold) return
    this.holds.delete(id)
    this.clear(hold)
    if (hold.phase !== 'checking') this.dependencies.setBackground(id, 0)
  }

  private finish(id: string, hold: Hold): void {
    this.release(id)
    this.dependencies.apply(hold.finish)
  }

  private async check(id: string, hold: Hold): Promise<void> {
    if (hold.checking) {
      hold.again = true
      return
    }
    hold.checking = true
    try {
      do {
        hold.again = false
        const thread = this.dependencies.thread(id)
        if (!thread) {
          this.release(id)
          return
        }
        let count: number
        try {
          count = await this.dependencies.countJobs(thread)
        } catch {
          if (this.holds.get(id) === hold) this.finish(id, hold)
          return
        }
        if (this.holds.get(id) !== hold) return
        this.clear(hold)
        if (count > 0) {
          hold.phase = 'held'
          this.dependencies.setBackground(id, count)
          hold.timer = this.setTimer(() => { void this.check(id, hold) }, BACKGROUND_HOLD_POLL_MS)
        } else if (hold.phase === 'checking') {
          // Nothing ran in the background: the turn is simply over.
          this.finish(id, hold)
          return
        } else {
          if (hold.phase === 'held') this.dependencies.setBackground(id, 0)
          hold.phase = 'grace'
          hold.timer = this.setTimer(() => {
            if (this.holds.get(id) === hold) this.finish(id, hold)
          }, BACKGROUND_HOLD_GRACE_MS)
        }
      } while (hold.again)
    } finally {
      hold.checking = false
    }
  }

  private clear(hold: Hold): void {
    if (hold.timer !== null) (this.dependencies.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)))(hold.timer)
    hold.timer = null
  }

  private setTimer(callback: () => void, ms: number): unknown {
    return (this.dependencies.setTimer ?? ((run, wait) => setTimeout(run, wait)))(callback, ms)
  }
}
