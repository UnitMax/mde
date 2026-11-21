import { rgba, type FancyPalette } from '@/fancy/color'
import { between, clamp, hashString, mulberry32, type Random } from '@/fancy/random'
import { addFrameTask, prefersReducedMotion } from './scheduler'
import {
  crackle,
  drawLightningBolt,
  generateBolt,
  lightningColors,
  roundedPerimeter,
  strikeEnvelope,
  STRIKE_SECONDS,
  type Bolt,
  type Point
} from './thread-effects/lightning'

/** One bolt of the strike: when it lands, its path, and the sparks it throws where it hits. */
interface StrikeBolt {
  start: number
  bolt: Bolt
  end: Point
  sparks: Array<{ vx: number; vy: number }>
}

export interface TerminalStrike {
  /** Seconds from the first flash to the last spark. */
  duration: number
  /** Draws the strike `time` seconds after it began, in CSS pixels; the canvas is cleared first. */
  draw: (context: CanvasRenderingContext2D, time: number) => void
}

const CORNER_RADIUS = 6
const CURRENT_SECONDS = 0.62

function makeBolt(random: Random, width: number, height: number, start: number): StrikeBolt {
  // Down from the top most of the time; across a pane that is much wider than it is tall now and then.
  const across = width > height * 1.6 && random() < 0.35
  let from: Point
  let to: Point
  if (across) {
    const leftToRight = random() < 0.5
    from = { x: leftToRight ? -4 : width + 4, y: between(random, 0.15, 0.85) * height }
    to = { x: leftToRight ? width + 4 : -4, y: between(random, 0.15, 0.85) * height }
  } else {
    const x = between(random, 0.1, 0.9) * width
    from = { x, y: -4 }
    to = { x: clamp(x + between(random, -0.25, 0.25) * width, 8, width - 8), y: height - between(random, 0, 0.18) * height }
  }
  const bolt = generateBolt(random, from, to, { depth: 7, roughness: across ? 0.09 : 0.16, branchChance: 0.12, maxBranches: 5 })
  const sparks = Array.from({ length: 12 }, () => {
    const angle = random() * Math.PI * 2
    const speed = between(random, 60, 220)
    return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 50 }
  })
  return { start, bolt, end: to, sparks }
}

/**
 * Lightning over a whole terminal, once: two or three bolts crack down through it a moment apart, the pane flashes
 * with each, a current races round its border and sparks fly where the bolts land. It is drawn over the terminal's
 * text, so it is short (under a second) and the flash stays faint.
 */
export function createTerminalStrike(palette: FancyPalette, seed: string, width: number, height: number): TerminalStrike {
  const random = mulberry32(hashString(`terminal-strike:${seed}`))
  const dark = palette.mode === 'dark'
  const colors = lightningColors(palette)
  const { glow, core } = colors
  const count = random() < 0.45 ? 3 : 2
  const bolts: StrikeBolt[] = []
  let start = 0
  for (let index = 0; index < count; index += 1) {
    bolts.push(makeBolt(random, width, height, start))
    start += between(random, 0.07, 0.14)
  }
  const perimeter = roundedPerimeter(width, height, CORNER_RADIUS)
  const offset = random() * perimeter.length
  const scale = clamp(Math.min(width, height) / 220, 1, 1.8)
  const duration = Math.max(CURRENT_SECONDS, bolts[bolts.length - 1]!.start + STRIKE_SECONDS)

  const drawCurrent = (context: CanvasRenderingContext2D, head: number, length: number, strength: number, time: number): void => {
    const steps = 72
    let previous: Point | null = null
    context.lineCap = 'round'
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps
      const place = perimeter.at(head - length * (1 - t))
      const sway = crackle(step * 0.5, time * 18, 7) * (0.6 + 1.8 * t)
      const point = { x: place.x + place.nx * sway, y: place.y + place.ny * sway }
      if (previous) {
        const fade = t ** 2 * strength
        context.strokeStyle = rgba(glow, 0.35 * fade)
        context.lineWidth = 4 * scale
        context.beginPath()
        context.moveTo(previous.x, previous.y)
        context.lineTo(point.x, point.y)
        context.stroke()
        context.strokeStyle = rgba(core, 0.95 * fade)
        context.lineWidth = 1.2 * scale
        context.beginPath()
        context.moveTo(previous.x, previous.y)
        context.lineTo(point.x, point.y)
        context.stroke()
      }
      previous = point
    }
  }

  return {
    duration,
    draw: (context, time) => {
      context.clearRect(0, 0, width, height)
      if (time < 0 || time >= duration || width === 0 || height === 0) return
      context.globalCompositeOperation = dark ? 'lighter' : 'source-over'

      // The pane lights up with each bolt; the brightest one sets the flash.
      const flash = Math.max(...bolts.map((entry) => strikeEnvelope(time - entry.start)))
      if (flash > 0) {
        const wash = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.hypot(width, height) / 2)
        wash.addColorStop(0, rgba(glow, 0.07 * flash))
        wash.addColorStop(1, rgba(glow, 0.2 * flash))
        context.fillStyle = wash
        context.fillRect(0, 0, width, height)
      }

      // The border charges up and a current races round it, two heads half a lap apart.
      const charge = clamp(1 - time / duration, 0, 1)
      context.lineWidth = 1.5
      context.strokeStyle = rgba(glow, (0.25 + 0.4 * flash) * charge)
      context.beginPath()
      if (context.roundRect) context.roundRect(0.75, 0.75, width - 1.5, height - 1.5, CORNER_RADIUS)
      else context.rect(0.75, 0.75, width - 1.5, height - 1.5)
      context.stroke()
      if (time < CURRENT_SECONDS) {
        const progress = time / CURRENT_SECONDS
        // Fast at first, easing out as the charge is spent.
        const run = offset + perimeter.length * 0.55 * (1 - (1 - progress) ** 2)
        const strength = 1 - progress ** 3
        const length = perimeter.length * 0.16
        drawCurrent(context, run, length, strength, time)
        drawCurrent(context, run + perimeter.length / 2, length, strength, time + 0.3)
      }

      for (const entry of bolts) {
        const age = time - entry.start
        const strength = strikeEnvelope(age)
        if (strength <= 0) continue
        const flicker = age < 0.2 ? 0.75 + 0.25 * Math.sin(age * 220) : 1
        drawLightningBolt(context, entry.bolt, strength * flicker, colors, scale)
        const radius = 34 * scale
        const impact = context.createRadialGradient(entry.end.x, entry.end.y, 0, entry.end.x, entry.end.y, radius)
        impact.addColorStop(0, rgba(core, 0.8 * strength))
        impact.addColorStop(0.4, rgba(glow, 0.28 * strength))
        impact.addColorStop(1, rgba(glow, 0))
        context.fillStyle = impact
        context.fillRect(entry.end.x - radius, entry.end.y - radius, radius * 2, radius * 2)
        const life = clamp(1 - age / STRIKE_SECONDS, 0, 1)
        context.lineWidth = 1.3
        context.strokeStyle = rgba(core, 0.9 * life)
        for (const spark of entry.sparks) {
          const x = entry.end.x + spark.vx * age
          const y = entry.end.y + spark.vy * age + 260 * age * age
          context.beginPath()
          context.moveTo(x, y)
          context.lineTo(x - spark.vx * 0.025, y - spark.vy * 0.025)
          context.stroke()
        }
      }
      context.globalCompositeOperation = 'source-over'
    }
  }
}

/**
 * Plays one strike on `canvas`, sized to its element, and clears it when done. Calling the returned function stops
 * it early. With reduced motion asked for in the system, nothing is drawn: a flash is all motion.
 */
export function playTerminalStrike(canvas: HTMLCanvasElement, palette: FancyPalette, seed: string): () => void {
  if (prefersReducedMotion()) return () => undefined
  const context = canvas.getContext('2d')
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (!context || width === 0 || height === 0) return () => undefined
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
  canvas.width = Math.max(1, Math.round(width * dpr))
  canvas.height = Math.max(1, Math.round(height * dpr))
  const strike = createTerminalStrike(palette, seed, width, height)
  const startedAt = performance.now()
  let stop: (() => void) | null = null
  const clear = (): void => {
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, canvas.width, canvas.height)
  }
  stop = addFrameTask({
    fps: 60,
    frame: (now) => {
      const time = (now - startedAt) / 1000
      if (time >= strike.duration) {
        clear()
        stop?.()
        stop = null
        return
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      strike.draw(context, time)
    }
  })
  return () => {
    stop?.()
    stop = null
    clear()
  }
}
