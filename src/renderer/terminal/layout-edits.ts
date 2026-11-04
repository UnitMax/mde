import {
  defaultTerminalLayoutSizes,
  orderTerminalPanes,
  terminalCount,
  type SessionTerminalLayout,
  type TerminalColumnIndex,
  type TerminalLayout,
  type TerminalResizeAxis,
  type TerminalRowIndex
} from './layout'
import { nextPaneId, terminalIdForPane } from './tabs'

/*
 * What each change to a terminal layout does to it, apart from where the layout is kept. Projects keep one
 * per tab of a session and the Inbox keeps its single one, but they edit them the same way.
 */

/**
 * Switches to a layout with as many panes as there are now, or more; the new panes are added. Null when the
 * layout holds fewer: closing terminals is the user's decision, so the caller asks first and then reduces.
 */
export function layoutSwitched(
  existing: SessionTerminalLayout,
  layout: TerminalLayout,
  sessionId: string,
  tabId: string
): SessionTerminalLayout | null {
  const targetCount = terminalCount(layout)
  if (targetCount < existing.panes.length) return null
  const panes = [...existing.panes]
  while (panes.length < targetCount) {
    const paneId = nextPaneId(panes)
    panes.push({ terminalId: terminalIdForPane(sessionId, tabId, paneId), paneId })
  }
  return { layout, panes, sizes: defaultTerminalLayoutSizes(layout) }
}

/** Switches to a smaller layout and drops the panes that no longer fit. */
export function layoutReduced(
  existing: SessionTerminalLayout,
  layout: TerminalLayout,
  droppedTerminalIds: readonly string[]
): SessionTerminalLayout {
  return {
    layout,
    panes: existing.panes.filter((pane) => !droppedTerminalIds.includes(pane.terminalId)),
    sizes: defaultTerminalLayoutSizes(layout)
  }
}

/** Moves one divider; `index` says which of the two dividers of a three-way split. */
export function layoutResized(
  existing: SessionTerminalLayout,
  axis: TerminalResizeAxis,
  ratio: number,
  index?: TerminalColumnIndex | TerminalRowIndex
): SessionTerminalLayout {
  const sizes = axis === 'column'
    ? index === 1
      ? { ...existing.sizes, secondColumnRatio: ratio }
      : { ...existing.sizes, columnRatio: ratio }
    : index === 1
      ? { ...existing.sizes, secondRowRatio: ratio }
      : { ...existing.sizes, rowRatio: ratio }
  return { ...existing, sizes }
}

/** Puts the panes in the given order. Null when that is not an order of the same panes. */
export function layoutReordered(
  existing: SessionTerminalLayout,
  terminalIds: readonly string[]
): SessionTerminalLayout | null {
  const panes = orderTerminalPanes(existing.panes, terminalIds)
  return panes ? { ...existing, panes } : null
}

/** Names a pane, or clears its name with an empty one. Null for a terminal that is not in the layout. */
export function layoutTitled(
  existing: SessionTerminalLayout,
  terminalId: string,
  title: string | null
): SessionTerminalLayout | null {
  if (!existing.panes.some((pane) => pane.terminalId === terminalId)) return null
  const normalized = title?.trim()
  return {
    ...existing,
    panes: existing.panes.map((pane) => {
      if (pane.terminalId !== terminalId) return pane
      const updated = { ...pane }
      if (normalized) updated.title = normalized
      else delete updated.title
      return updated
    })
  }
}
