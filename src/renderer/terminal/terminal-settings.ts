import { isApplicationThemeId, type ApplicationThemeId } from '@/theme/themes'
import { isOsc52Policy, type Osc52Policy } from './osc52'
import type { CodingAgent } from '@shared/types'

export interface AgentCommandSetting {
  executable: string
  args: string
}

export type AgentCommandSettings = Record<CodingAgent, AgentCommandSetting>

export interface TerminalSettings {
  family: string
  size: number
  /** xterm line-height multiplier relative to the selected font size. */
  lineHeight: number
  theme: ApplicationThemeId
  /** Whether Escape exits the temporary fullscreen terminal view. */
  escapeExitsFullscreen: boolean
  /** Whether individual non-OpenCode terminal panes appear in the sidebar. */
  showTerminalInstances: boolean
  /**
   * How much confirmation a program needs before OSC 52 may set the host
   * clipboard. Hidden, unfocused and idle panes are refused under every value.
   */
  osc52Policy: Osc52Policy
  agents: AgentCommandSettings
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

const DEFAULT_AGENT_SETTINGS: AgentCommandSettings = {
  opencode: { executable: 'opencode', args: '' },
  codex: { executable: 'codex', args: '' },
  claude: { executable: 'claude', args: '' }
}

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
    escapeExitsFullscreen: false,
    showTerminalInstances: false,
    osc52Policy: 'notify',
    agents: {
      opencode: { ...DEFAULT_AGENT_SETTINGS.opencode },
      codex: { ...DEFAULT_AGENT_SETTINGS.codex },
      claude: { ...DEFAULT_AGENT_SETTINGS.claude }
    }
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
  const storedAgents = typeof record.agents === 'object' && record.agents !== null
    ? record.agents as Record<string, unknown>
    : {}
  const agents = (Object.keys(DEFAULT_AGENT_SETTINGS) as CodingAgent[]).reduce(
    (result, kind) => {
      const stored = storedAgents[kind]
      const value = typeof stored === 'object' && stored !== null
        ? stored as Record<string, unknown>
        : {}
      result[kind] = {
        executable: typeof value.executable === 'string'
          ? value.executable
          : fallback.agents[kind].executable,
        args: typeof value.args === 'string' ? value.args : fallback.agents[kind].args
      }
      return result
    },
    {} as AgentCommandSettings
  )
  return {
    family: availableFonts.some((option) => option.family === family) ? family : fallback.family,
    size,
    lineHeight,
    theme,
    escapeExitsFullscreen:
      typeof record.escapeExitsFullscreen === 'boolean'
        ? record.escapeExitsFullscreen
        : fallback.escapeExitsFullscreen,
    showTerminalInstances:
      typeof record.showTerminalInstances === 'boolean'
        ? record.showTerminalInstances
        : fallback.showTerminalInstances,
    osc52Policy: isOsc52Policy(record.osc52Policy) ? record.osc52Policy : fallback.osc52Policy,
    agents
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
