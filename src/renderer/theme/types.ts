import type { ITheme } from '@xterm/xterm'
import type { TerminalPalette } from '@shared/ipc'

export type ApplicationThemeId =
  | 'slate'
  | 'ember'
  | 'frost'
  | 'high-contrast'
  | 'high-contrast-light'
  | 'catppuccin-mocha'
  | 'catppuccin-latte'
  | 'tokyo-night'
  | 'dracula'
  | 'nord'
  | 'one-dark'
  | 'gruvbox-dark'
  | 'gruvbox-light'
  | 'github-light'
  | 'solarized-light'

/** Whether a theme draws light text on a dark ground or dark text on a light one. */
export type ThemeMode = 'dark' | 'light'

/**
 * The palettes MDE adapted from other projects. Each key names an entry of `scripts/theme-credits.json`, whose
 * copyright line and license text `npm run licenses` writes into `THIRD_PARTY_NOTICES.md`.
 */
export type ThemeSourceKey =
  | 'catppuccin'
  | 'github'
  | 'solarized'
  | 'gruvbox'
  | 'tokyo-night'
  | 'dracula'
  | 'nord'
  | 'one-dark'

export interface ApplicationPalette {
  bg: string
  panel: string
  elevated: string
  hover: string
  active: string
  line: string
  lineStrong: string
  fg: string
  fgMuted: string
  fgSubtle: string
  accent: string
  accentHover: string
  accentFg: string
  ok: string
  warn: string
  danger: string
  scrollbarHover: string
  /** The color of shadows and of the veil behind a dialog: black on a dark theme, a deep slate on a light one. */
  shade: string
}

/** The colors of the code viewer's syntax highlighting. */
export interface SyntaxPalette {
  keyword: string
  string: string
  number: string
  function: string
  type: string
  property: string
}

export type TerminalTheme = ITheme & TerminalPalette

export interface ApplicationThemeOption {
  id: ApplicationThemeId
  label: string
  mode: ThemeMode
  application: ApplicationPalette
  terminal: TerminalTheme
  /**
   * Syntax colors. Left out, they come from the terminal's ANSI colors (the bright ones on a dark theme, the
   * normal ones on a light theme), so the viewer matches the terminals without a second palette.
   */
  syntax?: SyntaxPalette
  /** The project this palette was adapted from. Themes MDE designed itself have none. */
  source?: ThemeSourceKey
  /**
   * The lowest contrast ratio xterm keeps between text and its background. It lifts the faint grays a program
   * picks for a dark ground when the ground is light. Left out, colors are drawn as the program asked.
   */
  minimumContrastRatio?: number
}
