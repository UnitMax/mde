import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import type { PtySize } from '@shared/types'
import {
  getTerminalSettings,
  xtermFontFamily,
  type TerminalSettings
} from './terminal-settings'
import {
  getTerminalPalette,
  getTerminalTheme,
  type TerminalThemeId
} from './terminal-themes'

export type RendererKind = 'webgl' | 'dom'

export interface TerminalSession {
  terminalId: string
  term: Terminal
  fit: FitAddon
  /**
   * The element xterm was opened into. It is moved between hosts and never
   * destroyed, which is what makes a session survive switching sessions.
   */
  container: HTMLDivElement
  renderer: RendererKind
  themeId: TerminalThemeId
}

/** One live xterm per runtime terminal id, independent of React rendering. */
const sessions = new Map<string, TerminalSession>()

let bridgeReady = false

/** Wires the single main->renderer data stream. Safe to call more than once. */
export function initTerminalBridge(): void {
  if (bridgeReady) return
  bridgeReady = true
  window.api.pty.onData(({ terminalId, data }) => {
    sessions.get(terminalId)?.term.write(data)
  })
}

export function getSession(terminalId: string): TerminalSession | undefined {
  return sessions.get(terminalId)
}

function createSession(terminalId: string, host: HTMLElement): TerminalSession {
  const container = document.createElement('div')
  container.className = 'h-full w-full'
  host.appendChild(container)

  const settings = getTerminalSettings()
  const term = new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    fontFamily: xtermFontFamily(settings.family),
    fontSize: settings.size,
    lineHeight: settings.lineHeight,
    scrollback: 10_000,
    theme: getTerminalTheme(settings.theme)
  })

  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(container)

  let renderer: RendererKind = 'dom'
  try {
    const webgl = new WebglAddon()
    // Some Linux VM / software-GL setups lose the context after creation.
    webgl.onContextLoss(() => {
      console.warn('[terminal] WebGL context lost; falling back to the DOM renderer')
      webgl.dispose()
    })
    term.loadAddon(webgl)
    renderer = 'webgl'
  } catch (error) {
    console.warn('[terminal] WebGL renderer unavailable, using the DOM renderer:', error)
  }

  term.onData((data) => {
    void window.api.pty.write({ terminalId, data })
  })

  const session: TerminalSession = {
    terminalId,
    term,
    fit,
    container,
    renderer,
    themeId: settings.theme
  }
  sessions.set(terminalId, session)
  return session
}

/** Applies terminal settings without recreating terminals or their PTY processes. */
export function applyTerminalSettings(settings: TerminalSettings): void {
  for (const session of sessions.values()) {
    session.term.options.fontFamily = xtermFontFamily(settings.family)
    session.term.options.fontSize = settings.size
    session.term.options.lineHeight = settings.lineHeight
    session.term.options.theme = getTerminalTheme(settings.theme)
    session.themeId = settings.theme
    void window.api.pty.setPalette({
      terminalId: session.terminalId,
      palette: getTerminalPalette(settings.theme)
    })
  }
}

export function applyTerminalTheme(themeId: TerminalThemeId): void {
  const theme = getTerminalTheme(themeId)
  for (const session of sessions.values()) {
    session.term.options.theme = theme
    session.themeId = themeId
    void window.api.pty.setPalette({
      terminalId: session.terminalId,
      palette: getTerminalPalette(themeId)
    })
  }
}

/** Creates the session on first view, or re-parents the existing one. */
export function attachSession(terminalId: string, host: HTMLElement): TerminalSession {
  const existing = sessions.get(terminalId)
  if (!existing) return createSession(terminalId, host)
  if (existing.container.parentElement !== host) host.appendChild(existing.container)
  return existing
}

/** Takes the terminal out of the DOM without destroying it. */
export function detachSession(terminalId: string): void {
  sessions.get(terminalId)?.container.remove()
}

export function disposeSession(terminalId: string): void {
  const session = sessions.get(terminalId)
  if (!session) return
  sessions.delete(terminalId)
  session.container.remove()
  session.term.dispose()
}

/** Re-measures the terminal. Returns the new size, or null if it is unmeasurable. */
export function fitSession(session: TerminalSession): PtySize | null {
  const rect = session.container.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return null

  try {
    session.fit.fit()
  } catch (error) {
    console.warn('[terminal] fit failed:', error)
    return null
  }

  const { cols, rows } = session.term
  if (!cols || !rows) return null
  return { cols, rows }
}
