import type { AlertKind, TaskbarAttentionRequest, TaskbarFlash, TaskbarIndicator } from '@shared/taskbar-attention'

/** The parts of a `BrowserWindow` this uses, so that tests can stand in for it. */
export interface AttentionWindow {
  isDestroyed(): boolean
  isFocused(): boolean
  flashFrame(flag: boolean): void
  setProgressBar(progress: number, options?: { mode: 'none' | 'normal' | 'indeterminate' | 'error' | 'paused' }): void
  setOverlayIcon(overlay: unknown, description: string): void
}

export interface TaskbarAttentionDependencies {
  platform: string
  getWindow(): AttentionWindow | null
  /** The badge image for a tone and count. Only asked for on Windows, where the taskbar has overlay icons. */
  badge(tone: AlertKind, count: number): unknown
  setInterval(callback: () => void, ms: number): unknown
  clearInterval(timer: unknown): void
}

/** `flashFrame(true)` makes Windows flash the button a few times; this is how often a continuous flash starts it again. */
export const CONTINUOUS_FLASH_MS = 4000

/** The colour Windows gives the button's progress bar, which is shown full: red, yellow or green. */
const PROGRESS_MODES: Record<AlertKind, 'error' | 'paused' | 'normal'> = {
  failed: 'error',
  input: 'paused',
  done: 'normal'
}

const TONE_LABELS: Record<AlertKind, string> = {
  failed: 'failed',
  input: 'waiting for you',
  done: 'done'
}

export function indicatorDescription(indicator: TaskbarIndicator): string {
  return `${indicator.count} ${indicator.count === 1 ? 'thread' : 'threads'} ${TONE_LABELS[indicator.tone]}`
}

/**
 * The window's button in the taskbar (or dock): flashing it, colouring it and putting a badge on it. All of it
 * is plain Win32/Electron window state, so nothing has to be installed. Windows is the only platform with a
 * coloured progress bar and an overlay icon; the flash is also an urgency hint on Linux and a dock bounce on macOS.
 */
export class TaskbarAttention {
  private timer: unknown = null
  private indicatorKey = ''

  constructor(private readonly dependencies: TaskbarAttentionDependencies) {}

  update(request: TaskbarAttentionRequest): void {
    const window = this.window()
    if (!window) return
    if (request.flash) this.flash(window, request.flash)
    this.showIndicator(window, request.indicator)
  }

  /** The window was used: Windows stops the flash itself, but a continuous one has a timer to stop as well. */
  windowFocused(): void {
    this.stopTimer()
    const window = this.window()
    if (window) window.flashFrame(false)
  }

  /** The window is going away. */
  dispose(): void {
    this.stopTimer()
  }

  private window(): AttentionWindow | null {
    const window = this.dependencies.getWindow()
    return window && !window.isDestroyed() ? window : null
  }

  private flash(window: AttentionWindow, mode: TaskbarFlash): void {
    this.stopTimer()
    if (mode === 'none') {
      window.flashFrame(false)
      return
    }
    // Windows does not flash the window in use, and there is nothing to ask for when it is.
    if (window.isFocused()) return
    window.flashFrame(true)
    if (mode !== 'continuous') return
    this.timer = this.dependencies.setInterval(() => {
      const current = this.window()
      if (!current || current.isFocused()) this.stopTimer()
      else current.flashFrame(true)
    }, CONTINUOUS_FLASH_MS)
  }

  private showIndicator(window: AttentionWindow, indicator: TaskbarIndicator | null): void {
    if (this.dependencies.platform !== 'win32') return
    const key = indicator ? `${indicator.tone}:${indicator.count}` : ''
    if (key === this.indicatorKey) return
    this.indicatorKey = key
    if (!indicator) {
      window.setProgressBar(-1)
      window.setOverlayIcon(null, '')
      return
    }
    window.setProgressBar(1, { mode: PROGRESS_MODES[indicator.tone] })
    window.setOverlayIcon(this.dependencies.badge(indicator.tone, indicator.count), indicatorDescription(indicator))
  }

  private stopTimer(): void {
    if (this.timer === null) return
    this.dependencies.clearInterval(this.timer)
    this.timer = null
  }
}
