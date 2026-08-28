import type {
  PersistedTerminalLayout,
  Session,
  SessionTab
} from '@shared/types'
import {
  defaultTerminalLayoutSizes,
  type SessionTerminalLayout,
  type TerminalPaneState
} from './layout'

export function defaultSessionTab(sessionId: string): SessionTab {
  return {
    id: `${sessionId}:tab:default`,
    name: 'Tab 1',
    layout: {
      layout: 'single',
      panes: [{ id: 'pane-1' }],
      sizes: defaultTerminalLayoutSizes()
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

export function createRuntimeLayout(sessionId: string, tab: SessionTab): SessionTerminalLayout {
  return {
    layout: tab.layout.layout,
    panes: tab.layout.panes.map((pane) => ({
      terminalId: terminalIdForPane(sessionId, tab.id, pane.id),
      paneId: pane.id,
      ...(pane.title?.trim() ? { title: pane.title.trim() } : {})
    })),
    sizes: { ...tab.layout.sizes }
  }
}

export function runtimeLayoutsForSession(
  session: Session,
  existing: Record<string, SessionTerminalLayout> = {}
): Record<string, SessionTerminalLayout> {
  const next: Record<string, SessionTerminalLayout> = {}
  sessionTabs(session).forEach((tab) => {
    next[tab.id] = existing[tab.id] ?? createRuntimeLayout(session.id, tab)
  })
  return next
}

export function persistRuntimeLayout(layout: SessionTerminalLayout): PersistedTerminalLayout {
  return {
    layout: layout.layout,
    panes: layout.panes.map((pane) => ({
      id: pane.paneId ?? pane.terminalId,
      ...(pane.title?.trim() ? { title: pane.title.trim() } : {})
    })),
    sizes: { ...layout.sizes }
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
