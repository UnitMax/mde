import {
  getApplicationTheme,
  isApplicationThemeId,
  type ApplicationThemeId
} from '@/theme/themes'
import type { ThemeMode } from '@/theme/types'

export type Rgb = readonly [number, number, number]

/** A color written as `#rgb`, `#rrggbb`, `rgb(…)` or `rgba(…)`, or null for anything else. */
export function parseCssColor(value: string): Rgb | null {
  const text = value.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)
  if (hex) {
    const digits = hex[1]!
    const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
  }
  const functional = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(text)
  if (functional) {
    return [Number(functional[1]), Number(functional[2]), Number(functional[3])].map((channel) =>
      Math.min(255, Math.max(0, Math.round(channel)))
    ) as unknown as Rgb
  }
  return null
}

export function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  return [
    Math.round(from[0] + (to[0] - from[0]) * amount),
    Math.round(from[1] + (to[1] - from[1]) * amount),
    Math.round(from[2] + (to[2] - from[2]) * amount)
  ]
}

/** `rgba(…)` for a canvas style. */
export function rgba(color: Rgb, alpha = 1): string {
  return `rgba(${color[0]},${color[1]},${color[2]},${Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000})`
}

const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]

/** The color with its hue turned `degrees` round the wheel, keeping its lightness and saturation. */
export function rotateHue(color: Rgb, degrees: number): Rgb {
  const [r, g, b] = color.map((channel) => channel / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  const delta = max - min
  if (delta === 0) return color
  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  hue = (((hue * 60 + degrees) % 360) + 360) % 360
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = lightness - chroma / 2
  const [red, green, blue] =
    hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x]
      : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x]
  return [Math.round((red! + m) * 255), Math.round((green! + m) * 255), Math.round((blue! + m) * 255)]
}

export function lighten(color: Rgb, amount: number): Rgb {
  return mixRgb(color, WHITE, amount)
}

export function darken(color: Rgb, amount: number): Rgb {
  return mixRgb(color, BLACK, amount)
}

/** Relative luminance as WCAG defines it. */
export function luminance(color: Rgb): number {
  const [red, green, blue] = color.map((channel) => {
    const unit = channel / 255
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

export function contrastRatio(first: Rgb, second: Rgb): number {
  const a = luminance(first)
  const b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** The theme's colors that fancy mode paints with. */
export interface FancyPalette {
  mode: ThemeMode
  bg: Rgb
  panel: Rgb
  fg: Rgb
  fgMuted: Rgb
  accent: Rgb
  /** Green: working threads, and a ribbon of the aurora. */
  ok: Rgb
  /** The accent turned one way round the colour wheel (violet for a blue accent): the backgrounds' second hue. */
  violet: Rgb
  /** The accent turned the other way (teal for a blue accent): their third. */
  cyan: Rgb
}

/** The most opaque the background layer ever is, however dark the theme. */
export const BACKGROUND_OPACITY_LIMIT: Record<ThemeMode, number> = { dark: 0.6, light: 0.4 }

/** Body text must keep at least this contrast against the brightest part of a background (WCAG AA). */
export const BACKGROUND_TEXT_CONTRAST = 4.5

/**
 * How opaque the animated background layer is for this theme. Each background draws at full strength and the layer
 * as a whole is set to this opacity, so no pixel of it can lay more than this much of its color over the theme's
 * ground. It is the largest opacity (up to a limit) at which body text keeps a contrast of 4.5 against a bright pastel
 * peak of the theme's own colors, so a theme whose text is already dim against its ground, such as One Dark, gets a
 * fainter background than one with plenty of contrast to spare.
 */
export function backgroundOpacity(palette: FancyPalette): number {
  const peak = lighten(mixRgb(palette.accent, palette.ok, 0.5), 0.4)
  const reads = (opacity: number): boolean =>
    contrastRatio(palette.fg, mixRgb(palette.bg, peak, opacity)) >= BACKGROUND_TEXT_CONTRAST
  const limit = BACKGROUND_OPACITY_LIMIT[palette.mode]
  if (reads(limit)) return limit
  let low = 0
  let high = limit
  for (let step = 0; step < 14; step += 1) {
    const middle = (low + high) / 2
    if (reads(middle)) low = middle
    else high = middle
  }
  // Rounded down, so that rounding never lifts it past what was measured.
  return Math.floor(low * 1000) / 1000
}

export function fancyPaletteForTheme(themeId: ApplicationThemeId): FancyPalette {
  const theme = getApplicationTheme(themeId)
  const color = (value: string, fallback: Rgb): Rgb => parseCssColor(value) ?? fallback
  const accent = color(theme.application.accent, [91, 140, 255])
  return {
    mode: theme.mode,
    bg: color(theme.application.bg, BLACK),
    panel: color(theme.application.panel, BLACK),
    fg: color(theme.application.fg, WHITE),
    fgMuted: color(theme.application.fgMuted, WHITE),
    accent,
    ok: color(theme.application.ok, [63, 185, 80]),
    // Hues next to the accent's, so every theme gets colors that sit together whatever its accent is.
    violet: rotateHue(accent, 52),
    cyan: rotateHue(accent, -52)
  }
}

/** The theme on screen now, read from the page the way the rest of the interface learns it. */
export function currentThemeId(root: { dataset: DOMStringMap } = document.documentElement): ApplicationThemeId {
  const id = root.dataset.theme
  return isApplicationThemeId(id) ? id : 'slate'
}
