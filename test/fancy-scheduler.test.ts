// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addFrameTask, prefersReducedMotion, runningFrameTasks } from '../src/renderer/fancy/scheduler'

let callbacks: Array<(now: number) => void> = []
let cancelled = 0
let clock = 0

/** Runs the pending animation frame, as the browser would, at the given time. */
function frame(now: number): void {
  clock = now
  const pending = callbacks
  callbacks = []
  for (const callback of pending) callback(now)
}

beforeEach(() => {
  callbacks = []
  cancelled = 0
  clock = 100_000
  vi.stubGlobal('requestAnimationFrame', (callback: (now: number) => void) => callbacks.push(callback))
  vi.stubGlobal('cancelAnimationFrame', () => { cancelled += 1; callbacks = [] })
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the shared animation loop', () => {
  it('runs a task, tells it how long it has been, and stops when it is removed', () => {
    const calls: Array<[number, number]> = []
    const stop = addFrameTask({ fps: 60, frame: (now, dt) => calls.push([now, dt]) })
    expect(runningFrameTasks()).toBe(1)
    frame(100_016)
    frame(100_032)
    expect(calls).toHaveLength(2)
    expect(calls[1]![1]).toBeCloseTo(0.016, 3)
    stop()
    expect(runningFrameTasks()).toBe(0)
    expect(cancelled).toBe(1)
    frame(100_048)
    expect(calls).toHaveLength(2)
  })

  it('holds each task to its own frame rate', () => {
    const fast = vi.fn()
    const slow = vi.fn()
    const stopFast = addFrameTask({ fps: 60, frame: fast })
    const stopSlow = addFrameTask({ fps: 20, frame: slow })
    for (let step = 1; step <= 30; step += 1) frame(100_000 + step * 16.67)
    expect(fast.mock.calls.length).toBeGreaterThanOrEqual(29)
    expect(slow.mock.calls.length).toBeGreaterThanOrEqual(8)
    expect(slow.mock.calls.length).toBeLessThanOrEqual(11)
    stopFast()
    stopSlow()
  })

  it('does not draw while the page is hidden, and carries on when it is shown again', () => {
    const task = vi.fn()
    const stop = addFrameTask({ fps: 60, frame: task })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    frame(100_016)
    frame(100_032)
    expect(task).not.toHaveBeenCalled()
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    frame(100_048)
    expect(task).toHaveBeenCalledTimes(1)
    stop()
  })

  it('takes out a task that throws, and keeps the others going', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const good = vi.fn()
    const stopBad = addFrameTask({ fps: 60, frame: () => { throw new Error('broken') } })
    const stopGood = addFrameTask({ fps: 60, frame: good })
    frame(100_016)
    frame(100_032)
    expect(error).toHaveBeenCalledTimes(1)
    expect(good).toHaveBeenCalledTimes(2)
    expect(runningFrameTasks()).toBe(1)
    stopBad()
    stopGood()
  })

  it('reads the system’s wish for less motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }))
    expect(prefersReducedMotion()).toBe(true)
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect(prefersReducedMotion()).toBe(false)
  })
})
