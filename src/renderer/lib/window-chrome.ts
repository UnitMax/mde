import type { WindowChromeColors } from '@shared/ipc'
import { getApplicationTheme, type ApplicationThemeId } from '@/theme/themes'

/** The native window buttons are drawn by the OS, so they are tinted to sit on the bar. */
export function windowChromeColors(themeId: ApplicationThemeId): WindowChromeColors {
  const { panel, fgMuted } = getApplicationTheme(themeId).application
  return { color: panel, symbolColor: fgMuted }
}

/** Fire-and-forget: a failure only leaves the buttons in the previous colors. */
export function syncWindowChrome(themeId: ApplicationThemeId): void {
  try {
    void window.api.windowChrome.set(windowChromeColors(themeId)).catch(() => undefined)
  } catch {
    // No preload bridge, for example under test.
  }
}
