export type SpawnPriority = 'interactive' | 'background'

export interface SpawnLimiter {
  /** Runs the task once a slot is free. Interactive work is started before queued background work. */
  run<T>(priority: SpawnPriority, task: () => Promise<T>): Promise<T>
  readonly active: number
  readonly queued: number
}

/**
 * Bounds how many child processes are in flight at once.
 *
 * A Git refresh across many sessions starts dozens of processes together, each of them a
 * `wsl.exe` for a WSL session. Spreading the same work across a few slots keeps that burst from
 * crowding out everything else, such as the user's own Git requests, at almost no cost in latency.
 * It does not keep the main thread free; `exec-host.ts` does that.
 */
export function createSpawnLimiter(maxConcurrent: number): SpawnLimiter {
  const queues: Record<SpawnPriority, Array<() => void>> = { interactive: [], background: [] }
  let active = 0

  const startQueued = (): void => {
    while (active < maxConcurrent) {
      const start = queues.interactive.shift() ?? queues.background.shift()
      if (!start) return
      start()
    }
  }

  return {
    run<T>(priority: SpawnPriority, task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queues[priority].push(() => {
          active += 1
          let running: Promise<T>
          try {
            running = task()
          } catch (error) {
            running = Promise.reject(error)
          }
          running.then(resolve, reject).finally(() => {
            active -= 1
            startQueued()
          })
        })
        startQueued()
      })
    },
    get active() {
      return active
    },
    get queued() {
      return queues.interactive.length + queues.background.length
    }
  }
}
