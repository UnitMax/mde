import { mapTerminalTree, orderTerminalPanes, paneKey, type SessionTerminalLayout } from './layout'

/** Moves one divider without disturbing any other split. */
export function layoutResized(existing: SessionTerminalLayout, splitId: string, ratio: number): SessionTerminalLayout {
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) return existing
  return { ...existing, tree: mapTerminalTree(existing.tree, (node) =>
    node.type === 'split' && node.id === splitId ? { ...node, ratio } : node) }
}

/** Puts the panes in the given order. Null when that is not an order of the same panes. */
export function layoutReordered(
  existing: SessionTerminalLayout,
  terminalIds: readonly string[]
): SessionTerminalLayout | null {
  const panes = orderTerminalPanes(existing.panes, terminalIds)
  if (!panes) return null
  const replacements = new Map(existing.panes.map((pane, index) => [paneKey(pane), paneKey(panes[index]!)]))
  const tree = mapTerminalTree(existing.tree, (node) => node.type === 'pane'
    ? { ...node, paneId: replacements.get(node.paneId)! }
    : node)
  return { tree, panes }
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
