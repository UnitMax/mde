import { createContext, useContext } from 'react'

/**
 * What a terminal's right-click menu can do with the selected text besides copying it. Only a terminal that
 * has somewhere to send the text provides it; without it the menu offers Copy alone.
 */
export interface TerminalSelectionActions {
  /** Whether there is a place to send the text to right now (a thread is open). */
  canSend: boolean
  sendLabel: string
  send: (text: string) => void
}

export const TerminalSelectionActionsContext = createContext<TerminalSelectionActions | null>(null)

export function useTerminalSelectionActions(): TerminalSelectionActions | null {
  return useContext(TerminalSelectionActionsContext)
}
