import { createContext, useContext } from 'react'

/**
 * What a terminal's right-click menu can do with the selected text besides copying it. Only a terminal that
 * has somewhere to send the text provides it; without it the menu offers Copy alone.
 */
export interface TerminalSelectionActions {
  /** Whether a thread is open to send the text to right now. */
  canSend: boolean
  /** Sends the text to the open thread. */
  send: (text: string) => void
  /** Starts a new thread with the text. */
  sendNew: (text: string) => void
}

export const TerminalSelectionActionsContext = createContext<TerminalSelectionActions | null>(null)

export function useTerminalSelectionActions(): TerminalSelectionActions | null {
  return useContext(TerminalSelectionActionsContext)
}
