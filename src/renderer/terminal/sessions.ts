import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import type { PtySize } from '@shared/types'
import {
  getTerminalSettings,
  xtermFontFamily,
  type TerminalSettings
} from './terminal-settings'

export type RendererKind = 'webgl' | 'dom'

export interface TerminalSession {
  sessionId: string
  term: Terminal
  fit: FitAddon
  /**
   * The element xterm was opened into. It is moved between hosts and never
   * destroyed, which is what makes a session survive switching sessions.
   */
  container: HTMLDivElement
  renderer: RendererKind
}

const THEME = {
  // Keep the terminal's base surface aligned with MDE, but leave xterm's
  // ANSI palette untouched. CLI TUIs use those palette entries (including
  // reverse video and background colors) for elements such as prompt bars.
  background: '#0b0e13',
  foreground: '#d8dee9',
  cursor: '#5b8cff',
  cursorAccent: '#0b0e13',
  selectionBackground: '#2c3a52'
}

/** One live xterm per session id, independent of what React currently renders. */
const sessions = new Map<string, TerminalSession>()

let bridgeReady = false

/** Wires the single main->renderer data stream. Safe to call more than once. */
export function initTerminalBridge(): void {
  if (bridgeReady) return
  bridgeReady = true
  window.api.pty.onData(({ sessionId, data }) => {
    sessions.get(sessionId)?.term.write(data)
  })
}

export function getSession(sessionId: string): TerminalSession | undefined {
  return sessions.get(sessionId)
}

function createSession(sessionId: string, host: HTMLElement): TerminalSession {
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
    theme: THEME
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
    void window.api.pty.write({ sessionId, data })
  })

  const session: TerminalSession = { sessionId, term, fit, container, renderer }
  sessions.set(sessionId, session)
  return session
}

/** Applies terminal settings without recreating terminals or their PTY processes. */
export function applyTerminalSettings(settings: TerminalSettings): void {
  for (const session of sessions.values()) {
    session.term.options.fontFamily = xtermFontFamily(settings.family)
    session.term.options.fontSize = settings.size
    session.term.options.lineHeight = settings.lineHeight
  }
}

/** Creates the session on first view, or re-parents the existing one. */
export function attachSession(sessionId: string, host: HTMLElement): TerminalSession {
  const existing = sessions.get(sessionId)
  if (!existing) return createSession(sessionId, host)
  if (existing.container.parentElement !== host) host.appendChild(existing.container)
  return existing
}

/** Takes the terminal out of the DOM without destroying it. */
export function detachSession(sessionId: string): void {
  sessions.get(sessionId)?.container.remove()
}

export function disposeSession(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (!session) return
  sessions.delete(sessionId)
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
