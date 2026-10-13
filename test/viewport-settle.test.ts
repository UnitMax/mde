import { describe, expect, it } from 'vitest'
import {
  createViewportSettle,
  VIEWPORT_SETTLE_DELAY_MS,
  type ViewportSettleTimers
} from '../src/renderer/terminal/viewport-settle'

function createHarness(delayMs = VIEWPORT_SETTLE_DELAY_MS) {
  const scheduled = new Map<number, { run: () => void; delayMs: number }>()
  let nextHandle = 1

  const timers: ViewportSettleTimers = {
    schedule: (run, delay) => {
      const handle = nextHandle++
      scheduled.set(handle, { run, delayMs: delay })
      return handle
    },
    cancel: (handle) => {
      scheduled.delete(handle)
    }
  }

  const settle = createViewportSettle(timers, delayMs)
  return {
    settle,
    pending: () => scheduled.size,
    /** Fires every timer that is still scheduled, as the quiet period elapsing would. */
    elapse: () => {
      for (const [handle, timer] of [...scheduled]) {
        scheduled.delete(handle)
        timer.run()
      }
    },
    delays: () => [...scheduled.values()].map((timer) => timer.delayMs)
  }
}

describe('viewport settling', () => {
  it('is settled until a restore begins, and ignores resizes while settled', () => {
    const { settle, pending } = createHarness()

    expect(settle.isSettled()).toBe(true)
    settle.noteResize()
    expect(settle.isSettled()).toBe(true)
    expect(pending()).toBe(0)
  })

  it('stays unsettled for the quiet period, then settles and tells listeners once', () => {
    const { settle, elapse, delays } = createHarness(150)
    let notified = 0
    settle.onSettled(() => {
      notified += 1
    })

    settle.begin()
    expect(settle.isSettled()).toBe(false)
    expect(delays()).toEqual([150])
    expect(notified).toBe(0)

    elapse()
    expect(settle.isSettled()).toBe(true)
    expect(notified).toBe(1)

    // Nothing is left scheduled, so a later quiet period cannot notify again.
    elapse()
    expect(notified).toBe(1)
  })

  it('restarts the quiet period on every resize while the window is still changing', () => {
    const { settle, elapse, pending } = createHarness()
    let notified = 0
    settle.onSettled(() => {
      notified += 1
    })

    settle.begin()
    settle.noteResize()
    settle.noteResize()

    // Each resize replaced the timer rather than adding another.
    expect(pending()).toBe(1)
    expect(settle.isSettled()).toBe(false)

    elapse()
    expect(settle.isSettled()).toBe(true)
    expect(notified).toBe(1)
  })

  it('can begin again after settling, and a second begin does not notify twice', () => {
    const { settle, elapse, pending } = createHarness()
    let notified = 0
    settle.onSettled(() => {
      notified += 1
    })

    settle.begin()
    elapse()
    settle.begin()
    settle.begin()
    expect(settle.isSettled()).toBe(false)
    expect(pending()).toBe(1)

    elapse()
    expect(settle.isSettled()).toBe(true)
    expect(notified).toBe(2)
  })

  it('stops notifying a listener once it unsubscribes', () => {
    const { settle, elapse } = createHarness()
    const calls: string[] = []
    const stopFirst = settle.onSettled(() => calls.push('first'))
    settle.onSettled(() => calls.push('second'))

    settle.begin()
    stopFirst()
    elapse()

    expect(calls).toEqual(['second'])
  })

  it('lets a listener unsubscribe itself while being notified', () => {
    const { settle, elapse } = createHarness()
    const calls: string[] = []
    const stop = settle.onSettled(() => {
      calls.push('once')
      stop()
    })
    settle.onSettled(() => calls.push('other'))

    settle.begin()
    elapse()
    settle.begin()
    elapse()

    expect(calls).toEqual(['once', 'other', 'other'])
  })
})
