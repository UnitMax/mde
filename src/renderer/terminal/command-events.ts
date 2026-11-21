/**
 * Tells whoever listens that a command was entered in a terminal: Enter was pressed at the shell. Enter in a
 * full-screen program (an editor, a pager) does not count; those run on the alternate screen.
 */
type Listener = () => void

const listeners = new Map<string, Set<Listener>>()

/** Calls `listener` each time a command is entered in the terminal, until the returned function is called. */
export function onTerminalCommand(terminalId: string, listener: Listener): () => void {
  let set = listeners.get(terminalId)
  if (!set) listeners.set(terminalId, (set = new Set()))
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0 && listeners.get(terminalId) === set) listeners.delete(terminalId)
  }
}

/**
 * Called with what the terminal sends to its program for the person's input. Only Enter on its own counts: a
 * paste that ends with a newline arrives as one piece with the text.
 */
export function noteTerminalInput(terminalId: string, data: string, alternateScreen: boolean): void {
  if (data !== '\r' || alternateScreen) return
  for (const listener of [...(listeners.get(terminalId) ?? [])]) listener()
}
