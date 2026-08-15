export interface TerminalFontSettings {
  family: string
  size: number
}

export interface TerminalFontOption {
  family: string
  label: string
}

export const TERMINAL_FONT_SIZES = [11, 12, 13, 14, 16, 18] as const
export const TERMINAL_FONT_STORAGE_KEY = 'mde.terminal-font-settings'

const CURATED_FONT_OPTIONS: readonly TerminalFontOption[] = [
  { family: 'Cascadia Mono', label: 'Cascadia Mono' },
  { family: 'JetBrains Mono', label: 'JetBrains Mono' },
  { family: 'Fira Code', label: 'Fira Code' },
  { family: 'DejaVu Sans Mono', label: 'DejaVu Sans Mono' },
  { family: 'Menlo', label: 'Menlo' },
  { family: 'Consolas', label: 'Consolas' },
  { family: 'monospace', label: 'System monospace' }
]

export function listTerminalFonts(isInstalled: (family: string) => boolean = isSystemFontInstalled): TerminalFontOption[] {
  const installed = CURATED_FONT_OPTIONS.filter(
    (option) => option.family === 'monospace' || isInstalled(option.family)
  )
  return installed.length > 0 ? installed : [CURATED_FONT_OPTIONS[CURATED_FONT_OPTIONS.length - 1]!]
}

function isSystemFontInstalled(family: string): boolean {
  if (typeof document === 'undefined' || !document.fonts?.check) return false
  return document.fonts.check(`13px "${family}"`)
}

export function defaultTerminalFontSettings(availableFonts: readonly TerminalFontOption[]): TerminalFontSettings {
  return {
    family: availableFonts[0]?.family ?? 'monospace',
    size: 13
  }
}

function isTerminalFontSize(value: unknown): value is (typeof TERMINAL_FONT_SIZES)[number] {
  return typeof value === 'number' && TERMINAL_FONT_SIZES.includes(value as (typeof TERMINAL_FONT_SIZES)[number])
}

export function resolveTerminalFontSettings(
  value: unknown,
  availableFonts: readonly TerminalFontOption[]
): TerminalFontSettings {
  const fallback = defaultTerminalFontSettings(availableFonts)
  if (typeof value !== 'object' || value === null) return fallback

  const record = value as Record<string, unknown>
  const family = typeof record.family === 'string' ? record.family : fallback.family
  const size = isTerminalFontSize(record.size) ? record.size : fallback.size
  return {
    family: availableFonts.some((option) => option.family === family) ? family : fallback.family,
    size
  }
}

export function getTerminalFontSettings(): TerminalFontSettings {
  const availableFonts = listTerminalFonts()
  if (typeof localStorage === 'undefined') return defaultTerminalFontSettings(availableFonts)

  try {
    const stored = localStorage.getItem(TERMINAL_FONT_STORAGE_KEY)
    return resolveTerminalFontSettings(stored ? JSON.parse(stored) : null, availableFonts)
  } catch {
    return defaultTerminalFontSettings(availableFonts)
  }
}

export function saveTerminalFontSettings(settings: TerminalFontSettings): void {
  try {
    localStorage.setItem(TERMINAL_FONT_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // A restricted storage environment should not prevent terminal use.
  }
}

export function xtermFontFamily(family: string): string {
  return family === 'monospace' ? family : `"${family}", monospace`
}
