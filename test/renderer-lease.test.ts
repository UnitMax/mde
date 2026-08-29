import { describe, expect, it } from 'vitest'
import {
  createRendererLease,
  RENDERER_RELEASE_DELAY_MS,
  type RendererLeaseTimers
} from '../src/renderer/terminal/renderer-lease'

function createHarness(delayMs = RENDERER_RELEASE_DELAY_MS) {
  const released: string[] = []
  const scheduled = new Map<number, { run: () => void; delayMs: number }>()
  let nextHandle = 1

  const timers: RendererLeaseTimers = {
    schedule: (run, delay) => {
      const handle = nextHandle++
      scheduled.set(handle, { run, delayMs: delay })
      return handle
    },
    cancel: (handle) => {
      scheduled.delete(handle)
    }
  }

  return {
    released,
    scheduled,
    lease: createRendererLease((terminalId) => released.push(terminalId), timers, delayMs),
    /** Fires every timer that is still armed, oldest first. */
    flush: () => {
      for (const [handle, timer] of [...scheduled]) {
        scheduled.delete(handle)
        timer.run()
      }
    }
  }
}

describe('terminal renderer lease', () => {
  it('keeps the renderer when a pane is re-attached before the delay elapses', () => {
    const harness = createHarness()

    harness.lease.scheduleRelease('pane-1')
    harness.lease.acquire('pane-1')
    harness.flush()

    expect(harness.released).toEqual([])
    expect(harness.lease.pendingCount()).toBe(0)
  })

  it('releases a pane that stays off screen', () => {
    const harness = createHarness()

    harness.lease.scheduleRelease('pane-1')
    expect(harness.released).toEqual([])
    expect(harness.lease.pendingCount()).toBe(1)

    harness.flush()

    expect(harness.released).toEqual(['pane-1'])
    expect(harness.lease.pendingCount()).toBe(0)
  })

  it('schedules the release once per pane', () => {
    const harness = createHarness()

    harness.lease.scheduleRelease('pane-1')
    harness.lease.scheduleRelease('pane-1')
    harness.lease.scheduleRelease('pane-2')

    expect(harness.lease.pendingCount()).toBe(2)

    harness.flush()

    expect(harness.released).toEqual(['pane-1', 'pane-2'])
  })

  it('releases immediately and drops the pending timer', () => {
    const harness = createHarness()

    harness.lease.scheduleRelease('pane-1')
    harness.lease.releaseNow('pane-1')

    expect(harness.released).toEqual(['pane-1'])
    expect(harness.scheduled.size).toBe(0)

    harness.flush()

    expect(harness.released).toEqual(['pane-1'])
  })

  it('leaves no timers behind when acquiring a pane that never scheduled one', () => {
    const harness = createHarness()

    harness.lease.acquire('pane-1')

    expect(harness.scheduled.size).toBe(0)
    expect(harness.released).toEqual([])
  })

  it('uses the configured delay', () => {
    const harness = createHarness(500)

    harness.lease.scheduleRelease('pane-1')

    expect([...harness.scheduled.values()][0]?.delayMs).toBe(500)
  })
})
