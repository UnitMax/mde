export interface ViewportSettleTimers {
  schedule: (run: () => void, delayMs: number) => number
  cancel: (handle: number) => void
}

export interface ViewportSettle {
  /** Marks the viewport as still changing; sizing waits until it has been quiet for the delay. */
  begin: () => void
  /** Reports a viewport resize, which restarts the quiet period while the viewport is unsettled. */
  noteResize: () => void
  isSettled: () => boolean
  /** Runs once each time the viewport settles. Returns the unsubscribe function. */
  onSettled: (listener: () => void) => () => void
}

/**
 * Restoring from the mini window mounts the terminals before the window has finished growing,
 * so their hosts can briefly measure as a sliver. A fit at that moment would resize the live
 * PTY and its TUI down to a few columns and straight back. Waiting for a quiet viewport means
 * the terminals are measured once, at the size they will keep.
 */
export const VIEWPORT_SETTLE_DELAY_MS = 150

export function createViewportSettle(
  timers: ViewportSettleTimers,
  delayMs: number = VIEWPORT_SETTLE_DELAY_MS
): ViewportSettle {
  let settled = true
  let pending: number | undefined
  const listeners = new Set<() => void>()

  const arm = (): void => {
    if (pending !== undefined) timers.cancel(pending)
    pending = timers.schedule(() => {
      pending = undefined
      settled = true
      for (const listener of [...listeners]) listener()
    }, delayMs)
  }

  return {
    begin: () => {
      settled = false
      arm()
    },
    noteResize: () => {
      if (!settled) arm()
    },
    isSettled: () => settled,
    onSettled: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

// The globals rather than `window`, so the store can run where `window` is only a stub.
export const viewportSettle = createViewportSettle({
  schedule: (run, delayMs) => globalThis.setTimeout(run, delayMs) as unknown as number,
  cancel: (handle) => globalThis.clearTimeout(handle as unknown as ReturnType<typeof setTimeout>)
})

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => viewportSettle.noteResize())
}
