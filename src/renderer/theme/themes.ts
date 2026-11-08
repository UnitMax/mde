import type { ITheme } from '@xterm/xterm'
import type { TerminalPalette } from '@shared/ipc'
import {
  CATPPUCCIN_MOCHA,
  DRACULA,
  EMBER,
  FROST,
  GRUVBOX_DARK,
  HIGH_CONTRAST,
  NORD,
  ONE_DARK,
  SLATE,
  TOKYO_NIGHT
} from './palettes-dark'
import {
  CATPPUCCIN_LATTE,
  GITHUB_LIGHT,
  GRUVBOX_LIGHT,
  HIGH_CONTRAST_LIGHT,
  SOLARIZED_LIGHT
} from './palettes-light'
import type {
  ApplicationPalette,
  ApplicationThemeId,
  ApplicationThemeOption,
  SyntaxPalette,
  TerminalTheme,
  ThemeMode
} from './types'

export type {
  ApplicationPalette,
  ApplicationThemeId,
  ApplicationThemeOption,
  SyntaxPalette,
  ThemeMode,
  ThemeSourceKey
} from './types'

/** The dark themes in the order the settings list them. */
export const DARK_THEMES: readonly ApplicationThemeOption[] = [
  SLATE,
  EMBER,
  FROST,
  HIGH_CONTRAST,
  CATPPUCCIN_MOCHA,
  TOKYO_NIGHT,
  DRACULA,
  NORD,
  ONE_DARK,
  GRUVBOX_DARK
]

/** The light themes in the order the settings list them. */
export const LIGHT_THEMES: readonly ApplicationThemeOption[] = [
  GITHUB_LIGHT,
  SOLARIZED_LIGHT,
  CATPPUCCIN_LATTE,
  GRUVBOX_LIGHT,
  HIGH_CONTRAST_LIGHT
]

export const APPLICATION_THEMES: readonly ApplicationThemeOption[] = [...DARK_THEMES, ...LIGHT_THEMES]

const APPLICATION_PALETTE_VARIABLES: Record<keyof ApplicationPalette, `--color-${string}`> = {
  bg: '--color-bg',
  panel: '--color-panel',
  elevated: '--color-elevated',
  hover: '--color-hover',
  active: '--color-active',
  line: '--color-line',
  lineStrong: '--color-line-strong',
  fg: '--color-fg',
  fgMuted: '--color-fg-muted',
  fgSubtle: '--color-fg-subtle',
  accent: '--color-accent',
  accentHover: '--color-accent-hover',
  accentFg: '--color-accent-fg',
  ok: '--color-ok',
  warn: '--color-warn',
  danger: '--color-danger',
  scrollbarHover: '--color-scrollbar-hover',
  shade: '--color-shade'
}

const SYNTAX_COLOR_VARIABLES: Record<keyof SyntaxPalette, `--color-syntax-${string}`> = {
  keyword: '--color-syntax-keyword',
  string: '--color-syntax-string',
  number: '--color-syntax-number',
  function: '--color-syntax-function',
  type: '--color-syntax-type',
  property: '--color-syntax-property'
}

type AnsiColor = Extract<keyof ITheme, 'magenta' | 'green' | 'yellow' | 'blue' | 'cyan' | `bright${string}`>

interface ThemeRoot {
  dataset: DOMStringMap
  style: Pick<CSSStyleDeclaration, 'setProperty'>
}

export function isApplicationThemeId(value: unknown): value is ApplicationThemeId {
  return APPLICATION_THEMES.some((option) => option.id === value)
}

export function getApplicationTheme(themeId: ApplicationThemeId): ApplicationThemeOption {
  return APPLICATION_THEMES.find((option) => option.id === themeId) ?? SLATE
}

export function getThemeMode(themeId: ApplicationThemeId): ThemeMode {
  return getApplicationTheme(themeId).mode
}

export function getTerminalTheme(themeId: ApplicationThemeId): TerminalTheme {
  return getApplicationTheme(themeId).terminal
}

export function getTerminalPalette(themeId: ApplicationThemeId): TerminalPalette {
  const { foreground, background } = getTerminalTheme(themeId)
  return { foreground, background }
}

/** The ratio xterm keeps between text and background for this theme; 1 draws colors as the program asked. */
export function getTerminalMinimumContrastRatio(themeId: ApplicationThemeId): number {
  return getApplicationTheme(themeId).minimumContrastRatio ?? 1
}

/**
 * Code viewer syntax colors. A theme without its own come from its ANSI colors, so the viewer matches the
 * terminals without a second palette: the bright ones on a dark ground, where they stand out, and the normal ones
 * on a light ground, where the bright ones fade.
 */
export function getSyntaxPalette(theme: ApplicationThemeOption): SyntaxPalette {
  if (theme.syntax) return theme.syntax
  const ansi = theme.terminal
  const dark = theme.mode === 'dark'
  const pick = (bright: AnsiColor, normal: AnsiColor): string => ansi[dark ? bright : normal] ?? theme.application.fg
  return {
    keyword: pick('brightMagenta', 'magenta'),
    string: pick('brightGreen', 'green'),
    number: pick('brightYellow', 'yellow'),
    function: pick('brightBlue', 'blue'),
    type: pick('brightCyan', 'cyan'),
    property: ansi.cyan ?? theme.application.fg
  }
}

export function applyApplicationTheme(
  themeId: ApplicationThemeId,
  root: ThemeRoot = document.documentElement
): void {
  const theme = getApplicationTheme(themeId)
  root.dataset.theme = theme.id
  root.dataset.mode = theme.mode
  // Tells the browser which native parts (form controls, the default canvas) to draw light or dark.
  root.style.setProperty('color-scheme', theme.mode)
  for (const [key, variable] of Object.entries(APPLICATION_PALETTE_VARIABLES)) {
    root.style.setProperty(variable, theme.application[key as keyof ApplicationPalette])
  }
  const syntax = getSyntaxPalette(theme)
  for (const [key, variable] of Object.entries(SYNTAX_COLOR_VARIABLES)) {
    root.style.setProperty(variable, syntax[key as keyof SyntaxPalette])
  }
}
