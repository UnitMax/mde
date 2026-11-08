import type { FancyPalette } from '@/fancy/color'
import { addFrameTask, prefersReducedMotion } from './scheduler'
import { createThreadEffect, THREAD_EFFECT_FPS, type ThreadEffectKind } from './thread-effects'

/**
 * Plays a thread effect on `canvas`, sized to its element. The effect runs only while the row is on screen: a list
 * of fifty glowing threads costs what the dozen that can be seen cost. Under reduced motion it draws one still frame.
 */
export function mountThreadEffect(
  canvas: HTMLCanvasElement,
  kind: ThreadEffectKind,
  palette: FancyPalette,
  seed: string
): () => void {
  const context = canvas.getContext('2d')
  if (!context) return () => undefined

  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
  const effect = createThreadEffect(kind, palette, seed, dpr)
  const reduced = prefersReducedMotion()
  let visible = typeof IntersectionObserver === 'undefined'
  let stopTask: (() => void) | null = null
  let sized = false

  const paintStill = (): void => {
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
    effect.still(context)
  }

  const sync = (): void => {
    const run = visible && sized && !reduced
    if (run && !stopTask) {
      const startedAt = performance.now()
      stopTask = addFrameTask({
        fps: THREAD_EFFECT_FPS,
        frame: (now) => {
          context.setTransform(dpr, 0, 0, dpr, 0, 0)
          effect.draw(context, (now - startedAt) / 1000)
        }
      })
    } else if (!run && stopTask) {
      stopTask()
      stopTask = null
    }
    if (reduced && sized && visible) paintStill()
  }

  const measure = (): void => {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(height * dpr))
    effect.resize(width, height)
    sized = true
    sync()
  }

  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
  resizeObserver?.observe(canvas)
  const intersectionObserver = typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver((entries) => {
        visible = entries[entries.length - 1]?.isIntersecting ?? visible
        sync()
      })
  intersectionObserver?.observe(canvas)
  measure()

  return () => {
    stopTask?.()
    stopTask = null
    resizeObserver?.disconnect()
    intersectionObserver?.disconnect()
  }
}
