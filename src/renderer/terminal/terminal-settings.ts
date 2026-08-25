import { isApplicationThemeId, type ApplicationThemeId } from '@/theme/themes'

export interface TerminalSettings {
  family: string
  size: number
  /** xterm line-height multiplier relative to the selected font size. */
  lineHeight: number
  theme: ApplicationThemeId
  /** Whether individual non-OpenCode terminal panes appear in the sidebar. */
  showTerminalInstances: boolean
  /** Whether individual OpenCode instances appear in the sidebar. */
  showOpenCodeInstances: boolean
}

export interface TerminalFontOption {
  family: string
  label: string
}

export const TERMINAL_FONT_SIZES = [11, 12, 13, 14, 16, 18] as const
export const TERMINAL_LINE_HEIGHTS = [1, 1.1, 1.2, 1.3, 1.4, 1.5] as const
export const TERMINAL_SETTINGS_STORAGE_KEY = 'mde.terminal-settings'
export const LEGACY_TERMINAL_FONT_STORAGE_KEY = 'mde.terminal-font-settings'
export const TERMINAL_SETTINGS_CHANGE_EVENT = 'mde:terminal-settings-changed'

const CURATED_FONT_OPTIONS: readonly TerminalFontOption[] = [
  { family: 'Cascadia Mono', label: 'Cascadia Mono' },
  { family: 'JetBrains Mono', label: 'JetBrains Mono' },
  { family: 'Fira Code', label: 'Fira Code' },
  { family: 'DejaVu Sans Mono', label: 'DejaVu Sans Mono' },
  { family: 'Menlo', label: 'Menlo' },
  { family: 'Consolas', label: 'Consolas' },
  { family: 'monospace', label: 'System monospace' }
]

export function listTerminalFonts(
  isInstalled: (family: string) => boolean = isSystemFontInstalled
): TerminalFontOption[] {
  const installed = CURATED_FONT_OPTIONS.filter(
    (option) => option.family === 'monospace' || isInstalled(option.family)
  )
  return installed.length > 0 ? installed : [CURATED_FONT_OPTIONS[CURATED_FONT_OPTIONS.length - 1]!]
}

function isSystemFontInstalled(family: string): boolean {
  if (typeof document === 'undefined' || !document.fonts?.check) return false
  return document.fonts.check(`13px "${family}"`)
}

export function defaultTerminalSettings(
  availableFonts: readonly TerminalFontOption[]
): TerminalSettings {
  return {
    family: availableFonts[0]?.family ?? 'monospace',
    size: 13,
    lineHeight: 1,
    theme: 'slate',
    showTerminalInstances: false,
    showOpenCodeInstances: true
  }
}

function isTerminalFontSize(value: unknown): value is (typeof TERMINAL_FONT_SIZES)[number] {
  return typeof value === 'number' && TERMINAL_FONT_SIZES.includes(value as (typeof TERMINAL_FONT_SIZES)[number])
}

function isTerminalLineHeight(value: unknown): value is (typeof TERMINAL_LINE_HEIGHTS)[number] {
  return (
    typeof value === 'number' &&
    TERMINAL_LINE_HEIGHTS.includes(value as (typeof TERMINAL_LINE_HEIGHTS)[number])
  )
}

export function resolveTerminalSettings(
  value: unknown,
  availableFonts: readonly TerminalFontOption[]
): TerminalSettings {
  const fallback = defaultTerminalSettings(availableFonts)
  if (typeof value !== 'object' || value === null) return fallback

  const record = value as Record<string, unknown>
  const family = typeof record.family === 'string' ? record.family : fallback.family
  const size = isTerminalFontSize(record.size) ? record.size : fallback.size
  const lineHeight = isTerminalLineHeight(record.lineHeight) ? record.lineHeight : fallback.lineHeight
  const theme = isApplicationThemeId(record.theme) ? record.theme : fallback.theme
  return {
    family: availableFonts.some((option) => option.family === family) ? family : fallback.family,
    size,
    lineHeight,
    theme,
    showTerminalInstances:
      typeof record.showTerminalInstances === 'boolean'
        ? record.showTerminalInstances
        : fallback.showTerminalInstances,
    showOpenCodeInstances:
      typeof record.showOpenCodeInstances === 'boolean'
        ? record.showOpenCodeInstances
        : fallback.showOpenCodeInstances
  }
}

export function getTerminalSettings(): TerminalSettings {
  const availableFonts = listTerminalFonts()
  if (typeof localStorage === 'undefined') return defaultTerminalSettings(availableFonts)

  try {
    const stored =
      localStorage.getItem(TERMINAL_SETTINGS_STORAGE_KEY) ??
      localStorage.getItem(LEGACY_TERMINAL_FONT_STORAGE_KEY)
    return resolveTerminalSettings(stored ? JSON.parse(stored) : null, availableFonts)
  } catch {
    return defaultTerminalSettings(availableFonts)
  }
}

export function saveTerminalSettings(settings: TerminalSettings): void {
  try {
    localStorage.setItem(TERMINAL_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // A restricted storage environment should not prevent terminal use.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(TERMINAL_SETTINGS_CHANGE_EVENT))
}

export function subscribeTerminalSettings(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener(TERMINAL_SETTINGS_CHANGE_EVENT, listener)
  return () => window.removeEventListener(TERMINAL_SETTINGS_CHANGE_EVENT, listener)
}

export function xtermFontFamily(family: string): string {
  return family === 'monospace' ? family : `"${family}", monospace`
}
