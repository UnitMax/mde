import type { WindowMode } from '@shared/types'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const MINI_WINDOW_SIZE = { width: 320, height: 440 } as const
export const MINI_WINDOW_MIN_SIZE = { width: 240, height: 160 } as const
export const MINI_WINDOW_MARGIN = 16

export type MiniWindowAction = 'toggle' | 'ignore'

interface MiniWindowInput {
  type: string
  key: string
  code?: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  isAutoRepeat?: boolean
}

/**
 * Returns what a keyboard event means for the mini window. A held F12 is swallowed
 * ('ignore') so its repeats neither reach the terminal nor flicker the window.
 */
export function getMiniWindowAction(input: MiniWindowInput): MiniWindowAction | null {
  if (
    input.type !== 'keyDown' ||
    input.control || input.meta || input.alt || input.shift ||
    (input.key !== 'F12' && input.code !== 'F12')
  ) {
    return null
  }
  return input.isAutoRepeat ? 'ignore' : 'toggle'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Chooses where the mini window goes: the remembered bounds clamped into the current
 * work area, or the work area's top-right corner when nothing is remembered.
 */
export function miniWindowBounds(saved: Rect | null, workArea: Rect): Rect {
  const width = clamp(saved?.width ?? MINI_WINDOW_SIZE.width, MINI_WINDOW_MIN_SIZE.width, workArea.width)
  const height = clamp(saved?.height ?? MINI_WINDOW_SIZE.height, MINI_WINDOW_MIN_SIZE.height, workArea.height)
  if (!saved) {
    return {
      x: workArea.x + workArea.width - width - MINI_WINDOW_MARGIN,
      y: workArea.y + MINI_WINDOW_MARGIN,
      width,
      height
    }
  }
  return {
    x: clamp(saved.x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(saved.y, workArea.y, workArea.y + workArea.height - height),
    width,
    height
  }
}

/** The slice of BrowserWindow the controller needs, so it can be tested without Electron. */
export interface MiniWindowTarget {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  isMaximized(): boolean
  maximize(): void
  unmaximize(): void
  isFullScreen(): boolean
  setFullScreen(flag: boolean): void
  getBounds(): Rect
  /** Bounds of the normal state, whatever state the window is currently in. */
  getNormalBounds(): Rect
  setBounds(bounds: Rect): void
  getMinimumSize(): number[]
  setMinimumSize(width: number, height: number): void
  setAlwaysOnTop(flag: boolean, level?: 'floating'): void
  setMaximizable(flag: boolean): void
  focus(): void
  once(event: 'leave-full-screen', listener: () => void): unknown
}

export interface MiniWindowDependencies {
  getWindow(): MiniWindowTarget | null
  workAreaFor(bounds: Rect): Rect
  onChange(mode: WindowMode): void
}

interface SavedWindowState {
  bounds: Rect
  minimumSize: number[]
  maximized: boolean
  fullScreen: boolean
}

/**
 * Shrinks the main window into an always-on-top agents list and back. The same
 * window and renderer are reused, so every terminal keeps running underneath. The
 * previous geometry lives in memory only; it is never written to disk.
 */
export class MiniWindowController {
  private current: WindowMode = 'normal'
  private saved: SavedWindowState | null = null
  private lastMiniBounds: Rect | null = null
  /** True while waiting for the window to leave fullscreen before it shrinks. */
  private entering = false

  constructor(private readonly deps: MiniWindowDependencies) {}

  get mode(): WindowMode {
    return this.current
  }

  toggle(): void {
    if (this.current === 'mini') this.exit()
    else this.enter()
  }

  set(mode: WindowMode): void {
    if (mode === 'mini') this.enter()
    else this.exit()
  }

  enter(): void {
    const window = this.liveWindow()
    if (!window || this.current === 'mini' || this.entering) return

    if (window.isMinimized()) window.restore()
    this.saved = {
      bounds: window.getNormalBounds(),
      minimumSize: window.getMinimumSize(),
      maximized: window.isMaximized(),
      fullScreen: window.isFullScreen()
    }

    if (this.saved.fullScreen) {
      this.entering = true
      window.once('leave-full-screen', () => {
        this.entering = false
        this.shrink(window)
      })
      window.setFullScreen(false)
      return
    }
    this.shrink(window)
  }

  exit(): void {
    const saved = this.saved
    if (this.current !== 'mini' || !saved) return
    const window = this.liveWindow()
    if (!window) {
      this.reset()
      return
    }

    if (window.isMinimized()) window.restore()
    // The normal-state bounds, so a mini window the user maximized is remembered at its
    // list size. Maximizing it is only prevented where the platform supports that.
    this.lastMiniBounds = window.getNormalBounds()
    if (window.isMaximized()) window.unmaximize()
    window.setAlwaysOnTop(false)
    window.setMaximizable(true)
    window.setMinimumSize(saved.minimumSize[0] ?? 0, saved.minimumSize[1] ?? 0)
    window.setBounds(saved.bounds)
    if (saved.maximized) window.maximize()
    if (saved.fullScreen) window.setFullScreen(true)
    window.focus()

    this.saved = null
    this.current = 'normal'
    this.deps.onChange('normal')
  }

  /** Forgets the saved geometry, for when the window it described is gone. */
  reset(): void {
    this.current = 'normal'
    this.saved = null
    this.entering = false
  }

  private shrink(window: MiniWindowTarget): void {
    const saved = this.saved
    if (window.isDestroyed() || !saved) {
      this.reset()
      return
    }

    if (window.isMaximized()) window.unmaximize()
    // Double-clicking the title bar or pressing its maximize button must not blow the list up.
    window.setMaximizable(false)
    window.setMinimumSize(MINI_WINDOW_MIN_SIZE.width, MINI_WINDOW_MIN_SIZE.height)
    window.setBounds(
      miniWindowBounds(this.lastMiniBounds, this.deps.workAreaFor(this.lastMiniBounds ?? saved.bounds))
    )
    window.setAlwaysOnTop(true, 'floating')

    this.current = 'mini'
    this.deps.onChange('mini')
  }

  private liveWindow(): MiniWindowTarget | null {
    const window = this.deps.getWindow()
    return window && !window.isDestroyed() ? window : null
  }
}
