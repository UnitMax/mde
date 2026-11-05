import { act } from 'react'

/** The ⋯ button in a pane's header, which holds the pane's less common actions. */
/** Radix runs a closing menu's focus hand-back in a timeout, so a test has to wait that one out. */
const settle = (): Promise<void> => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

export const paneMenuTrigger = (terminalId: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-testid="terminal-pane-menu-${terminalId}"]`)

export async function openPaneMenu(terminalId: string): Promise<void> {
  const trigger = paneMenuTrigger(terminalId)
  if (!trigger) throw new Error(`Pane ${terminalId} has no actions menu`)
  await act(async () => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
}

/** The menu's items by test id, e.g. `terminal-opencode-sessions-<id>`; null while the menu is closed. */
export const paneMenuItem = (testId: string): HTMLElement | null =>
  document.body.querySelector<HTMLElement>(`[role="menuitem"][data-testid="${testId}"]`)

export async function choosePaneMenuItem(terminalId: string, testId: string): Promise<void> {
  await openPaneMenu(terminalId)
  const item = paneMenuItem(testId)
  if (!item) throw new Error(`The menu of pane ${terminalId} has no ${testId}`)
  await act(async () => item.click())
  await settle()
}

export async function closePaneMenu(): Promise<void> {
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  await settle()
}

/** Whether the pane's menu lists an item; leaves the menu closed again. */
export async function paneMenuOffers(terminalId: string, testId: string): Promise<boolean> {
  await openPaneMenu(terminalId)
  const offered = paneMenuItem(testId) !== null
  await closePaneMenu()
  return offered
}
