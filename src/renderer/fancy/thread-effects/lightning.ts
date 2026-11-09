import { darken, lighten, mixRgb, rgba, type FancyPalette, type Rgb } from '@/fancy/color'
import { between, clamp, hashString, mulberry32, type Random } from '@/fancy/random'
import type { RowEffect } from './types'

export interface Point {
  x: number
  y: number
}

export interface Bolt {
  main: Point[]
  branches: Point[][]
}

/**
 * A lightning bolt from `from` to `to`, by midpoint displacement: each pass splits every segment in two and nudges
 * the new point sideways, by less each time, so the path is rough at every scale. A few short forks leave the main
 * stroke. The same random source always draws the same bolt.
 */
export function generateBolt(
  random: Random,
  from: Point,
  to: Point,
  options: { depth?: number; roughness?: number; branchChance?: number; maxBranches?: number } = {}
): Bolt {
  const depth = options.depth ?? 5
  const roughness = options.roughness ?? 0.2
  const branchChance = options.branchChance ?? 0.14
  const maxBranches = options.maxBranches ?? 3

  let points: Point[] = [from, to]
  let spread = roughness
  for (let pass = 0; pass < depth; pass += 1) {
    const next: Point[] = [points[0]!]
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1]!
      const b = points[index]!
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      const offset = (random() - 0.5) * 2 * spread * length
      // Perpendicular to the segment.
      const nx = length === 0 ? 0 : -(b.y - a.y) / length
      const ny = length === 0 ? 0 : (b.x - a.x) / length
      next.push({ x: (a.x + b.x) / 2 + nx * offset, y: (a.y + b.y) / 2 + ny * offset }, b)
    }
    points = next
    spread *= 0.62
  }

  const branches: Point[][] = []
  if (depth > 2) {
    const heading = Math.atan2(to.y - from.y, to.x - from.x)
    const total = Math.hypot(to.x - from.x, to.y - from.y)
    for (let index = 2; index < points.length - 2 && branches.length < maxBranches; index += 1) {
      if (random() > branchChance) continue
      const origin = points[index]!
      const angle = heading + (random() < 0.5 ? -1 : 1) * between(random, 0.35, 0.9)
      const reach = total * between(random, 0.12, 0.3)
      const end = { x: origin.x + Math.cos(angle) * reach, y: origin.y + Math.sin(angle) * reach }
      branches.push(generateBolt(random, origin, end, { depth: depth - 2, roughness, branchChance: 0, maxBranches: 0 }).main)
    }
  }
  return { main: points, branches }
}

/** How bright a strike is `age` seconds after it began: it flashes, dips, flashes again, then dies away. */
export const STRIKE_SECONDS = 0.52

export function strikeEnvelope(age: number): number {
  if (age < 0 || age >= STRIKE_SECONDS) return 0
  if (age < 0.05) return age / 0.05
  if (age < 0.11) return 1 - ((age - 0.05) / 0.06) * 0.65
  if (age < 0.15) return 0.35 + ((age - 0.11) / 0.04) * 0.55
  return 0.9 * Math.exp(-(age - 0.15) * 7.5) * (1 - (age - 0.15) / (STRIKE_SECONDS - 0.15) * 0.3)
}

/** Seconds of quiet before the next strike. */
export function nextStrikeDelay(random: Random): number {
  return between(random, 0.9, 2.6)
}

/** A point on the outline of a rounded rectangle, with the direction pointing out of the shape. */
export interface PerimeterPoint extends Point {
  nx: number
  ny: number
}

export function roundedPerimeter(width: number, height: number, radius: number): {
  length: number
  at: (distance: number) => PerimeterPoint
} {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  const top = width - 2 * r
  const side = height - 2 * r
  const corner = (Math.PI / 2) * r
  const length = 2 * top + 2 * side + 4 * corner
  return {
    length,
    at: (distance) => {
      let d = ((distance % length) + length) % length
      if (d < top) return { x: r + d, y: 0, nx: 0, ny: -1 }
      d -= top
      if (d < corner) return arc(width - r, r, r, -Math.PI / 2 + d / r)
      d -= corner
      if (d < side) return { x: width, y: r + d, nx: 1, ny: 0 }
      d -= side
      if (d < corner) return arc(width - r, height - r, r, d / r)
      d -= corner
      if (d < top) return { x: width - r - d, y: height, nx: 0, ny: 1 }
      d -= top
      if (d < corner) return arc(r, height - r, r, Math.PI / 2 + d / r)
      d -= corner
      if (d < side) return { x: 0, y: height - r - d, nx: -1, ny: 0 }
      d -= side
      return arc(r, r, r, Math.PI + d / r)
    }
  }
}

function arc(cx: number, cy: number, r: number, angle: number): PerimeterPoint {
  return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, nx: Math.cos(angle), ny: Math.sin(angle) }
}

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
}

interface Strike {
  start: number
  bolt: Bolt
  end: Point
  sparks: Spark[]
}

/** A short arc that jumps in from the edge of the row and is gone in a blink. */
interface Arc {
  start: number
  points: Point[]
}

export const ARC_SECONDS = 0.2

/** How bright a small arc is `age` seconds after it began: a hard flicker that dies away. */
export function arcEnvelope(age: number): number {
  if (age < 0 || age >= ARC_SECONDS) return 0
  const flicker = age < 0.1 ? (Math.floor(age * 90) % 2 === 0 ? 1 : 0.45) : 1
  return flicker * (1 - age / ARC_SECONDS)
}

const CORNER_RADIUS = 4

/** A cheap hash of three integers to [0, 1), for the current's crackle. */
function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2f)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

const smooth = (t: number): number => t * t * (3 - 2 * t)

/**
 * Value noise in [-1, 1] over a position along the arc and a time: smooth between neighbors on both axes, so the
 * current wavers like a held wire instead of flickering like static.
 */
export function crackle(position: number, time: number, seed: number): number {
  const x = Math.floor(position)
  const t = Math.floor(time)
  const fx = smooth(position - x)
  const ft = smooth(time - t)
  const at = (dx: number, dt: number): number => hash3(x + dx, t + dt, seed)
  const top = at(0, 0) + (at(1, 0) - at(0, 0)) * fx
  const bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * fx
  return (top + (bottom - top) * ft) * 2 - 1
}

/**
 * The effect on an unread thread: a storm kept in a small box. Two arcs of current run round the border, crackling,
 * and every couple of seconds a bolt cracks across the row, flashing twice, forking, and throwing sparks where it
 * lands; the row lights up with it and the current speeds up for a moment.
 */
export function createLightningEffect(palette: FancyPalette, seed: string): RowEffect {
  const dark = palette.mode === 'dark'
  const random = mulberry32(hashString(`lightning:${seed}`))
  const glow: Rgb = dark ? lighten(palette.accent, 0.12) : palette.accent
  const core: Rgb = dark ? mixRgb(palette.accent, [255, 255, 255], 0.88) : darken(palette.accent, 0.35)
  const halo: Rgb = dark ? mixRgb(palette.accent, palette.violet, 0.35) : palette.accent

  let width = 0
  let height = 0
  let strike: Strike | null = null
  let nextAt = between(random, 0.3, 1.4)
  let nextArcAt = between(random, 0.1, 0.6)
  let arcs: Arc[] = []
  let perimeter = roundedPerimeter(1, 1, 1)
  const phase = random() * 100
  /** How far the current has run round the border; it runs faster while a strike lights the row. */
  let travel = phase * 40
  let lastTime: number | null = null

  const makeStrike = (time: number): Strike => {
    const horizontal = random() < 0.62
    let from: Point
    let to: Point
    if (horizontal) {
      const leftToRight = random() < 0.5
      const y0 = between(random, 0.2, 0.8) * height
      const y1 = between(random, 0.2, 0.8) * height
      from = { x: leftToRight ? -3 : width + 3, y: y0 }
      to = { x: leftToRight ? width + 3 : -3, y: y1 }
    } else {
      const x = between(random, 0.12, 0.88) * width
      from = { x, y: -3 }
      to = { x: clamp(x + between(random, -0.22, 0.22) * width, 4, width - 4), y: height + 3 }
    }
    const bolt = generateBolt(random, from, to, { depth: horizontal ? 6 : 5, roughness: horizontal ? 0.1 : 0.2 })
    const sparks = Array.from({ length: 9 }, () => {
      const angle = random() * Math.PI * 2
      const speed = between(random, 30, 120)
      return { x: to.x, y: to.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 20 }
    })
    return { start: time, bolt, end: to, sparks }
  }

  /** A small arc from a random point on the border, reaching inward. */
  const makeArc = (time: number): Arc => {
    const side = Math.floor(random() * 4)
    const along = random()
    const reach = between(random, 22, 64)
    const lean = between(random, -0.7, 0.7)
    let from: Point
    let angle: number
    if (side === 0) { from = { x: along * width, y: 0 }; angle = Math.PI / 2 + lean }
    else if (side === 1) { from = { x: width, y: along * height }; angle = Math.PI + lean }
    else if (side === 2) { from = { x: along * width, y: height }; angle = -Math.PI / 2 + lean }
    else { from = { x: 0, y: along * height }; angle = lean }
    const to = { x: from.x + Math.cos(angle) * reach, y: from.y + Math.sin(angle) * reach }
    return { start: time, points: generateBolt(random, from, to, { depth: 4, roughness: 0.3, branchChance: 0, maxBranches: 0 }).main }
  }

  const strokePath = (context: CanvasRenderingContext2D, points: readonly Point[]): void => {
    context.beginPath()
    points.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)))
    context.stroke()
  }

  const drawBolt = (context: CanvasRenderingContext2D, bolt: Bolt, strength: number): void => {
    context.lineJoin = 'round'
    context.lineCap = 'round'
    const layers: Array<[Rgb, number, number]> = [
      [halo, 9, 0.12],
      [glow, 4.2, 0.38],
      [core, 1.5, 1]
    ]
    for (const [color, lineWidth, alpha] of layers) {
      context.strokeStyle = rgba(color, alpha * strength)
      context.lineWidth = lineWidth
      strokePath(context, bolt.main)
    }
    for (const branch of bolt.branches) {
      context.strokeStyle = rgba(glow, 0.3 * strength)
      context.lineWidth = 2.6
      strokePath(context, branch)
      context.strokeStyle = rgba(core, 0.8 * strength)
      context.lineWidth = 0.9
      strokePath(context, branch)
    }
  }

  /** The current: a bright head with a tail that fades, wavering sideways as if it were hard to hold. */
  const drawCurrent = (context: CanvasRenderingContext2D, head: number, length: number, time: number, energy: number): void => {
    const steps = 56
    const points: Array<Point & { t: number }> = []
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps
      const place = perimeter.at(head - length * (1 - t))
      // Fine ripples along the wire, moving over time; stronger near the head.
      const sway = crackle(step * 0.45 + phase, time * 15, 3) * (0.35 + 1.15 * t) * (0.8 + energy * 1.2)
      points.push({ x: place.x + place.nx * sway, y: place.y + place.ny * sway, t })
    }
    context.lineCap = 'butt'
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1]!
      const b = points[index]!
      const fade = b.t ** 2
      context.strokeStyle = rgba(glow, 0.3 * fade * (0.8 + energy * 0.6))
      context.lineWidth = 3.4
      context.beginPath()
      context.moveTo(a.x, a.y)
      context.lineTo(b.x, b.y)
      context.stroke()
      context.strokeStyle = rgba(core, 0.9 * fade)
      context.lineWidth = 1
      context.beginPath()
      context.moveTo(a.x, a.y)
      context.lineTo(b.x, b.y)
      context.stroke()
    }
    const tip = points[points.length - 1]!
    const flare = context.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 7)
    flare.addColorStop(0, rgba(core, 0.85))
    flare.addColorStop(0.35, rgba(glow, 0.35))
    flare.addColorStop(1, rgba(glow, 0))
    context.fillStyle = flare
    context.fillRect(tip.x - 7, tip.y - 7, 14, 14)
  }

  const paintFrame = (context: CanvasRenderingContext2D, time: number, flash: number, run: number): void => {
    context.clearRect(0, 0, width, height)
    context.globalCompositeOperation = dark ? 'lighter' : 'source-over'

    // The row hums with charge, and lights up with each strike.
    const hum = 0.05 + 0.025 * Math.sin(time * 3.1 + phase)
    const wash = context.createLinearGradient(0, 0, width, 0)
    wash.addColorStop(0, rgba(glow, hum + 0.05))
    wash.addColorStop(0.55, rgba(halo, hum * 0.5))
    wash.addColorStop(1, rgba(glow, hum * 0.8))
    context.fillStyle = wash
    context.fillRect(0, 0, width, height)
    if (flash > 0) {
      context.fillStyle = rgba(glow, 0.26 * flash)
      context.fillRect(0, 0, width, height)
    }

    // A thin charged border, and the current running round it.
    context.lineWidth = 1
    context.strokeStyle = rgba(glow, 0.2 + 0.12 * flash)
    context.beginPath()
    context.roundRect?.(0.5, 0.5, width - 1, height - 1, CORNER_RADIUS)
    if (!context.roundRect) context.rect(0.5, 0.5, width - 1, height - 1)
    context.stroke()

    const length = perimeter.length * 0.2
    drawCurrent(context, run, length, time, flash)
    drawCurrent(context, run + perimeter.length / 2, length * 0.8, time + 0.37, flash)
  }

  return {
    resize: (cssWidth, cssHeight) => {
      width = cssWidth
      height = cssHeight
      perimeter = roundedPerimeter(width, height, CORNER_RADIUS)
      strike = null
    },
    draw: (context, time) => {
      if (width === 0) return
      if (!strike && time >= nextAt) {
        strike = makeStrike(time)
      }
      let flash = 0
      if (strike) {
        const age = time - strike.start
        flash = strikeEnvelope(age)
        if (age >= STRIKE_SECONDS) {
          strike = null
          nextAt = time + nextStrikeDelay(random)
        }
      }
      if (time >= nextArcAt) {
        arcs.push(makeArc(time))
        nextArcAt = time + between(random, 0.25, 0.7)
      }
      arcs = arcs.filter((arc) => time - arc.start < ARC_SECONDS)
      travel += (lastTime === null ? 0 : Math.min(0.25, time - lastTime)) * (240 + 520 * flash)
      lastTime = time
      paintFrame(context, time, flash, travel)
      context.lineJoin = 'round'
      context.lineCap = 'round'
      for (const arc of arcs) {
        const strength = arcEnvelope(time - arc.start)
        if (strength <= 0) continue
        context.strokeStyle = rgba(glow, 0.5 * strength)
        context.lineWidth = 3.2
        strokePath(context, arc.points)
        context.strokeStyle = rgba(core, 0.95 * strength)
        context.lineWidth = 1
        strokePath(context, arc.points)
      }

      if (strike) {
        const age = time - strike.start
        // The bolt flickers: it is redrawn a little differently in the first instants by wobbling its brightness.
        const flicker = age < 0.2 ? 0.75 + 0.25 * Math.sin(age * 220) : 1
        drawBolt(context, strike.bolt, flash * flicker)
        // Where it lands.
        const impact = context.createRadialGradient(strike.end.x, strike.end.y, 0, strike.end.x, strike.end.y, 26)
        impact.addColorStop(0, rgba(core, 0.85 * flash))
        impact.addColorStop(0.4, rgba(glow, 0.3 * flash))
        impact.addColorStop(1, rgba(glow, 0))
        context.fillStyle = impact
        context.fillRect(strike.end.x - 26, strike.end.y - 26, 52, 52)
        // Sparks thrown from there, falling.
        for (const spark of strike.sparks) {
          const x = spark.x + spark.vx * age
          const y = spark.y + spark.vy * age + 140 * age * age
          const life = clamp(1 - age / 0.5, 0, 1)
          if (life <= 0) continue
          context.strokeStyle = rgba(core, 0.9 * life)
          context.lineWidth = 1.1
          context.beginPath()
          context.moveTo(x, y)
          context.lineTo(x - spark.vx * 0.02, y - spark.vy * 0.02)
          context.stroke()
        }
      }
      context.globalCompositeOperation = 'source-over'
    },
    still: (context) => {
      if (width === 0) return
      const frozen = makeStrike(0)
      paintFrame(context, 0, 0.35, perimeter.length * 0.1)
      context.globalCompositeOperation = dark ? 'lighter' : 'source-over'
      drawBolt(context, frozen.bolt, 0.8)
      context.globalCompositeOperation = 'source-over'
    }
  }
}
