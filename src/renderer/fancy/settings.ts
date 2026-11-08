/** The animated backgrounds fancy mode can draw behind the app. */
export const FANCY_BACKGROUNDS = ['aurora', 'constellation', 'contours'] as const
export type FancyBackgroundId = (typeof FANCY_BACKGROUNDS)[number]

export interface FancyBackgroundOption {
  id: FancyBackgroundId
  label: string
  description: string
}

export const FANCY_BACKGROUND_OPTIONS: readonly FancyBackgroundOption[] = [
  { id: 'aurora', label: 'Aurora', description: 'Curtains of light drifting across a night sky.' },
  { id: 'constellation', label: 'Constellation', description: 'A star network that hums with signals and follows the cursor.' },
  { id: 'contours', label: 'Contours', description: 'A topographic map whose ground slowly breathes.' }
]

export interface FancySettings {
  /** Fancy mode as a whole. Off, MDE draws no background and no thread effects. */
  enabled: boolean
  background: FancyBackgroundId
  /** Lightning on unread threads and digital rain on working ones, in the Inbox's thread list. */
  threadEffects: boolean
}

export const FANCY_SETTINGS_STORAGE_KEY = 'mde.fancy-mode'

export const DEFAULT_FANCY_SETTINGS: FancySettings = {
  enabled: false,
  background: 'aurora',
  threadEffects: true
}

export function isFancyBackgroundId(value: unknown): value is FancyBackgroundId {
  return typeof value === 'string' && (FANCY_BACKGROUNDS as readonly string[]).includes(value)
}

/** Settings from whatever was stored: a field that is missing or has the wrong type keeps its default. */
export function resolveFancySettings(value: unknown): FancySettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_FANCY_SETTINGS
  const record = value as Record<string, unknown>
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_FANCY_SETTINGS.enabled,
    background: isFancyBackgroundId(record.background) ? record.background : DEFAULT_FANCY_SETTINGS.background,
    threadEffects:
      typeof record.threadEffects === 'boolean' ? record.threadEffects : DEFAULT_FANCY_SETTINGS.threadEffects
  }
}

export function getFancySettings(): FancySettings {
  try {
    const stored = localStorage.getItem(FANCY_SETTINGS_STORAGE_KEY)
    return resolveFancySettings(stored ? JSON.parse(stored) : null)
  } catch {
    return DEFAULT_FANCY_SETTINGS
  }
}

export function saveFancySettings(settings: FancySettings): void {
  try {
    localStorage.setItem(FANCY_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // A restricted storage environment keeps the choice for this session only.
  }
}
