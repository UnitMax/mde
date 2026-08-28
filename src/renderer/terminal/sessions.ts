import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import type { PtySize } from '@shared/types'
import {
  createTerminalPrimarySelectionStore,
  decodeOsc52Clipboard,
  terminalClipboardAction,
  terminalMiddleClickAction,
  terminalRightClickAction,
  type TerminalPrimarySelectionMode
} from './clipboard'
import {
  getTerminalSettings,
  xtermFontFamily,
  type TerminalSettings
} from './terminal-settings'
import {
  getTerminalPalette,
  getTerminalTheme,
  type ApplicationThemeId
} from '@/theme/themes'

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
  themeId: ApplicationThemeId
  disposeClipboardHandlers: () => void
}

/** One live xterm per runtime terminal id, independent of React rendering. */
const sessions = new Map<string, TerminalSession>()
const localPrimarySelection = createTerminalPrimarySelectionStore()

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

function createSession(
  terminalId: string,
  host: HTMLElement,
  primarySelectionMode: TerminalPrimarySelectionMode
): TerminalSession {
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
    theme: getTerminalTheme(settings.theme),
    rightClickSelectsWord: false
  })

  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(container)

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
  term.attachCustomKeyEventHandler((event) => {
    const action = terminalClipboardAction(
      {
        key: event.key,
        code: event.code,
        control: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
        shift: event.shiftKey
      },
      term.hasSelection(),
      isMac
    )
    if (!action) return true

    if (action === 'copy') {
      event.preventDefault()
      event.stopPropagation()
      void window.api.clipboard.writeText(term.getSelection()).catch((error: unknown) => {
        console.warn('[terminal] clipboard copy failed:', error)
      })
    }

    // Returning false prevents xterm from sending the shortcut bytes to the
    // PTY. Paste actions intentionally leave the browser default untouched so
    // xterm's native paste event inserts the clipboard exactly once.
    return false
  })

  const onContextMenu = (event: MouseEvent): void => {
    const action = terminalRightClickAction(
      term.hasSelection(),
      term.modes.mouseTrackingMode
    )
    if (action !== 'copy') return

    event.preventDefault()
    event.stopPropagation()
    void window.api.clipboard.writeText(term.getSelection()).catch((error: unknown) => {
      console.warn('[terminal] right-click clipboard copy failed:', error)
    })
  }
  container.addEventListener('contextmenu', onContextMenu)

  const onAuxClick = (event: MouseEvent): void => {
    if (event.button !== 1) return

    const selection = localPrimarySelection.get()
    const action = terminalMiddleClickAction(
      primarySelectionMode,
      selection !== null,
      term.modes.mouseTrackingMode
    )
    if (action !== 'local-paste' || selection === null) return

    event.preventDefault()
    event.stopPropagation()
    term.focus()
    term.paste(selection)
  }
  container.addEventListener('auxclick', onAuxClick)

  const localSelectionDisposable = primarySelectionMode === 'local'
    ? term.onSelectionChange(() => {
      if (term.hasSelection()) localPrimarySelection.set(terminalId, term.getSelection())
    })
    : undefined

  const osc52Disposable = term.parser.registerOscHandler(52, (data) => {
    const text = decodeOsc52Clipboard(data)
    if (text !== null) {
      void window.api.clipboard.writeText(text).catch((error: unknown) => {
        console.warn('[terminal] OSC 52 clipboard write failed:', error)
      })
    }
    return true
  })

  const onCopy = (event: ClipboardEvent): void => {
    if (!term.hasSelection()) return
    event.preventDefault()
    event.stopPropagation()
    void window.api.clipboard.writeText(term.getSelection()).catch((error: unknown) => {
      console.warn('[terminal] clipboard copy failed:', error)
    })
  }
  container.addEventListener('copy', onCopy, true)

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
    themeId: settings.theme,
    disposeClipboardHandlers: () => {
      container.removeEventListener('contextmenu', onContextMenu)
      container.removeEventListener('auxclick', onAuxClick)
      container.removeEventListener('copy', onCopy, true)
      localSelectionDisposable?.dispose()
      localPrimarySelection.clear(terminalId)
      osc52Disposable.dispose()
    }
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

export function applyTerminalTheme(themeId: ApplicationThemeId): void {
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
export function attachSession(
  terminalId: string,
  host: HTMLElement,
  options: { primarySelectionMode?: TerminalPrimarySelectionMode } = {}
): TerminalSession {
  const existing = sessions.get(terminalId)
  if (!existing) return createSession(terminalId, host, options.primarySelectionMode ?? 'none')
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
  session.disposeClipboardHandlers()
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
