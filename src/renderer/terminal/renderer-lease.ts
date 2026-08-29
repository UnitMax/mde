export interface RendererLeaseTimers {
  schedule: (run: () => void, delayMs: number) => number
  cancel: (handle: number) => void
}

export interface RendererLease {
  /** Marks a terminal as visible and cancels any release still pending for it. */
  acquire: (terminalId: string) => void
  /** Queues a release, so a pane that comes straight back keeps its renderer. */
  scheduleRelease: (terminalId: string) => void
  /** Releases immediately, used when the terminal is going away for good. */
  releaseNow: (terminalId: string) => void
  pendingCount: () => number
}

/**
 * Deferred release keeps layout changes and pane reorders from thrashing the GPU
 * renderer: React unmounts and remounts the same pane within a tick.
 */
export const RENDERER_RELEASE_DELAY_MS = 250

/**
 * Tracks which terminals may hold a GPU renderer. Off-screen terminals give theirs
 * back so the live count stays bounded by the panes actually on screen.
 */
export function createRendererLease(
  release: (terminalId: string) => void,
  timers: RendererLeaseTimers,
  delayMs: number = RENDERER_RELEASE_DELAY_MS
): RendererLease {
  const pending = new Map<string, number>()

  const cancelPending = (terminalId: string): void => {
    const handle = pending.get(terminalId)
    if (handle === undefined) return
    pending.delete(terminalId)
    timers.cancel(handle)
  }

  return {
    acquire: cancelPending,
    scheduleRelease: (terminalId) => {
      if (pending.has(terminalId)) return
      pending.set(terminalId, timers.schedule(() => {
        pending.delete(terminalId)
        release(terminalId)
      }, delayMs))
    },
    releaseNow: (terminalId) => {
      cancelPending(terminalId)
      release(terminalId)
    },
    pendingCount: () => pending.size
  }
}
