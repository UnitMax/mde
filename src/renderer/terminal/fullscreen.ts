import type { TerminalPaneState } from './layout'

export interface TerminalFullscreenShortcutInput {
  type: string
  key: string
  code?: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

export interface TerminalFullscreenKeyInput {
  key: string
  escapeExitsFullscreen: boolean
  fullscreenTerminalId: string | null
  inDialog: boolean
}

/** Ctrl+Shift+Enter toggles fullscreen for the focused terminal. Ctrl+Shift+F belongs to the Inbox's search over all threads. */
export function isTerminalFullscreenShortcut(input: TerminalFullscreenShortcutInput): boolean {
  return (
    input.type === 'keydown' &&
    input.control &&
    input.shift &&
    !input.meta &&
    !input.alt &&
    (input.key === 'Enter' || input.code === 'Enter' || input.code === 'NumpadEnter')
  )
}

export function terminalFullscreenPane(
  panes: readonly TerminalPaneState[],
  terminalId: string | null
): TerminalPaneState | null {
  if (!terminalId) return null
  return panes.find((pane) => pane.terminalId === terminalId) ?? null
}

export function shouldExitTerminalFullscreen(input: TerminalFullscreenKeyInput): boolean {
  return (
    input.key === 'Escape' &&
    input.escapeExitsFullscreen &&
    input.fullscreenTerminalId !== null &&
    !input.inDialog
  )
}
