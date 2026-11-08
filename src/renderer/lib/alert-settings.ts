import { ALERT_KINDS, type AlertKind } from '@shared/taskbar-attention'

/** The ways the built-in synthesizer can play an alert; every kind has its own tune, and a voice decides how it sounds. */
export type AlertVoice = 'chime' | 'bell' | 'pluck'
export const ALERT_VOICES: readonly AlertVoice[] = ['chime', 'bell', 'pluck']

/** What plays for a kind: one of the voices, the system's own beep, or nothing. */
export type AlertSoundChoice = AlertVoice | 'beep' | 'off'
export const ALERT_SOUND_CHOICES: readonly AlertSoundChoice[] = [...ALERT_VOICES, 'beep', 'off']

export type AlertFlash = 'off' | 'brief' | 'until-focus'
export const ALERT_FLASHES: readonly AlertFlash[] = ['off', 'brief', 'until-focus']

export interface AlertSettings {
  /** Master switch for the sounds. */
  sound: boolean
  /** 0 to 1. */
  volume: number
  sounds: Record<AlertKind, AlertSoundChoice>
  flash: AlertFlash
  /** The colour and badge on the taskbar button. */
  badge: boolean
  /** Play sounds only while MDE is in the background. */
  onlyWhenAway: boolean
}

export const ALERT_SETTINGS_STORAGE_KEY = 'mde.alert-settings'
export const ALERT_SETTINGS_CHANGE_EVENT = 'mde:alert-settings-changed'

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  sound: true,
  volume: 0.6,
  sounds: { done: 'chime', input: 'bell', failed: 'pluck' },
  flash: 'brief',
  badge: true,
  onlyWhenAway: false
}

function isChoice(value: unknown): value is AlertSoundChoice {
  return ALERT_SOUND_CHOICES.includes(value as AlertSoundChoice)
}

function isFlash(value: unknown): value is AlertFlash {
  return ALERT_FLASHES.includes(value as AlertFlash)
}

/** Settings from whatever was stored: a field that is missing or no longer valid takes its default. */
export function normalizeAlertSettings(value: unknown): AlertSettings {
  const stored = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const storedSounds = stored.sounds && typeof stored.sounds === 'object' ? (stored.sounds as Record<string, unknown>) : {}
  const sounds = { ...DEFAULT_ALERT_SETTINGS.sounds }
  for (const kind of ALERT_KINDS) {
    const choice = storedSounds[kind]
    if (isChoice(choice)) sounds[kind] = choice
  }
  const volume = typeof stored.volume === 'number' && Number.isFinite(stored.volume)
    ? Math.min(1, Math.max(0, stored.volume))
    : DEFAULT_ALERT_SETTINGS.volume
  return {
    sound: typeof stored.sound === 'boolean' ? stored.sound : DEFAULT_ALERT_SETTINGS.sound,
    volume,
    sounds,
    flash: isFlash(stored.flash) ? stored.flash : DEFAULT_ALERT_SETTINGS.flash,
    badge: typeof stored.badge === 'boolean' ? stored.badge : DEFAULT_ALERT_SETTINGS.badge,
    onlyWhenAway: typeof stored.onlyWhenAway === 'boolean' ? stored.onlyWhenAway : DEFAULT_ALERT_SETTINGS.onlyWhenAway
  }
}

/** The settings last saved here; they hold even when the browser storage cannot. */
let saved: AlertSettings | null = null

export function getAlertSettings(): AlertSettings {
  if (saved) return saved
  try {
    const raw = window.localStorage.getItem(ALERT_SETTINGS_STORAGE_KEY)
    return normalizeAlertSettings(raw ? JSON.parse(raw) : undefined)
  } catch {
    return normalizeAlertSettings(undefined)
  }
}

export function saveAlertSettings(settings: AlertSettings): void {
  saved = settings
  try {
    window.localStorage.setItem(ALERT_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // They still apply until the window is closed.
  }
  window.dispatchEvent(new CustomEvent(ALERT_SETTINGS_CHANGE_EVENT, { detail: settings }))
}

/** Forgets what was saved, so the next read goes to the storage again. For tests. */
export function resetAlertSettingsCache(): void {
  saved = null
}
