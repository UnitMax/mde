import type { FancyPalette } from '@/fancy/color'

/**
 * An animated background. It draws in CSS pixels onto a canvas that the host has sized to `scale(dpr)` times the
 * element and scaled the context to match, so a soft background can render small and be enlarged for free.
 */
export interface BackgroundRenderer {
  /** How many canvas pixels there are to a CSS pixel on a screen with this device pixel ratio. */
  scale: (devicePixelRatio: number) => number
  /** The element is now this many CSS pixels across. */
  resize: (width: number, height: number) => void
  /** Draws the picture at `time` seconds. It clears the canvas first; the page's own color shows through. */
  draw: (context: CanvasRenderingContext2D, time: number) => void
  /** The cursor moved to a point in CSS pixels of the element, or left it (null). */
  pointer?: (point: { x: number; y: number } | null) => void
  /** Releases anything the renderer holds besides memory the browser collects. */
  dispose?: () => void
}

export type BackgroundFactory = (palette: FancyPalette) => BackgroundRenderer

/** A small canvas to draw a sprite on once and stamp many times. */
export function makeSprite(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width))
  canvas.height = Math.max(1, Math.ceil(height))
  const context = canvas.getContext('2d')
  return context ? { canvas, context } : null
}
