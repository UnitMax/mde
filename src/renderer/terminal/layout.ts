import type { CSSProperties } from 'react'
import type { TerminalLaunch, TerminalLayoutNode } from '@shared/types'

export { MAX_TERMINAL_COUNT } from '@shared/terminal-layouts'
export type { TerminalLayoutNode, TerminalResizeAxis, TerminalSplitSide } from '@shared/types'

export interface TerminalPaneState {
  terminalId: string
  paneId?: string
  title?: string
  exited?: boolean
  /** Runtime-only launch metadata; deliberately omitted from persisted tabs. */
  launch?: RuntimeTerminalLaunch
}

export type RuntimeTerminalLaunch = TerminalLaunch

export interface SessionTerminalLayout {
  tree: TerminalLayoutNode
  /** Spatial order, matching the leaves of the tree. */
  panes: TerminalPaneState[]
}

export const TERMINAL_RESIZE_MIN_TRACK_PX = 120
export const TERMINAL_RESIZE_GAP_PX = 1

export function paneKey(pane: TerminalPaneState): string {
  return pane.paneId ?? pane.terminalId
}

export function mapTerminalTree(
  tree: TerminalLayoutNode,
  change: (node: TerminalLayoutNode) => TerminalLayoutNode,
): TerminalLayoutNode {
  const node = tree.type === 'split'
    ? { ...tree, first: mapTerminalTree(tree.first, change), second: mapTerminalTree(tree.second, change) }
    : tree
  return change(node)
}

/** Converts a pointer position into a bounded ratio for two adjacent tracks. */
export function terminalSplitRatio(
  pointerPosition: number,
  trackSize: number,
  minTrackSize = TERMINAL_RESIZE_MIN_TRACK_PX,
  gap = TERMINAL_RESIZE_GAP_PX
): number {
  const usableSize = Math.max(0, trackSize - gap)
  if (usableSize === 0) return 0.5

  const usablePosition = Math.min(Math.max(pointerPosition - gap / 2, 0), usableSize)
  const effectiveMinimum = Math.min(Math.max(minTrackSize, 0), usableSize / 2)
  const minimumRatio = effectiveMinimum / usableSize
  return Math.min(Math.max(usablePosition / usableSize, minimumRatio), 1 - minimumRatio)
}

export function isTerminalPaneClosable(panes: readonly TerminalPaneState[], terminalId: string): boolean {
  return panes.length > 1 && panes.some((pane) => pane.terminalId === terminalId)
}

/** Collapses only the removed pane's parent, preserving every other split and ratio. */
export function removeTerminalPane(layout: SessionTerminalLayout, terminalId: string): SessionTerminalLayout | null {
  if (!isTerminalPaneClosable(layout.panes, terminalId)) return null
  const removed = layout.panes.find((pane) => pane.terminalId === terminalId)!
  const remove = (node: TerminalLayoutNode): TerminalLayoutNode | null => {
    if (node.type === 'pane') return node.paneId === paneKey(removed) ? null : node
    const first = remove(node.first)
    const second = remove(node.second)
    return first && second ? { ...node, first, second } : first ?? second
  }
  const tree = remove(layout.tree)
  return tree ? { tree, panes: layout.panes.filter((pane) => pane.terminalId !== terminalId) } : null
}

interface Coordinate {
  fraction: number
  pixels: number
}

interface Rectangle {
  left: Coordinate
  top: Coordinate
  width: Coordinate
  height: Coordinate
}
const cssCoordinate = ({ fraction, pixels }: Coordinate): string => `calc(${fraction * 100}% + ${pixels}px)`
const rectStyle = (rect: Rectangle): CSSProperties => ({
  left: cssCoordinate(rect.left),
  top: cssCoordinate(rect.top),
  width: cssCoordinate(rect.width),
  height: cssCoordinate(rect.height),
})

/** Flat positioned slots keep terminal components mounted when their split ancestry changes. */
export function terminalLayoutGeometry(tree: TerminalLayoutNode): {
  panes: { paneId: string; style: CSSProperties }[]
  splits: { node: Extract<TerminalLayoutNode, { type: 'split' }>; style: CSSProperties }[]
} {
  const panes: { paneId: string; style: CSSProperties }[] = []
  const splits: { node: Extract<TerminalLayoutNode, { type: 'split' }>; style: CSSProperties }[] = []
  const visit = (node: TerminalLayoutNode, rect: Rectangle): void => {
    if (node.type === 'pane') {
      panes.push({ paneId: node.paneId, style: rectStyle(rect) })
      return
    }
    splits.push({ node, style: rectStyle(rect) })
    const size = node.axis === 'column' ? 'width' : 'height'
    const start = node.axis === 'column' ? 'left' : 'top'
    const usable = { ...rect[size], pixels: rect[size].pixels - TERMINAL_RESIZE_GAP_PX }
    const first = { fraction: usable.fraction * node.ratio, pixels: usable.pixels * node.ratio }
    const second = { fraction: usable.fraction * (1 - node.ratio), pixels: usable.pixels * (1 - node.ratio) }
    visit(node.first, { ...rect, [size]: first })
    visit(node.second, { ...rect, [size]: second, [start]: {
      fraction: rect[start].fraction + first.fraction,
      pixels: rect[start].pixels + first.pixels + TERMINAL_RESIZE_GAP_PX,
    } })
  }
  visit(tree, {
    left: { fraction: 0, pixels: 0 }, top: { fraction: 0, pixels: 0 },
    width: { fraction: 1, pixels: 0 }, height: { fraction: 1, pixels: 0 },
  })
  return { panes, splits }
}

/** Selects a surviving terminal to focus after one or more panes are removed. */
export function terminalFocusTargetAfterRemoval(
  panes: readonly TerminalPaneState[],
  removedTerminalIds: readonly string[],
  focusedTerminalId: string | null
): string | null {
  const removed = new Set(removedTerminalIds)
  const remaining = panes.filter((pane) => !removed.has(pane.terminalId))
  if (remaining.length === 0) return null

  const focusedIndex = focusedTerminalId !== null
    ? panes.findIndex((pane) => pane.terminalId === focusedTerminalId)
    : -1

  if (focusedIndex < 0) return remaining[0]!.terminalId
  if (focusedTerminalId !== null && !removed.has(focusedTerminalId)) {
    return focusedTerminalId
  }

  for (let index = focusedIndex - 1; index >= 0; index -= 1) {
    const pane = panes[index]
    if (pane && !removed.has(pane.terminalId)) return pane.terminalId
  }

  for (let index = focusedIndex + 1; index < panes.length; index += 1) {
    const pane = panes[index]
    if (pane && !removed.has(pane.terminalId)) return pane.terminalId
  }

  return remaining[0]!.terminalId
}

/** Swaps two panes by terminal ID without changing either pane's metadata. */
export function swapTerminalPanes(
  panes: readonly TerminalPaneState[],
  sourceTerminalId: string,
  targetTerminalId: string
): TerminalPaneState[] {
  const sourceIndex = panes.findIndex((pane) => pane.terminalId === sourceTerminalId)
  const targetIndex = panes.findIndex((pane) => pane.terminalId === targetTerminalId)
  const next = [...panes]

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return next

  const sourcePane = panes[sourceIndex]
  const targetPane = panes[targetIndex]
  if (!sourcePane || !targetPane) return next

  next[sourceIndex] = targetPane
  next[targetIndex] = sourcePane
  return next
}

/** Rebuilds pane order from IDs, returning null for anything but a full permutation. */
export function orderTerminalPanes(
  panes: readonly TerminalPaneState[],
  terminalIds: readonly string[]
): TerminalPaneState[] | null {
  if (terminalIds.length !== panes.length) return null

  const panesById = new Map(panes.map((pane) => [pane.terminalId, pane]))
  const ordered = terminalIds.map((terminalId) => panesById.get(terminalId))
  if (ordered.some((pane) => pane === undefined)) return null
  if (new Set(terminalIds).size !== panes.length) return null

  return ordered as TerminalPaneState[]
}
