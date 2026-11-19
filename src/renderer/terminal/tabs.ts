import type {
  PersistedTerminalLayout,
  Session,
  SessionTab
} from '@shared/types'
import {
  mapTerminalTree,
  paneKey,
  MAX_TERMINAL_COUNT,
  type SessionTerminalLayout,
  type TerminalPaneState,
  type TerminalSplitSide
} from './layout'

export function defaultSessionTab(sessionId: string): SessionTab {
  return {
    id: `${sessionId}:tab:default`,
    name: 'Tab 1',
    layout: {
      tree: { type: 'pane', paneId: 'pane-1' },
      panes: [{ id: 'pane-1' }]
    }
  }
}

export function sessionTabs(session: Session): SessionTab[] {
  return session.tabs && session.tabs.length > 0 ? session.tabs : [defaultSessionTab(session.id)]
}

export function activeSessionTab(session: Session): SessionTab {
  const tabs = sessionTabs(session)
  return tabs.find((tab) => tab.id === session.activeTabId) ?? tabs[0]!
}

export function terminalIdForPane(sessionId: string, tabId: string, paneId: string): string {
  return `${sessionId}:tab:${tabId}:pane:${paneId}`
}

/** Returns the first split-pane key not already used by a runtime layout. */
export function nextPaneId(panes: readonly TerminalPaneState[]): string {
  const used = new Set(
    panes
      .map((pane) => pane.paneId)
      .filter((paneId): paneId is string => paneId !== undefined)
  )
  let index = 1
  while (used.has(`pane-${index}`)) index += 1
  return `pane-${index}`
}

/**
 * A pane key no pane has had before: random, where `nextPaneId` hands out the lowest number free. The Inbox terminal
 * uses it because an agent can be given a pane to read (see `@shared/terminal-references`), and a pane that took the
 * key of a closed one would also take what the agent was given.
 */
export function randomPaneId(panes: readonly TerminalPaneState[]): string {
  const used = new Set(panes.map((pane) => pane.paneId))
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(6))
    const paneId = `pane-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
    if (!used.has(paneId)) return paneId
  }
}

export function splitRuntimePane(
  sessionId: string,
  tabId: string,
  layout: SessionTerminalLayout,
  sourceTerminalId: string,
  side: TerminalSplitSide,
  newPaneId: (panes: readonly TerminalPaneState[]) => string = nextPaneId,
): SessionTerminalLayout | null {
  if (layout.panes.length >= MAX_TERMINAL_COUNT) return null
  const source = layout.panes.find((pane) => pane.terminalId === sourceTerminalId)
  if (!source) return null
  const paneId = newPaneId(layout.panes)
  const added: TerminalPaneState = {
    terminalId: terminalIdForPane(sessionId, tabId, paneId),
    paneId,
  }
  const before = side === 'left' || side === 'top'
  const tree = mapTerminalTree(layout.tree, (node) => node.type === 'pane' && node.paneId === paneKey(source)
    ? {
        type: 'split',
        id: crypto.randomUUID(),
        axis: side === 'left' || side === 'right' ? 'column' : 'row',
        ratio: 0.5,
        first: before ? { type: 'pane', paneId } : node,
        second: before ? node : { type: 'pane', paneId },
      }
    : node)
  const panes = [...layout.panes]
  panes.splice(panes.indexOf(source) + (before ? 0 : 1), 0, added)
  return { tree, panes }
}

export function createRuntimeLayout(sessionId: string, tab: SessionTab): SessionTerminalLayout {
  return {
    tree: structuredClone(tab.layout.tree),
    panes: tab.layout.panes.map((pane) => ({
      terminalId: terminalIdForPane(sessionId, tab.id, pane.id),
      paneId: pane.id,
      ...(pane.title?.trim() ? { title: pane.title.trim() } : {})
    }))
  }
}

export function persistRuntimeLayout(layout: SessionTerminalLayout): PersistedTerminalLayout {
  return {
    tree: structuredClone(layout.tree),
    panes: layout.panes.map((pane) => ({
      id: pane.paneId ?? pane.terminalId,
      ...(pane.title?.trim() ? { title: pane.title.trim() } : {})
    }))
  }
}

export function tabForTerminal(
  session: Session,
  terminalId: string
): { tab: SessionTab; pane: TerminalPaneState } | null {
  for (const tab of sessionTabs(session)) {
    const layout = createRuntimeLayout(session.id, tab)
    const pane = layout.panes.find((candidate) => candidate.terminalId === terminalId)
    if (pane) return { tab, pane }
  }
  return null
}

export function tabCloseSelection(
  tabs: readonly SessionTab[],
  closedTabId: string,
  activeTabId: string | undefined
): string | null {
  if (tabs.length <= 1) return null
  const index = tabs.findIndex((tab) => tab.id === closedTabId)
  if (index < 0) return activeTabId ?? tabs[0]?.id ?? null
  if (activeTabId !== closedTabId) return activeTabId ?? tabs[0]?.id ?? null
  return tabs[index + 1]?.id ?? tabs[index - 1]?.id ?? tabs[0]?.id ?? null
}
