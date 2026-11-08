import { describe, expect, it } from 'vitest'
import {
  BACKGROUND_OPACITY_LIMIT,
  BACKGROUND_TEXT_CONTRAST,
  backgroundOpacity,
  contrastRatio,
  currentThemeId,
  darken,
  fancyPaletteForTheme,
  lighten,
  luminance,
  mixRgb,
  parseCssColor,
  rgba,
  rotateHue
} from '../src/renderer/fancy/color'
import { APPLICATION_THEMES } from '../src/renderer/theme/themes'

describe('fancy colors', () => {
  it('reads hex and functional colors, and nothing else', () => {
    expect(parseCssColor('#5b8cff')).toEqual([91, 140, 255])
    expect(parseCssColor('#FFF')).toEqual([255, 255, 255])
    expect(parseCssColor(' #0b0e13ff ')).toEqual([11, 14, 19])
    expect(parseCssColor('rgb(1, 2, 3)')).toEqual([1, 2, 3])
    expect(parseCssColor('rgba(300 0 12 / 0.5)')).toEqual([255, 0, 12])
    expect(parseCssColor('rebeccapurple')).toBeNull()
    expect(parseCssColor('#12')).toBeNull()
  })

  it('mixes, lightens, darkens and writes colors for a canvas', () => {
    expect(mixRgb([0, 0, 0], [100, 200, 50], 0.5)).toEqual([50, 100, 25])
    expect(lighten([0, 0, 0], 1)).toEqual([255, 255, 255])
    expect(darken([200, 100, 50], 1)).toEqual([0, 0, 0])
    expect(rgba([1, 2, 3], 0.5)).toBe('rgba(1,2,3,0.5)')
    expect(rgba([1, 2, 3], 7)).toBe('rgba(1,2,3,1)')
    expect(rgba([1, 2, 3], -1)).toBe('rgba(1,2,3,0)')
  })

  it('turns a hue round the wheel and keeps what has no hue', () => {
    expect(rotateHue([255, 0, 0], 120)).toEqual([0, 255, 0])
    expect(rotateHue([255, 0, 0], -120)).toEqual([0, 0, 255])
    expect(rotateHue([255, 0, 0], 360)).toEqual([255, 0, 0])
    expect(rotateHue([128, 128, 128], 90)).toEqual([128, 128, 128])
    // Lightness stays: a blue accent turned toward violet is still as light as it was.
    const accent: [number, number, number] = [91, 140, 255]
    expect(Math.abs(luminance(rotateHue(accent, 52)) - luminance(accent))).toBeLessThan(0.15)
  })

  it('measures contrast as WCAG does', () => {
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5)
    expect(contrastRatio([10, 20, 30], [10, 20, 30])).toBeCloseTo(1, 5)
  })

  it('reads the theme from the page, with Slate when it is missing or unknown', () => {
    expect(currentThemeId({ dataset: { theme: 'nord' } })).toBe('nord')
    expect(currentThemeId({ dataset: { theme: 'neon' } })).toBe('slate')
    expect(currentThemeId({ dataset: {} })).toBe('slate')
  })
})

describe.each(APPLICATION_THEMES.map((theme) => [theme.id, theme] as const))('%s', (id, theme) => {
  const palette = fancyPaletteForTheme(id)

  it('gives the backgrounds colors that sit next to its accent', () => {
    expect(palette.mode).toBe(theme.mode)
    for (const color of [palette.bg, palette.panel, palette.fg, palette.fgMuted, palette.accent, palette.ok, palette.violet, palette.cyan]) {
      expect(color).toHaveLength(3)
      for (const channel of color) expect(channel).toBeGreaterThanOrEqual(0)
    }
    expect(palette.violet).not.toEqual(palette.cyan)
  })

  it('draws a background faint enough that body text still reads over its brightest part', () => {
    const opacity = backgroundOpacity(palette)
    expect(opacity).toBeGreaterThan(0.1)
    expect(opacity).toBeLessThanOrEqual(BACKGROUND_OPACITY_LIMIT[palette.mode])
    const peak = lighten(mixRgb(palette.accent, palette.ok, 0.5), 0.4)
    // The brightest part the layer can lay over the ground at this opacity.
    const worst = mixRgb(palette.bg, peak, opacity)
    const floor = Math.min(BACKGROUND_TEXT_CONTRAST, contrastRatio(palette.fg, palette.bg))
    expect(contrastRatio(palette.fg, worst)).toBeGreaterThanOrEqual(floor - 0.02)
  })
})

describe('background opacity', () => {
  it('is fainter for a theme whose text has less contrast to spare', () => {
    const slate = backgroundOpacity(fancyPaletteForTheme('slate'))
    const oneDark = backgroundOpacity(fancyPaletteForTheme('one-dark'))
    expect(oneDark).toBeLessThan(slate)
  })
})
