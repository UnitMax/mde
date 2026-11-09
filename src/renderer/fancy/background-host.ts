import { backgroundOpacity, type FancyPalette } from '@/fancy/color'
import type { FancyBackgroundId } from '@/fancy/settings'
import { BACKGROUND_FPS, BACKGROUND_STILL_TIME, createBackground } from './backgrounds'
import { addFrameTask, prefersReducedMotion } from './scheduler'

export interface BackgroundHost {
  /** Starts or stops the motion; stopped, the canvas keeps its last picture. Always still under reduced motion. */
  setAnimated: (animated: boolean) => void
  dispose: () => void
}

export interface BackgroundHostOptions {
  animated?: boolean
  followPointer?: boolean
  /**
   * Lay the picture out at this size and scale it to fit the canvas, at the device's full resolution: for a small
   * preview of a picture made for the whole window. It must have the canvas's proportions.
   */
  design?: { width: number; height: number }
  /** The layer's opacity, instead of the one the theme calls for. */
  opacity?: number
}

const NOOP_HOST: BackgroundHost = { setAnimated: () => undefined, dispose: () => undefined }

/**
 * Draws a background onto `canvas` and keeps it sized to the element. `followPointer` lets the picture react to the
 * cursor anywhere in the window (the canvas itself lets every click through, so it cannot hear it).
 */
export function mountBackground(
  canvas: HTMLCanvasElement,
  id: FancyBackgroundId,
  palette: FancyPalette,
  options: BackgroundHostOptions = {}
): BackgroundHost {
  const context = canvas.getContext('2d')
  if (!context) return NOOP_HOST

  const renderer = createBackground(id, palette)
  canvas.style.opacity = String(options.opacity ?? backgroundOpacity(palette))
  const origin = BACKGROUND_STILL_TIME[id]
  let scale = 1
  let stopTask: (() => void) | null = null
  let wanted = options.animated ?? true

  const paint = (time: number): void => {
    context.setTransform(scale, 0, 0, scale, 0, 0)
    renderer.draw(context, time)
  }
  const paintStill = (): void => paint(origin)

  const sync = (): void => {
    const animate = wanted && !prefersReducedMotion()
    if (animate && !stopTask) {
      const startedAt = performance.now()
      stopTask = addFrameTask({
        fps: BACKGROUND_FPS[id],
        frame: (now) => paint(origin + (now - startedAt) / 1000)
      })
    } else if (!animate) {
      stopTask?.()
      stopTask = null
      paintStill()
    }
  }

  const measure = (): void => {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    const dpr = window.devicePixelRatio || 1
    const design = options.design
    const resolution = design ? Math.max(1, dpr) : renderer.scale(dpr)
    scale = design ? resolution * (width / design.width) : resolution
    canvas.width = Math.max(1, Math.round(width * resolution))
    canvas.height = Math.max(1, Math.round(height * resolution))
    renderer.resize(design ? design.width : width, design ? design.height : height)
    // A stopped picture is cleared by resizing the canvas; a running one repaints at its next frame.
    if (!stopTask) paintStill()
  }

  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
  observer?.observe(canvas)
  measure()
  sync()

  let removePointer: (() => void) | null = null
  if (options.followPointer && renderer.pointer) {
    const move = (event: PointerEvent): void => {
      const box = canvas.getBoundingClientRect()
      renderer.pointer?.({ x: event.clientX - box.left, y: event.clientY - box.top })
    }
    const leave = (event: MouseEvent): void => {
      if (!event.relatedTarget) renderer.pointer?.(null)
    }
    window.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('mouseout', leave, { passive: true })
    removePointer = () => {
      window.removeEventListener('pointermove', move)
      document.removeEventListener('mouseout', leave)
    }
  }

  return {
    setAnimated: (animated) => {
      wanted = animated
      sync()
    },
    dispose: () => {
      stopTask?.()
      stopTask = null
      observer?.disconnect()
      removePointer?.()
      renderer.dispose?.()
    }
  }
}
