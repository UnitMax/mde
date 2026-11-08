import { lighten, mixRgb, rgba, type FancyPalette, type Rgb } from '@/fancy/color'
import { clamp, createNoise3, mulberry32 } from '@/fancy/random'
import { makeSprite, type BackgroundRenderer } from './types'

interface Curtain {
  /** Where the curtain's bright lower edge sits, as a fraction of the height. */
  base: number
  /** How tall it stands, as a fraction of the height. */
  height: number
  /** How many waves across the screen. */
  waves: number
  /** How fast the waves travel. */
  drift: number
  /** How bright it gets at most, from 0 to 1. */
  strength: number
  /** The bright lower part and the fading upper part. */
  low: Rgb
  high: Rgb
  profile: HTMLCanvasElement | null
}

const PROFILE_HEIGHT = 160
/** One vertical strip of a curtain is this many CSS pixels wide. */
const STRIP = 4
/** The canvas is this fraction of the window; the glow is soft, so enlarging it costs nothing the eye can see. */
const SCALE = 0.4

function smoothstep(low: number, high: number, value: number): number {
  const t = clamp((value - low) / (high - low), 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * Aurora: curtains of light that hang from a wavering lower edge and thin out upward, shot through with rays that
 * shimmer, over a field of faint stars and a soft haze of the same colors. Each curtain is a column of strips cut
 * from one pre-drawn gradient, so a frame is a few hundred stamps.
 */
export function createAurora(palette: FancyPalette): BackgroundRenderer {
  const dark = palette.mode === 'dark'
  const noise = createNoise3(0xa0409a)
  const random = mulberry32(7)
  const green = mixRgb(palette.ok, palette.cyan, 0.35)
  // On a light ground the same hues need depth, not lightness, to stand out.
  const tone = (color: Rgb): Rgb => (dark ? lighten(color, 0.1) : color)

  const curtains: Curtain[] = [
    { base: 0.7, height: 0.5, waves: 1.5, drift: 0.05, strength: 0.85, low: tone(green), high: tone(palette.cyan), profile: null },
    { base: 0.6, height: 0.54, waves: 2.2, drift: -0.07, strength: 0.75, low: tone(palette.cyan), high: tone(palette.accent), profile: null },
    { base: 0.5, height: 0.5, waves: 1.1, drift: 0.04, strength: 0.7, low: tone(mixRgb(palette.accent, palette.violet, 0.3)), high: tone(palette.violet), profile: null },
    { base: 0.4, height: 0.44, waves: 2.9, drift: -0.06, strength: 0.6, low: tone(palette.violet), high: tone(mixRgb(palette.violet, palette.accent, 0.55)), profile: null },
    { base: 0.78, height: 0.3, waves: 3.6, drift: 0.085, strength: 0.5, low: tone(mixRgb(green, palette.ok, 0.5)), high: tone(green), profile: null }
  ]

  // Each curtain's vertical profile: dim at the top, climbing to a bright lower edge that ends sharply.
  for (const curtain of curtains) {
    const sprite = makeSprite(1, PROFILE_HEIGHT)
    if (!sprite) continue
    const image = sprite.context.createImageData(1, PROFILE_HEIGHT)
    for (let y = 0; y < PROFILE_HEIGHT; y += 1) {
      const v = y / (PROFILE_HEIGHT - 1)
      const alpha = v ** 2.4 * (1 - smoothstep(0.95, 1, v) * 0.97)
      const color = mixRgb(curtain.high, curtain.low, smoothstep(0.05, 0.9, v))
      image.data.set([color[0], color[1], color[2], Math.round(alpha * 255)], y * 4)
    }
    sprite.context.putImageData(image, 0, 0)
    curtain.profile = sprite.canvas
  }

  const stars = Array.from({ length: 120 }, () => ({
    x: random(),
    y: random() ** 1.5 * 0.85,
    size: 0.6 + random() * 1.1,
    phase: random() * Math.PI * 2,
    rate: 0.4 + random() * 1.6
  }))

  let width = 0
  let height = 0

  return {
    scale: () => SCALE,
    resize: (cssWidth, cssHeight) => {
      width = cssWidth
      height = cssHeight
    },
    draw: (context, time) => {
      // The context is scaled to the canvas, so everything here is in CSS pixels.
      context.clearRect(0, 0, width, height)
      if (width === 0 || height === 0) return

      if (dark) {
        for (const star of stars) {
          const twinkle = 0.5 + 0.5 * Math.sin(time * star.rate + star.phase)
          context.fillStyle = rgba(lighten(palette.fg, 0.25), 0.35 + 0.65 * twinkle)
          context.fillRect(star.x * width, star.y * height, star.size * 2.4, star.size * 2.4)
        }
      }

      context.globalCompositeOperation = dark ? 'lighter' : 'source-over'

      // A haze under the curtains, in their colors, drifting slowly: it ties the ribbons into one glow.
      const hazes: Array<[Rgb, number, number, number]> = [
        [curtains[0]!.low, 0.28 + 0.12 * Math.sin(time * 0.07), 0.62, 0.55],
        [curtains[2]!.low, 0.72 + 0.14 * Math.sin(time * 0.05 + 2), 0.5, 0.45]
      ]
      for (const [color, centerX, centerY, reach] of hazes) {
        const x = centerX * width
        const y = centerY * height
        const radius = reach * Math.max(width, height) * 0.6
        const haze = context.createRadialGradient(x, y, 0, x, y, radius)
        haze.addColorStop(0, rgba(color, dark ? 0.34 : 0.22))
        haze.addColorStop(1, rgba(color, 0))
        context.fillStyle = haze
        context.fillRect(x - radius, y - radius, radius * 2, radius * 2)
      }

      curtains.forEach((curtain, index) => {
        if (!curtain.profile) return
        const seed = index * 11.3
        for (let x = -STRIP; x < width + STRIP; x += STRIP) {
          const along = x / width
          // The lower edge wavers, and each curtain's height breathes along its length.
          const edge = noise(along * curtain.waves + time * curtain.drift, seed, time * 0.06)
          const body = noise(along * curtain.waves * 1.7 - time * curtain.drift * 1.3, seed + 4.2, time * 0.08)
          const base = height * (curtain.base + 0.12 * edge)
          const tall = height * curtain.height * (0.72 + 0.4 * body)
          // Bright patches wander along the curtain; between them it all but disappears.
          const patch = clamp(0.62 + 1.5 * noise(along * 1.8 + time * 0.035, seed + 8.1, 9.7), 0, 1) ** 1.3
          // Rays: the narrow vertical streaks that make an aurora an aurora.
          const ray = dark
            ? clamp(0.62 + 0.95 * noise(along * 38 + seed, time * 0.7, seed), 0.3, 1)
            : clamp(0.86 + 0.5 * noise(along * 30 + seed, time * 0.7, seed), 0.62, 1)
          const alpha = curtain.strength * patch * ray
          if (alpha < 0.02) continue
          context.globalAlpha = alpha
          context.drawImage(curtain.profile, 0, 0, 1, PROFILE_HEIGHT, x, base - tall, STRIP + 0.6, tall)
        }
      })
      context.globalAlpha = 1
      context.globalCompositeOperation = 'source-over'
    }
  }
}
