import { useWorkspace } from '@/store/workspace'
import { getSession } from './sessions'

const ATTEMPTS = 8

/**
 * Focuses a terminal once its screen is on the page, trying for a few frames while the pane mounts. `done`
 * runs when it is focused, or when it gave up. Returns a function that stops trying.
 */
export function focusTerminalWhenReady(
  terminalId: string,
  options: { highlight?: boolean; done?: () => void } = {}
): () => void {
  let attempts = 0
  let frame: number | undefined
  const focus = (): void => {
    const terminal = getSession(terminalId)
    if (terminal?.container.isConnected) {
      terminal.term.focus()
      if (options.highlight) useWorkspace.getState().flashTerminal(terminalId)
      options.done?.()
      return
    }
    attempts += 1
    if (attempts < ATTEMPTS) frame = window.requestAnimationFrame(focus)
    else options.done?.()
  }
  frame = window.requestAnimationFrame(focus)
  return () => {
    if (frame !== undefined) window.cancelAnimationFrame(frame)
  }
}
