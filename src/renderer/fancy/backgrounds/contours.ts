import { lighten, mixRgb, rgba, type FancyPalette, type Rgb } from '@/fancy/color'
import { createNoise3 } from '@/fancy/random'
import { emitCellSegments } from './contours-math'
import type { BackgroundRenderer } from './types'

/** The grid the height field is sampled on, in CSS pixels. Smaller is smoother and costs more. */
const CELL = 16
/** Heights run from about -LIMIT to LIMIT; a line is drawn every STEP. */
const LIMIT = 0.84
const STEP = 0.07
/** Every this many lines one is drawn heavier, as on a survey map. */
const MAJOR_EVERY = 4
const BUCKETS = 6

/**
 * Contours: a topographic map of ground that slowly breathes. A height field of drifting noise is sampled on a
 * coarse grid and the lines where it crosses evenly spaced heights are traced with marching squares, so a frame is
 * a few thousand short segments. Low ground is cyan, the middle the theme's accent, peaks violet; every fourth
 * line is heavier and glows, and survey crosses mark the grid.
 */
export function createContours(palette: FancyPalette): BackgroundRenderer {
  const dark = palette.mode === 'dark'
  const noise = createNoise3(0xc0470a)
  const tone = (color: Rgb): Rgb => (dark ? lighten(color, 0.1) : mixRgb(color, palette.fg, 0.18))
  const bucketColors = Array.from({ length: BUCKETS }, (_, index) => {
    const t = index / (BUCKETS - 1)
    return t < 0.5 ? mixRgb(tone(palette.cyan), tone(palette.accent), t * 2) : mixRgb(tone(palette.accent), tone(palette.violet), (t - 0.5) * 2)
  })

  let width = 0
  let height = 0
  let cols = 0
  let rows = 0
  let field = new Float32Array(0)
  const minor: number[][] = Array.from({ length: BUCKETS }, () => [])
  const major: number[][] = Array.from({ length: BUCKETS }, () => [])

  const sample = (x: number, y: number, z: number): number => {
    const nx = x / 430
    const ny = y / 430
    // Two octaves; the second is finer and drifts the other way, so the ground churns instead of sliding.
    return (noise(nx, ny, z) + 0.45 * noise(nx * 2.3 + 17, ny * 2.3 + 3, -z * 1.4)) / 1.45 * 1.25
  }

  return {
    scale: (dpr) => Math.min(2, Math.max(1, dpr)),
    resize: (cssWidth, cssHeight) => {
      width = cssWidth
      height = cssHeight
      cols = Math.ceil(width / CELL) + 2
      rows = Math.ceil(height / CELL) + 2
      field = new Float32Array(cols * rows)
    },
    draw: (context, time) => {
      context.clearRect(0, 0, width, height)
      if (cols === 0) return

      const z = time * 0.045
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < cols; column += 1) {
          field[row * cols + column] = sample(column * CELL, row * CELL, z)
        }
      }

      for (const list of minor) list.length = 0
      for (const list of major) list.length = 0

      const lowest = Math.round(-LIMIT / STEP)
      const highest = Math.round(LIMIT / STEP)
      for (let row = 0; row < rows - 1; row += 1) {
        for (let column = 0; column < cols - 1; column += 1) {
          const a = field[row * cols + column]!
          const b = field[row * cols + column + 1]!
          const c = field[(row + 1) * cols + column + 1]!
          const d = field[(row + 1) * cols + column]!
          const low = Math.min(a, b, c, d)
          const high = Math.max(a, b, c, d)
          const first = Math.max(lowest, Math.ceil(low / STEP))
          const last = Math.min(highest, Math.floor(high / STEP))
          for (let step = first; step <= last; step += 1) {
            const bucket = Math.min(BUCKETS - 1, Math.max(0, Math.floor(((step - lowest) / (highest - lowest)) * BUCKETS)))
            const target = step % MAJOR_EVERY === 0 ? major[bucket]! : minor[bucket]!
            emitCellSegments(field, cols, column, row, CELL, step * STEP, target)
          }
        }
      }

      const stroke = (segments: number[], color: Rgb, alpha: number, lineWidth: number): void => {
        if (segments.length === 0) return
        context.beginPath()
        for (let index = 0; index < segments.length; index += 4) {
          context.moveTo(segments[index]!, segments[index + 1]!)
          context.lineTo(segments[index + 2]!, segments[index + 3]!)
        }
        context.strokeStyle = rgba(color, alpha)
        context.lineWidth = lineWidth
        context.stroke()
      }

      context.lineCap = 'round'
      context.globalCompositeOperation = dark ? 'lighter' : 'source-over'
      for (let bucket = 0; bucket < BUCKETS; bucket += 1) {
        stroke(minor[bucket]!, bucketColors[bucket]!, 0.55, 0.8)
      }
      for (let bucket = 0; bucket < BUCKETS; bucket += 1) {
        // The heavier lines glow: a wide faint stroke under a thin bright one.
        stroke(major[bucket]!, bucketColors[bucket]!, 0.16, 5)
        stroke(major[bucket]!, bucketColors[bucket]!, 1, 1.3)
      }

      // Survey crosses on a 140px grid.
      const pitch = 140
      context.strokeStyle = rgba(palette.fgMuted, 0.45)
      context.lineWidth = 1
      context.beginPath()
      for (let y = pitch / 2; y < height; y += pitch) {
        for (let x = pitch / 2; x < width; x += pitch) {
          context.moveTo(x - 3, y)
          context.lineTo(x + 3, y)
          context.moveTo(x, y - 3)
          context.lineTo(x, y + 3)
        }
      }
      context.stroke()
      context.globalCompositeOperation = 'source-over'
    }
  }
}
