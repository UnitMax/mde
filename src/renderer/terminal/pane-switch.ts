import type { TerminalPaneState } from './layout'

/** How long Ctrl+Shift must be held before the pane overlay appears, so Ctrl+Shift+C/V do not flash it. */
export const PANE_OVERLAY_DELAY_MS = 200

export interface TerminalPaneSwitchInput {
  type: string
  key: string
  code?: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

/** Returns the zero-based pane index for Ctrl+Shift+1–9, or null for any other key event. */
export function getTerminalPaneSwitchIndex(input: TerminalPaneSwitchInput): number | null {
  if (input.type !== 'keydown' || !input.control || !input.shift || input.meta || input.alt) return null

  // Shift turns the digit's key into a symbol ('!', '@', …), so only the physical code is reliable.
  const digit = input.code?.match(/^(?:Digit|Numpad)([1-9])$/)?.[1]
  return digit ? Number(digit) - 1 : null
}

export function terminalPaneSwitchTarget(
  panes: readonly TerminalPaneState[],
  index: number
): TerminalPaneState | null {
  return panes[index] ?? null
}
