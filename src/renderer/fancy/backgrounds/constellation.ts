import { lighten, mixRgb, rgba, type FancyPalette, type Rgb } from '@/fancy/color'
import { between, clamp, mulberry32 } from '@/fancy/random'
import { makeSprite, type BackgroundRenderer } from './types'

interface Star {
  /** Where it drifts to, in CSS pixels; the cursor pushes the drawn position off it. */
  x: number
  y: number
  vx: number
  vy: number
  /** Eased offset from the cursor's pull. */
  ox: number
  oy: number
  radius: number
  phase: number
  rate: number
  tint: number
  /** A signal that just arrived lights the star; this fades from one to zero. */
  pulse: number
}

interface Packet {
  from: number
  to: number
  start: number
  duration: number
  hops: number
}

interface Shooter {
  x: number
  y: number
  angle: number
  speed: number
  start: number
  length: number
}

const LINK_DISTANCE = 150
const CURSOR_REACH = 200
const GLOW_SIZE = 64
const ALPHA_BUCKETS = 5

/**
 * Constellation: a drifting field of stars joined by hairlines where they come near each other. Signals hop along
 * the lines from star to star and light each one they reach; now and then a shooting star crosses; and the stars
 * near the cursor lean toward it and join it. It draws at full device resolution, since its lines are thin.
 */
export function createConstellation(palette: FancyPalette): BackgroundRenderer {
  const dark = palette.mode === 'dark'
  const random = mulberry32(0x5747a7)
  const tone = (color: Rgb): Rgb => (dark ? lighten(color, 0.12) : mixRgb(color, palette.fg, 0.22))
  const tints: Rgb[] = [tone(palette.accent), tone(palette.cyan), tone(palette.violet)]

  // A soft round glow for each tint, stamped under every star instead of building a gradient per star per frame.
  const glows = tints.map((color) => {
    const sprite = makeSprite(GLOW_SIZE, GLOW_SIZE)
    if (!sprite) return null
    const gradient = sprite.context.createRadialGradient(GLOW_SIZE / 2, GLOW_SIZE / 2, 0, GLOW_SIZE / 2, GLOW_SIZE / 2, GLOW_SIZE / 2)
    gradient.addColorStop(0, rgba(color, 0.85))
    gradient.addColorStop(0.18, rgba(color, 0.32))
    gradient.addColorStop(1, rgba(color, 0))
    sprite.context.fillStyle = gradient
    sprite.context.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE)
    return sprite.canvas
  })

  let width = 0
  let height = 0
  let stars: Star[] = []
  let packets: Packet[] = []
  let shooters: Shooter[] = []
  let cursor: { x: number; y: number } | null = null
  let cursorStrength = 0
  let last = 0
  let nextPacketAt = 0
  let nextShooterAt = 4
  const neighbors: number[][] = []

  const makeStar = (): Star => {
    const speed = between(random, 3, 11)
    const angle = random() * Math.PI * 2
    return {
      x: random() * width,
      y: random() * height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      ox: 0,
      oy: 0,
      radius: 0.7 + random() ** 2 * 1.9,
      phase: random() * Math.PI * 2,
      rate: between(random, 0.5, 1.7),
      tint: random() < 0.6 ? 0 : random() < 0.62 ? 1 : 2,
      pulse: 0
    }
  }

  return {
    scale: (dpr) => Math.min(2, Math.max(1, dpr)),
    resize: (cssWidth, cssHeight) => {
      const oldWidth = width || cssWidth
      const oldHeight = height || cssHeight
      width = cssWidth
      height = cssHeight
      const count = clamp(Math.round((width * height) / 10500), 12, 150)
      // Keep the stars where they were, relative to the window, and add or drop the difference.
      for (const star of stars) {
        star.x = (star.x / oldWidth) * width
        star.y = (star.y / oldHeight) * height
      }
      stars = stars.slice(0, count)
      while (stars.length < count) stars.push(makeStar())
      packets = []
    },
    pointer: (point) => {
      cursor = point
    },
    draw: (context, time) => {
      context.clearRect(0, 0, width, height)
      if (width === 0 || stars.length === 0) return
      const dt = last === 0 ? 0 : clamp(time - last, 0, 0.1)
      last = time

      cursorStrength += ((cursor ? 1 : 0) - cursorStrength) * Math.min(1, dt * 4)

      // Drift, wrap at the edges (a margin wider than a link, so no line pops in), and lean toward the cursor.
      const margin = LINK_DISTANCE
      for (const star of stars) {
        star.x += star.vx * dt
        star.y += star.vy * dt
        if (star.x < -margin) star.x += width + margin * 2
        else if (star.x > width + margin) star.x -= width + margin * 2
        if (star.y < -margin) star.y += height + margin * 2
        else if (star.y > height + margin) star.y -= height + margin * 2
        let targetX = 0
        let targetY = 0
        if (cursor) {
          const dx = cursor.x - star.x
          const dy = cursor.y - star.y
          const distance = Math.hypot(dx, dy)
          if (distance < CURSOR_REACH && distance > 1) {
            const pull = (1 - distance / CURSOR_REACH) ** 2 * 34
            targetX = (dx / distance) * pull
            targetY = (dy / distance) * pull
          }
        }
        star.ox += (targetX - star.ox) * Math.min(1, dt * 5)
        star.oy += (targetY - star.oy) * Math.min(1, dt * 5)
        star.pulse = Math.max(0, star.pulse - dt * 1.6)
      }

      const px = (star: Star): number => star.x + star.ox
      const py = (star: Star): number => star.y + star.oy

      // Links, in a few opacity bands so the whole web is a handful of strokes.
      const bands: number[][] = Array.from({ length: ALPHA_BUCKETS }, () => [])
      for (let index = 0; index < stars.length; index += 1) neighbors[index] = []
      for (let i = 0; i < stars.length; i += 1) {
        const a = stars[i]!
        for (let j = i + 1; j < stars.length; j += 1) {
          const b = stars[j]!
          const dx = px(a) - px(b)
          const dy = py(a) - py(b)
          if (Math.abs(dx) > LINK_DISTANCE || Math.abs(dy) > LINK_DISTANCE) continue
          const distance = Math.hypot(dx, dy)
          if (distance >= LINK_DISTANCE) continue
          neighbors[i]!.push(j)
          neighbors[j]!.push(i)
          const strength = 1 - distance / LINK_DISTANCE
          const band = Math.min(ALPHA_BUCKETS - 1, Math.floor(strength * ALPHA_BUCKETS))
          bands[band]!.push(px(a), py(a), px(b), py(b))
        }
      }

      context.globalCompositeOperation = dark ? 'lighter' : 'source-over'
      context.lineCap = 'round'
      context.lineWidth = 1
      for (let band = 0; band < ALPHA_BUCKETS; band += 1) {
        const segments = bands[band]!
        if (segments.length === 0) continue
        context.beginPath()
        for (let index = 0; index < segments.length; index += 4) {
          context.moveTo(segments[index]!, segments[index + 1]!)
          context.lineTo(segments[index + 2]!, segments[index + 3]!)
        }
        context.strokeStyle = rgba(tints[0]!, 0.22 + 0.78 * ((band + 0.5) / ALPHA_BUCKETS))
        context.stroke()
      }

      // The cursor joins the stars it is near, and gives off a glow of its own.
      if (cursor && cursorStrength > 0.02) {
        context.lineWidth = 1
        for (const star of stars) {
          const distance = Math.hypot(cursor.x - px(star), cursor.y - py(star))
          if (distance >= CURSOR_REACH) continue
          context.strokeStyle = rgba(tints[1]!, cursorStrength * (1 - distance / CURSOR_REACH) ** 1.2)
          context.beginPath()
          context.moveTo(cursor.x, cursor.y)
          context.lineTo(px(star), py(star))
          context.stroke()
        }
        const halo = glows[1]
        if (halo) {
          context.globalAlpha = cursorStrength * 0.9
          context.drawImage(halo, cursor.x - 80, cursor.y - 80, 160, 160)
          context.globalAlpha = 1
        }
      }

      // Signals: a bright dot runs along a link, lights the star it reaches, and often runs on to another.
      if (time >= nextPacketAt) {
        nextPacketAt = time + between(random, 0.12, 0.4)
        const from = Math.floor(random() * stars.length)
        const options = neighbors[from]
        if (options && options.length > 0 && packets.length < 18) {
          packets.push({
            from,
            to: options[Math.floor(random() * options.length)]!,
            start: time,
            duration: between(random, 0.55, 1.1),
            hops: 1 + Math.floor(random() * 4)
          })
        }
      }
      const arrived: Packet[] = []
      packets = packets.filter((packet) => {
        const progress = (time - packet.start) / packet.duration
        if (progress >= 1) {
          arrived.push(packet)
          return false
        }
        const from = stars[packet.from]!
        const to = stars[packet.to]!
        const eased = progress * progress * (3 - 2 * progress)
        const x = px(from) + (px(to) - px(from)) * eased
        const y = py(from) + (py(to) - py(from)) * eased
        const trail = Math.max(0, eased - 0.16)
        const tx = px(from) + (px(to) - px(from)) * trail
        const ty = py(from) + (py(to) - py(from)) * trail
        context.strokeStyle = rgba(lighten(tints[1]!, 0.35), 1)
        context.lineWidth = 1.6
        context.beginPath()
        context.moveTo(tx, ty)
        context.lineTo(x, y)
        context.stroke()
        return true
      })
      for (const packet of arrived) {
        const star = stars[packet.to]
        if (!star) continue
        star.pulse = 1
        const options = (neighbors[packet.to] ?? []).filter((candidate) => candidate !== packet.from)
        if (packet.hops > 1 && options.length > 0 && random() < 0.85) {
          packets.push({
            from: packet.to,
            to: options[Math.floor(random() * options.length)]!,
            start: time,
            duration: between(random, 0.5, 0.95),
            hops: packet.hops - 1
          })
        }
      }

      // The stars.
      for (const star of stars) {
        const twinkle = 0.62 + 0.38 * Math.sin(time * star.rate + star.phase)
        const lit = clamp(twinkle + star.pulse * 0.9, 0, 1.6)
        const glow = glows[star.tint]
        const x = px(star)
        const y = py(star)
        if (glow) {
          const size = star.radius * (6 + star.pulse * 9)
          context.globalAlpha = clamp(0.85 * lit, 0, 1)
          context.drawImage(glow, x - size, y - size, size * 2, size * 2)
        }
        context.globalAlpha = clamp(1.1 * lit, 0, 1)
        context.fillStyle = rgba(lighten(tints[star.tint]!, 0.55), 1)
        context.beginPath()
        context.arc(x, y, star.radius * (0.7 + star.pulse * 0.6), 0, Math.PI * 2)
        context.fill()
      }
      context.globalAlpha = 1

      // A shooting star now and then.
      if (time >= nextShooterAt) {
        nextShooterAt = time + between(random, 6, 12)
        shooters.push({
          x: random() * width * 0.7,
          y: random() * height * 0.35,
          angle: between(random, 0.35, 0.7),
          speed: between(random, 900, 1300),
          start: time,
          length: between(random, 140, 220)
        })
      }
      shooters = shooters.filter((shooter) => {
        const age = time - shooter.start
        const travelled = age * shooter.speed
        if (travelled > Math.hypot(width, height) + shooter.length) return false
        const hx = shooter.x + Math.cos(shooter.angle) * travelled
        const hy = shooter.y + Math.sin(shooter.angle) * travelled
        const tx = hx - Math.cos(shooter.angle) * shooter.length
        const ty = hy - Math.sin(shooter.angle) * shooter.length
        const gradient = context.createLinearGradient(tx, ty, hx, hy)
        const color = lighten(tints[1]!, 0.5)
        gradient.addColorStop(0, rgba(color, 0))
        gradient.addColorStop(1, rgba(color, 1))
        context.strokeStyle = gradient
        context.lineWidth = 1.6
        context.beginPath()
        context.moveTo(tx, ty)
        context.lineTo(hx, hy)
        context.stroke()
        return true
      })

      context.globalCompositeOperation = 'source-over'
    }
  }
}
