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

/** The slice of BrowserWindow the controller needs, so it can be tested without Electron. */
export interface TitleBarTarget {
  isDestroyed(): boolean
  setTitleBarOverlay(options: TitleBarColors & { height: number }): void
}

export interface TitleBarDependencies {
  platform: string
  getWindow(): TitleBarTarget | null
}

/** Keeps the native window buttons matching the theme and the page zoom. */
export class TitleBarController {
  private colors: TitleBarColors = DEFAULT_TITLE_BAR_COLORS
  private zoom = 1

  constructor(private readonly deps: TitleBarDependencies) {}

  /** Constructor options for a new window, using the colors last chosen by the renderer. */
  windowOptions(): WindowChromeOptions {
    return windowChromeOptions(this.deps.platform, this.colors)
  }

  setColors(colors: TitleBarColors): void {
    this.colors = { color: colors.color, symbolColor: colors.symbolColor }
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
