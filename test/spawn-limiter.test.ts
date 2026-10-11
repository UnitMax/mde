import { describe, expect, it } from 'vitest'
import { createSpawnLimiter } from '../src/main/spawn-limiter'

/** A task the test finishes by hand, so ordering and concurrency can be observed. */
function manualTask<T = void>() {
  let finish!: (value: T) => void
  let fail!: (error: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    finish = resolve
    fail = reject
  })
  return { promise, finish, fail }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('createSpawnLimiter', () => {
  it('never runs more tasks at once than the limit', async () => {
    const limiter = createSpawnLimiter(3)
    let running = 0
    let peak = 0
    const tasks = Array.from({ length: 12 }, () => manualTask())

    const all = tasks.map((task) =>
      limiter.run('background', async () => {
        running += 1
        peak = Math.max(peak, running)
        await task.promise
        running -= 1
      })
    )
    await tick()
    expect(limiter.active).toBe(3)
    expect(limiter.queued).toBe(9)

    for (const task of tasks) {
      task.finish()
      await tick()
    }
    await Promise.all(all)

    expect(peak).toBe(3)
    expect(limiter.active).toBe(0)
    expect(limiter.queued).toBe(0)
  })

  it('resolves with the task result', async () => {
    const limiter = createSpawnLimiter(2)

    await expect(limiter.run('interactive', async () => 'done')).resolves.toBe('done')
  })

  it('starts queued interactive work before queued background work', async () => {
    const limiter = createSpawnLimiter(1)
    const started: string[] = []
    const gate = manualTask()
    const record = (name: string) => async () => {
      started.push(name)
    }

    const first = limiter.run('background', async () => {
      started.push('first')
      await gate.promise
    })
    const background = [limiter.run('background', record('background-1')), limiter.run('background', record('background-2'))]
    const interactive = [limiter.run('interactive', record('interactive-1')), limiter.run('interactive', record('interactive-2'))]

    gate.finish()
    await Promise.all([first, ...background, ...interactive])

    expect(started).toEqual(['first', 'interactive-1', 'interactive-2', 'background-1', 'background-2'])
  })

  it('keeps first-come order within a priority', async () => {
    const limiter = createSpawnLimiter(1)
    const started: number[] = []
    const gate = manualTask()
    const blocker = limiter.run('background', () => gate.promise)

    const queued = [1, 2, 3, 4].map((id) => limiter.run('background', async () => { started.push(id) }))
    gate.finish()
    await Promise.all([blocker, ...queued])

    expect(started).toEqual([1, 2, 3, 4])
  })

  it('frees the slot when a task rejects, and passes the error on', async () => {
    const limiter = createSpawnLimiter(1)

    const failing = limiter.run('background', async () => {
      throw new Error('spawn failed')
    })
    const after = limiter.run('background', async () => 'ran')

    await expect(failing).rejects.toThrow('spawn failed')
    await expect(after).resolves.toBe('ran')
    expect(limiter.active).toBe(0)
  })

  it('treats a task that throws synchronously as a rejection', async () => {
    const limiter = createSpawnLimiter(1)

    await expect(limiter.run('interactive', () => { throw new Error('boom') })).rejects.toThrow('boom')
    await expect(limiter.run('interactive', async () => 1)).resolves.toBe(1)
    expect(limiter.active).toBe(0)
  })

  it('refills freed slots straight away', async () => {
    const limiter = createSpawnLimiter(2)
    const [a, b, c] = [manualTask(), manualTask(), manualTask()]
    const started: string[] = []
    const runs = [
      limiter.run('background', async () => { started.push('a'); await a.promise }),
      limiter.run('background', async () => { started.push('b'); await b.promise }),
      limiter.run('background', async () => { started.push('c'); await c.promise })
    ]
    await tick()
    expect(started).toEqual(['a', 'b'])

    a.finish()
    await tick()
    expect(started).toEqual(['a', 'b', 'c'])

    b.finish()
    c.finish()
    await Promise.all(runs)
  })
})
