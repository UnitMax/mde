import type { ITheme } from '@xterm/xterm'
import type { TerminalPalette } from '@shared/ipc'

export type TerminalThemeId = 'slate' | 'ember' | 'frost' | 'high-contrast'

export interface TerminalThemeOption {
  id: TerminalThemeId
  label: string
  theme: TerminalTheme
}

type TerminalTheme = ITheme & TerminalPalette

const SLATE: TerminalTheme = {
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

const EMBER: TerminalTheme = {
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

const FROST: TerminalTheme = {
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

const HIGH_CONTRAST: TerminalTheme = {
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

export const TERMINAL_THEMES: readonly TerminalThemeOption[] = [
  { id: 'slate', label: 'Slate (current)', theme: SLATE },
  { id: 'ember', label: 'Ember', theme: EMBER },
  { id: 'frost', label: 'Frost', theme: FROST },
  { id: 'high-contrast', label: 'High contrast', theme: HIGH_CONTRAST }
]

export function isTerminalThemeId(value: unknown): value is TerminalThemeId {
  return TERMINAL_THEMES.some((option) => option.id === value)
}

export function getTerminalTheme(themeId: TerminalThemeId): TerminalTheme {
  return TERMINAL_THEMES.find((option) => option.id === themeId)?.theme ?? SLATE
}

export function getTerminalPalette(themeId: TerminalThemeId): TerminalPalette {
  const { foreground, background } = getTerminalTheme(themeId)
  return { foreground, background }
}
