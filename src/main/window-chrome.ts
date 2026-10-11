/** Height of the custom title bar, in CSS pixels at 100% zoom. Keep in sync with `h-8` in TitleBar. */
export const TITLE_BAR_HEIGHT = 32

export interface TitleBarColors {
  color: string
  symbolColor: string
}

/** The Slate theme's panel and muted text. The renderer sends the saved theme's colors once it loads. */
export const DEFAULT_TITLE_BAR_COLORS: TitleBarColors = {
  color: '#10141b',
  symbolColor: '#7b8698'
}

export interface WindowChromeOptions {
  titleBarStyle?: 'hidden'
  titleBarOverlay?: TitleBarColors & { height: number }
  trafficLightPosition?: { x: number; y: number }
}

export type ThemeSource = 'dark' | 'light'

/** Whether a `#rgb` or `#rrggbb` color is closer to black than to white. */
export function isDarkColor(hex: string): boolean {
  const digits = hex.slice(1)
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits
  const [red = 0, green = 0, blue = 0] = [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16))
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255 < 0.5
}

/** The native window buttons are scaled by the OS, so they must follow page zoom by hand. */
export function titleBarOverlayHeight(zoom: number): number {
  return Math.max(1, Math.round(TITLE_BAR_HEIGHT * zoom))
}

/**
 * Hides the OS title bar but keeps its window buttons, drawn in the given colors so they
 * blend into the custom bar. Windows and Linux overlay them; macOS keeps its traffic lights.
 */
export function windowChromeOptions(
  platform: string,
  colors: TitleBarColors = DEFAULT_TITLE_BAR_COLORS
): WindowChromeOptions {
  if (platform === 'win32' || platform === 'linux') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: { ...colors, height: titleBarOverlayHeight(1) }
    }
  }
  if (platform === 'darwin') {
    return { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 10 } }
  }
  return {}
}

function themeSourceFor(colors: TitleBarColors): ThemeSource {
  return isDarkColor(colors.color) ? 'dark' : 'light'
}

/** The slice of BrowserWindow the controller needs, so it can be tested without Electron. */
export interface TitleBarTarget {
  isDestroyed(): boolean
  setTitleBarOverlay(options: TitleBarColors & { height: number }): void
}

export interface TitleBarDependencies {
  platform: string
  getWindow(): TitleBarTarget | null
  /**
   * Chooses the brightness the OS draws its own parts of the window in. The window buttons'
   * hover wash is light on a dark theme and dark on a light one, so left on the OS setting
   * it can darken an already dark bar and be invisible.
   */
  setThemeSource(source: ThemeSource): void
}

/** Keeps the native window buttons matching the theme and the page zoom. */
export class TitleBarController {
  private colors: TitleBarColors = DEFAULT_TITLE_BAR_COLORS
  private zoom = 1
  private themeSource: ThemeSource

  constructor(private readonly deps: TitleBarDependencies) {
    this.themeSource = themeSourceFor(this.colors)
    deps.setThemeSource(this.themeSource)
  }

  /** Constructor options for a new window, using the colors last chosen by the renderer. */
  windowOptions(): WindowChromeOptions {
    return windowChromeOptions(this.deps.platform, this.colors)
  }

  setColors(colors: TitleBarColors): void {
    this.colors = { color: colors.color, symbolColor: colors.symbolColor }
    const themeSource = themeSourceFor(this.colors)
    if (themeSource !== this.themeSource) {
      this.themeSource = themeSource
      this.deps.setThemeSource(themeSource)
    }
    this.apply()
  }

  setZoom(zoom: number): void {
    this.zoom = zoom
    this.apply()
  }

  private apply(): void {
    if (this.deps.platform !== 'win32' && this.deps.platform !== 'linux') return
    const window = this.deps.getWindow()
    if (!window || window.isDestroyed()) return
    // Every field is sent each time: a partial update is not guaranteed to keep the rest.
    window.setTitleBarOverlay({ ...this.colors, height: titleBarOverlayHeight(this.zoom) })
  }
}
