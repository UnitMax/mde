/**
 * One animation loop for everything fancy mode draws: the background and every glowing thread row share a single
 * `requestAnimationFrame`, each task asks for its own frame rate, and the loop stops while nothing is on screen to
 * see it (the window is hidden or minimised) or nothing is subscribed.
 */
export interface FrameTask {
  /** Draws one frame. `now` is milliseconds on the loop's clock; `dt` is the seconds since this task's last frame. */
  frame: (now: number, dt: number) => void
  /** The most frames a second this task wants. */
  fps: number
}

interface Entry {
  task: FrameTask
  last: number
}

const entries = new Set<Entry>()
let handle: number | null = null

function tick(now: number): void {
  handle = null
  if (typeof document !== 'undefined' && document.hidden) return resume()
  for (const entry of [...entries]) {
    const interval = 1000 / entry.task.fps
    // A little slack so a 30 fps task is not held to 20 by a 60 Hz display's frame boundaries.
    if (now - entry.last < interval - 4) continue
    const dt = Math.min(0.25, (now - entry.last) / 1000)
    entry.last = now
    try {
      entry.task.frame(now, dt)
    } catch (error) {
      // One task failing must not stop the others; it is taken out so it cannot fail again every frame.
      entries.delete(entry)
      console.error('Fancy mode animation stopped:', error)
    }
  }
  resume()
}

function resume(): void {
  if (handle !== null || entries.size === 0 || typeof requestAnimationFrame === 'undefined') return
  handle = requestAnimationFrame(tick)
}

/** Starts calling `task` until the returned function is called. */
export function addFrameTask(task: FrameTask): () => void {
  const entry: Entry = { task, last: typeof performance === 'undefined' ? 0 : performance.now() - 1000 }
  entries.add(entry)
  resume()
  return () => {
    entries.delete(entry)
    if (entries.size === 0 && handle !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(handle)
      handle = null
    }
  }
}

/** How many tasks are running; for tests. */
export function runningFrameTasks(): number {
  return entries.size
}

/** Whether the person asked the system for less motion. Fancy mode then draws still pictures. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
