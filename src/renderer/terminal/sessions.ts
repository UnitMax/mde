import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import type { PtySize } from '@shared/types'
import {
  getTerminalFontSettings,
  xtermFontFamily,
  type TerminalFontSettings
} from './font-settings'

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
  background: '#0b0e13',
  foreground: '#d8dee9',
  cursor: '#5b8cff',
  cursorAccent: '#0b0e13',
  selectionBackground: '#2c3a52',
  black: '#0b0e13',
  red: '#f0574f',
  green: '#3fb950',
  yellow: '#d8a325',
  blue: '#5b8cff',
  magenta: '#bc7cf0',
  cyan: '#39c5cf',
  white: '#b6bec9',
  brightBlack: '#58616f',
  brightRed: '#ff7b72',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79a4ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f3f7'
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

  const font = getTerminalFontSettings()
  const term = new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    fontFamily: xtermFontFamily(font.family),
    fontSize: font.size,
    lineHeight: 1.2,
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

/** Applies font settings without recreating terminals or their PTY processes. */
export function applyTerminalFontSettings(settings: TerminalFontSettings): void {
  for (const session of sessions.values()) {
    session.term.options.fontFamily = xtermFontFamily(settings.family)
    session.term.options.fontSize = settings.size
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
