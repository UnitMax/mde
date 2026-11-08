/**
 * What MDE tells the person when a thread needs them while they are somewhere else: a sound, a flash of the
 * taskbar button, and a colour and badge on it. The renderer decides what to show (it knows the threads and
 * whether the window is in use); the main process owns the window and applies it.
 */

/** The three things a thread can do that the person should hear about. */
export type AlertKind = 'done' | 'input' | 'failed'

export const ALERT_KINDS: readonly AlertKind[] = ['done', 'input', 'failed']

/** The more urgent a kind, the higher: a louder event is never hidden by a quieter one close to it. */
export const ALERT_PRIORITY: Record<AlertKind, number> = { done: 1, input: 2, failed: 3 }

/** How the taskbar button asks for attention. `brief` is the system's few flashes; `continuous` repeats until the window is used. */
export type TaskbarFlash = 'none' | 'brief' | 'continuous'

/** The largest count the badge and the request carry. */
export const ATTENTION_COUNT_LIMIT = 99

export interface TaskbarIndicator {
  tone: AlertKind
  /** How many threads are in this state, 1 to `ATTENTION_COUNT_LIMIT`. */
  count: number
}

export interface TaskbarAttentionRequest {
  /** The colour and badge to show, or null for none. */
  indicator: TaskbarIndicator | null
  /** Starts or stops the flashing; left out, the flashing goes on as it is. */
  flash?: TaskbarFlash
}
