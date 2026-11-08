import { describe, expect, it } from 'vitest'
import { isDarkColor } from '../src/main/window-chrome'
import {
  APPLICATION_THEMES,
  DARK_THEMES,
  LIGHT_THEMES,
  applyApplicationTheme,
  getApplicationTheme,
  getSyntaxPalette,
  getTerminalMinimumContrastRatio,
  getTerminalPalette,
  getThemeMode,
  isApplicationThemeId,
  type ApplicationPalette,
  type ApplicationThemeOption
} from '../src/renderer/theme/themes'

const HEX = /^#[0-9a-f]{6}$/

function channel(value: number): number {
  const scaled = value / 255
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => channel(parseInt(hex.slice(index, index + 2), 16)))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** WCAG contrast ratio of two #rrggbb colors. */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light! + 0.05) / (dark! + 0.05)
}

/** The first three themes were made before the contrast floors below and keep their colors. */
const LEGACY = new Set(['slate', 'ember', 'frost'])
const CURRENT = APPLICATION_THEMES.filter((theme) => !LEGACY.has(theme.id))

const SURFACES = ['bg', 'panel', 'elevated'] as const
const PAIRS = ['hover', 'active'] as const
const CHROMATIC = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'] as const

function ansi(theme: ApplicationThemeOption, key: string): string {
  return (theme.terminal as unknown as Record<string, string>)[key]!
}

function worst(color: string, grounds: readonly string[]): number {
  return Math.min(...grounds.map((ground) => contrast(color, ground)))
}

describe('theme registry', () => {
  it('lists every theme once, dark ones and light ones apart', () => {
    const ids = APPLICATION_THEMES.map((theme) => theme.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(15)
    expect(DARK_THEMES.every((theme) => theme.mode === 'dark')).toBe(true)
    expect(LIGHT_THEMES.every((theme) => theme.mode === 'light')).toBe(true)
    expect(DARK_THEMES.length + LIGHT_THEMES.length).toBe(APPLICATION_THEMES.length)
    expect(LIGHT_THEMES.map((theme) => theme.id)).toEqual([
      'github-light',
      'solarized-light',
      'catppuccin-latte',
      'gruvbox-light',
      'high-contrast-light'
    ])
  })

  it('knows its ids and falls back to Slate for anything else', () => {
    for (const theme of APPLICATION_THEMES) expect(isApplicationThemeId(theme.id)).toBe(true)
    expect(isApplicationThemeId('solarized')).toBe(false)
    expect(isApplicationThemeId(undefined)).toBe(false)
    expect(getApplicationTheme('nope' as never).id).toBe('slate')
  })

  it('names the project every adapted palette comes from', () => {
    const adapted = Object.fromEntries(APPLICATION_THEMES.map((theme) => [theme.id, theme.source ?? null]))
    expect(adapted).toMatchObject({
      slate: null,
      'high-contrast': null,
      'high-contrast-light': null,
      'catppuccin-mocha': 'catppuccin',
      'catppuccin-latte': 'catppuccin',
      'tokyo-night': 'tokyo-night',
      dracula: 'dracula',
      nord: 'nord',
      'one-dark': 'one-dark',
      'gruvbox-dark': 'gruvbox',
      'gruvbox-light': 'gruvbox',
      'github-light': 'github',
      'solarized-light': 'solarized'
    })
  })
})

describe.each(APPLICATION_THEMES.map((theme) => [theme.id, theme] as const))('%s', (_id, theme) => {
  it('is made of #rrggbb colors', () => {
    const colors = [
      ...Object.values(theme.application),
      ...Object.values(theme.terminal).filter((value): value is string => typeof value === 'string'),
      ...Object.values(getSyntaxPalette(theme))
    ]
    expect(colors.length).toBeGreaterThan(40)
    for (const color of colors) expect(color).toMatch(HEX)
  })

  it('has all sixteen terminal colors', () => {
    for (const name of ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']) {
      expect(ansi(theme, name)).toMatch(HEX)
      expect(ansi(theme, `bright${name[0]!.toUpperCase()}${name.slice(1)}`)).toMatch(HEX)
    }
  })

  it('declares the mode its ground has, and its terminal sits on the same ground', () => {
    expect(isDarkColor(theme.application.bg)).toBe(theme.mode === 'dark')
    expect(isDarkColor(theme.application.fg)).toBe(theme.mode === 'light')
    expect(theme.terminal.background).toBe(theme.application.bg)
    expect(getThemeMode(theme.id)).toBe(theme.mode)
    expect(getTerminalPalette(theme.id)).toEqual({ foreground: theme.terminal.foreground, background: theme.terminal.background })
  })

  it('stacks its surfaces from the brightest raised one to the darker wells and chrome on a light theme', () => {
    const { bg, panel, elevated, hover, active } = theme.application
    const [l_bg, l_panel, l_elevated, l_hover, l_active] = [bg, panel, elevated, hover, active].map(luminance)
    if (theme.mode === 'light') {
      expect(l_elevated!).toBeGreaterThanOrEqual(l_bg!)
      expect(l_bg!).toBeGreaterThan(l_panel!)
      expect(l_panel!).toBeGreaterThan(l_hover!)
      expect(l_hover!).toBeGreaterThan(l_active!)
    } else {
      expect(l_elevated!).toBeGreaterThan(l_panel!)
      expect(l_hover!).toBeGreaterThan(l_elevated!)
      expect(l_active!).toBeGreaterThan(l_hover!)
    }
  })

  it('applies itself to the page, with its mode and color scheme', () => {
    const properties = new Map<string, string>()
    const root = { dataset: {} as DOMStringMap, style: { setProperty: (name: string, value: string) => void properties.set(name, value) } }
    applyApplicationTheme(theme.id, root)
    expect(root.dataset.theme).toBe(theme.id)
    expect(root.dataset.mode).toBe(theme.mode)
    expect(properties.get('color-scheme')).toBe(theme.mode)
    expect(properties.get('--color-bg')).toBe(theme.application.bg)
    expect(properties.get('--color-shade')).toBe(theme.application.shade)
    expect(properties.get('--color-syntax-keyword')).toBe(getSyntaxPalette(theme).keyword)
    expect(properties.get('--color-syntax-property')).toBe(getSyntaxPalette(theme).property)
  })
})

describe('legibility', () => {
  describe.each(CURRENT.map((theme) => [theme.id, theme] as const))('%s', (_id, theme) => {
    const palette: ApplicationPalette = theme.application
    const surfaces = SURFACES.map((key) => palette[key])
    const highContrast = theme.id.startsWith('high-contrast')

    it('reads its text on every surface', () => {
      expect(worst(palette.fg, surfaces)).toBeGreaterThanOrEqual(highContrast ? 12 : 6.5)
      expect(worst(palette.fg, [palette.hover, palette.active])).toBeGreaterThanOrEqual(highContrast ? 7 : 4.5)
      expect(worst(palette.fgMuted, surfaces)).toBeGreaterThanOrEqual(highContrast ? 7 : 4.5)
      expect(worst(palette.fgSubtle, surfaces)).toBeGreaterThanOrEqual(highContrast ? 4.5 : 3)
    })

    it('reads its muted text on a hovered row', () => {
      for (const key of PAIRS) expect(contrast(palette.fgMuted, palette[key])).toBeGreaterThanOrEqual(highContrast ? 4.5 : 3.2)
    })

    it('reads its accent on every surface, and the text on the accent', () => {
      expect(worst(palette.accent, surfaces)).toBeGreaterThanOrEqual(highContrast ? 7 : 3)
      expect(contrast(palette.accentFg, palette.accent)).toBeGreaterThanOrEqual(highContrast ? 7 : 4.5)
      expect(contrast(palette.accentFg, palette.accentHover)).toBeGreaterThanOrEqual(highContrast ? 7 : 4.5)
    })

    it('reads its status colors', () => {
      for (const key of ['ok', 'warn', 'danger'] as const) {
        expect(worst(palette[key], surfaces), key).toBeGreaterThanOrEqual(highContrast ? 7 : 3)
      }
    })

    it('draws a visible border', () => {
      expect(contrast(palette.lineStrong, palette.elevated)).toBeGreaterThan(1.3)
      expect(contrast(palette.line, palette.bg)).toBeGreaterThan(1.1)
      expect(contrast(palette.lineStrong, palette.line) + contrast(palette.lineStrong, palette.bg)).toBeGreaterThan(2.3)
    })

    it('reads the code in the viewer', () => {
      const ground = [palette.bg, palette.elevated]
      for (const [name, color] of Object.entries(getSyntaxPalette(theme))) {
        expect(worst(color, ground), name).toBeGreaterThanOrEqual(highContrast ? 7 : 4)
      }
    })

    it('reads the terminal colors', () => {
      const ground = [theme.terminal.background as string]
      expect(contrast(theme.terminal.foreground as string, ground[0]!)).toBeGreaterThanOrEqual(6.5)
      const floor = highContrast ? 6 : theme.mode === 'light' ? 4.2 : 2.5
      for (const name of CHROMATIC) {
        const bright = `bright${name[0]!.toUpperCase()}${name.slice(1)}`
        expect(worst(ansi(theme, name), ground), name).toBeGreaterThanOrEqual(floor)
        expect(worst(ansi(theme, bright), ground), bright).toBeGreaterThanOrEqual(floor)
      }
      // On a light ground the black is the ink, so it has to read.
      if (theme.mode === 'light') expect(contrast(ansi(theme, 'black'), ground[0]!)).toBeGreaterThanOrEqual(5.5)
      // The dim gray programs use for secondary output.
      expect(contrast(ansi(theme, 'brightBlack'), ground[0]!)).toBeGreaterThanOrEqual(highContrast ? 4.5 : theme.mode === 'light' ? 4.5 : 2.4)
    })

    it('has a shade that darkens what is behind it', () => {
      expect(isDarkColor(palette.shade)).toBe(true)
    })
  })
})

describe('light themes in the terminal', () => {
  it('lift faint text, and dark themes draw colors as asked', () => {
    for (const theme of LIGHT_THEMES) expect(getTerminalMinimumContrastRatio(theme.id)).toBeGreaterThanOrEqual(4.5)
    expect(getTerminalMinimumContrastRatio('high-contrast-light')).toBe(7)
    for (const theme of DARK_THEMES) expect(getTerminalMinimumContrastRatio(theme.id)).toBe(1)
  })

  it('takes syntax colors from the normal ANSI colors on a light ground, the bright ones on a dark ground', () => {
    const dark = { ...getApplicationTheme('slate') }
    const light = { ...getApplicationTheme('slate'), mode: 'light' as const }
    expect(getSyntaxPalette(dark).keyword).toBe(dark.terminal.brightMagenta)
    expect(getSyntaxPalette(light).keyword).toBe(light.terminal.magenta)
    expect(getSyntaxPalette(light).function).toBe(light.terminal.blue)
  })
})
