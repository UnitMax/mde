import type { ITheme } from '@xterm/xterm'
import type { TerminalPalette } from '@shared/ipc'

export type ApplicationThemeId = 'slate' | 'ember' | 'frost' | 'high-contrast'

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
}

type TerminalTheme = ITheme & TerminalPalette

export interface ApplicationThemeOption {
  id: ApplicationThemeId
  label: string
  application: ApplicationPalette
  terminal: TerminalTheme
}

const SLATE: ApplicationThemeOption = {
  id: 'slate',
  label: 'Slate',
  application: {
    bg: '#0b0e13',
    panel: '#10141b',
    elevated: '#171d27',
    hover: '#1a212c',
    active: '#232c3b',
    line: '#222a36',
    lineStrong: '#2e3846',
    fg: '#d8dee9',
    fgMuted: '#7b8698',
    fgSubtle: '#58616f',
    accent: '#5b8cff',
    accentHover: '#6f9bff',
    accentFg: '#06090f',
    ok: '#3fb950',
    warn: '#d8a325',
    danger: '#f0574f',
    scrollbarHover: '#3b4757'
  },
  terminal: {
    background: '#0b0e13',
    foreground: '#d8dee9',
    cursor: '#5b8cff',
    cursorAccent: '#0b0e13',
    selectionBackground: '#2c3a52',
    black: '#2e3436',
    red: '#cc0000',
    green: '#4e9a06',
    yellow: '#c4a000',
    blue: '#3465a4',
    magenta: '#75507b',
    cyan: '#06989a',
    white: '#d3d7cf',
    brightBlack: '#555753',
    brightRed: '#ef2929',
    brightGreen: '#8ae234',
    brightYellow: '#fce94f',
    brightBlue: '#729fcf',
    brightMagenta: '#ad7fa8',
    brightCyan: '#34e2e2',
    brightWhite: '#eeeeec'
  }
}

const EMBER: ApplicationThemeOption = {
  id: 'ember',
  label: 'Ember',
  application: {
    bg: '#1a1110',
    panel: '#211614',
    elevated: '#2b1b18',
    hover: '#35221e',
    active: '#4a2c25',
    line: '#3d2925',
    lineStrong: '#60433b',
    fg: '#f5e6d3',
    fgMuted: '#bca58f',
    fgSubtle: '#806a5d',
    accent: '#ff9f43',
    accentHover: '#ffb466',
    accentFg: '#1a1110',
    ok: '#98c379',
    warn: '#e5c07b',
    danger: '#e06c75',
    scrollbarHover: '#76534a'
  },
  terminal: {
    background: '#1a1110',
    foreground: '#f5e6d3',
    cursor: '#ff9f43',
    cursorAccent: '#1a1110',
    selectionBackground: '#5a3024',
    black: '#2b1b18',
    red: '#e06c75',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#f5e6d3',
    brightBlack: '#6b4f48',
    brightRed: '#ff7b86',
    brightGreen: '#b5e890',
    brightYellow: '#ffd98a',
    brightBlue: '#8ac7ff',
    brightMagenta: '#e29bf2',
    brightCyan: '#83e1eb',
    brightWhite: '#fff5e9'
  }
}

const FROST: ApplicationThemeOption = {
  id: 'frost',
  label: 'Frost',
  application: {
    bg: '#101923',
    panel: '#131f2b',
    elevated: '#172b3b',
    hover: '#1c3041',
    active: '#25445c',
    line: '#26394a',
    lineStrong: '#3b5368',
    fg: '#dce7f3',
    fgMuted: '#93a8bc',
    fgSubtle: '#667b8f',
    accent: '#67d5ff',
    accentHover: '#8ee1ff',
    accentFg: '#07131b',
    ok: '#8bd49c',
    warn: '#f0ca7a',
    danger: '#ff6b7a',
    scrollbarHover: '#4b667d'
  },
  terminal: {
    background: '#101923',
    foreground: '#dce7f3',
    cursor: '#67d5ff',
    cursorAccent: '#101923',
    selectionBackground: '#25445c',
    black: '#17232f',
    red: '#ff6b7a',
    green: '#8bd49c',
    yellow: '#f0ca7a',
    blue: '#72a7ff',
    magenta: '#c49cff',
    cyan: '#67d5ff',
    white: '#dce7f3',
    brightBlack: '#5e7488',
    brightRed: '#ff9aa5',
    brightGreen: '#b1edbd',
    brightYellow: '#ffe39d',
    brightBlue: '#a5c5ff',
    brightMagenta: '#dfc8ff',
    brightCyan: '#a0ecff',
    brightWhite: '#f5faff'
  }
}

const HIGH_CONTRAST: ApplicationThemeOption = {
  id: 'high-contrast',
  label: 'High contrast',
  application: {
    bg: '#000000',
    panel: '#080808',
    elevated: '#121212',
    hover: '#1c1c1c',
    active: '#292929',
    line: '#666666',
    lineStrong: '#a0a0a0',
    fg: '#ffffff',
    fgMuted: '#dedede',
    fgSubtle: '#bdbdbd',
    accent: '#80aaff',
    accentHover: '#a8c5ff',
    accentFg: '#000000',
    ok: '#80ff80',
    warn: '#ffff80',
    danger: '#ff8080',
    scrollbarHover: '#c0c0c0'
  },
  terminal: {
    background: '#000000',
    foreground: '#ffffff',
    cursor: '#ffffff',
    cursorAccent: '#000000',
    selectionBackground: '#3f5f9f',
    black: '#000000',
    red: '#ff5f56',
    green: '#5fff5f',
    yellow: '#ffff5f',
    blue: '#5f87ff',
    magenta: '#ff5fff',
    cyan: '#5fffff',
    white: '#ffffff',
    brightBlack: '#808080',
    brightRed: '#ff8080',
    brightGreen: '#80ff80',
    brightYellow: '#ffff80',
    brightBlue: '#80aaff',
    brightMagenta: '#ff80ff',
    brightCyan: '#80ffff',
    brightWhite: '#ffffff'
  }
}

export const APPLICATION_THEMES: readonly ApplicationThemeOption[] = [
  SLATE,
  EMBER,
  FROST,
  HIGH_CONTRAST
]

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
  scrollbarHover: '--color-scrollbar-hover'
}

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

export function getTerminalTheme(themeId: ApplicationThemeId): TerminalTheme {
  return getApplicationTheme(themeId).terminal
}

export function getTerminalPalette(themeId: ApplicationThemeId): TerminalPalette {
  const { foreground, background } = getTerminalTheme(themeId)
  return { foreground, background }
}

export function applyApplicationTheme(
  themeId: ApplicationThemeId,
  root: ThemeRoot = document.documentElement
): void {
  const theme = getApplicationTheme(themeId)
  root.dataset.theme = theme.id
  for (const [key, variable] of Object.entries(APPLICATION_PALETTE_VARIABLES)) {
    root.style.setProperty(variable, theme.application[key as keyof ApplicationPalette])
  }
}
