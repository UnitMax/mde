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

export function isTerminalFullscreenShortcut(input: TerminalFullscreenShortcutInput): boolean {
  return (
    input.type === 'keydown' &&
    input.control &&
    input.shift &&
    !input.meta &&
    !input.alt &&
    (input.key.toLocaleLowerCase() === 'f' || input.code === 'KeyF')
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
