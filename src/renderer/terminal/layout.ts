import type {
  TerminalLaunch,
  TerminalLayout,
  TerminalLayoutSizes
} from '@shared/types'

export type { TerminalLayout, TerminalLayoutSizes } from '@shared/types'

export type TerminalResizeAxis = 'column' | 'row'

/** `top` ends at the row divider of a two-row layout; `upper` ends at the second divider of a three-row one. */
export type TerminalResizeScope = 'full' | 'top' | 'upper'
export type TerminalColumnIndex = 0 | 1
export type TerminalRowIndex = 0 | 1

export interface TerminalPaneState {
  terminalId: string
  /** Stable persisted pane key when the layout belongs to a session tab. */
  paneId?: string
  /** Optional user-defined title for this pane. */
  title?: string
  exited?: boolean
  /** Runtime-only launch metadata; deliberately omitted from persisted tabs. */
  launch?: RuntimeTerminalLaunch
}

export type RuntimeTerminalLaunch = TerminalLaunch

export interface SessionTerminalLayout {
  layout: TerminalLayout
  panes: TerminalPaneState[]
  sizes: TerminalLayoutSizes
}

export interface TerminalResizeHandleDefinition {
  axis: TerminalResizeAxis
  scope: TerminalResizeScope
  columnIndex?: TerminalColumnIndex
  rowIndex?: TerminalRowIndex
}

export const TERMINAL_RESIZE_MIN_TRACK_PX = 120
export const TERMINAL_RESIZE_GAP_PX = 1

export const TERMINAL_LAYOUTS: readonly {
  value: TerminalLayout
  label: string
  count: number
  /** Digit for Ctrl+<digit>; absent when no free digit is left for the layout. */
  shortcut?: number
}[] = [
  { value: 'single', label: 'One terminal', count: 1, shortcut: 1 },
  { value: 'columns', label: 'Two terminals side by side', count: 2, shortcut: 2 },
  { value: 'three', label: 'Three terminals', count: 3, shortcut: 3 },
  { value: 'quadrant', label: 'Four terminals in a quadrant', count: 4, shortcut: 4 },
  { value: 'fiveGrid', label: 'Five terminals in a 3 × 2 grid', count: 5, shortcut: 5 },
  { value: 'sixGrid', label: 'Six terminals in a 3 × 2 grid', count: 6, shortcut: 6 },
  // Ctrl+0 resets the zoom, so the seven-terminal layout has no shortcut of its own.
  { value: 'sevenGrid', label: 'Seven terminals in a 3 × 3 grid', count: 7 },
  { value: 'eightGrid', label: 'Eight terminals in a 3 × 3 grid', count: 8, shortcut: 8 },
  { value: 'nineGrid', label: 'Nine terminals in a 3 × 3 grid', count: 9, shortcut: 9 },
  { value: 'threeColumns', label: 'Three terminals side by side', count: 3, shortcut: 7 }
]

export const MAX_TERMINAL_COUNT = Math.max(...TERMINAL_LAYOUTS.map((candidate) => candidate.count))

export function isThreeRowLayout(layout: TerminalLayout): boolean {
  return layout === 'sevenGrid' || layout === 'eightGrid' || layout === 'nineGrid'
}

export function isThreeColumnLayout(layout: TerminalLayout): boolean {
  return layout === 'threeColumns' || layout === 'fiveGrid' || layout === 'sixGrid' ||
    isThreeRowLayout(layout)
}

/**
 * Panes per row for layouts drawn as stacked rows, each with its own column split, so a short
 * last row can divide the full width evenly. Null for layouts drawn as one grid.
 */
export function terminalRowGroups(layout: TerminalLayout): readonly number[] | null {
  if (layout === 'fiveGrid') return [3, 2]
  if (layout === 'sevenGrid') return [3, 3, 1]
  if (layout === 'eightGrid') return [3, 3, 2]
  if (layout === 'nineGrid') return [3, 3, 3]
  return null
}

/** Column tracks for one row of a stacked layout: the shared ratios when it has three panes. */
export function terminalRowColumns(paneCount: number, sizes: TerminalLayoutSizes): string {
  return paneCount === 3
    ? terminalGridTemplates('threeColumns', sizes).columns
    : `repeat(${paneCount}, minmax(0, 1fr))`
}

export function terminalCount(layout: TerminalLayout): number {
  return TERMINAL_LAYOUTS.find((candidate) => candidate.value === layout)?.count ?? 1
}

export function layoutForCount(count: number): TerminalLayout {
  return TERMINAL_LAYOUTS.find((candidate) => candidate.count === count)?.value ?? 'single'
}

export function defaultTerminalLayoutSizes(layout: TerminalLayout = 'single'): TerminalLayoutSizes {
  if (isThreeRowLayout(layout)) {
    return { columnRatio: 1 / 3, secondColumnRatio: 2 / 3, rowRatio: 1 / 3, secondRowRatio: 2 / 3 }
  }
  if (isThreeColumnLayout(layout)) {
    return { columnRatio: 1 / 3, rowRatio: 0.5, secondColumnRatio: 2 / 3 }
  }
  return { columnRatio: 0.5, rowRatio: 0.5 }
}

export function terminalResizeHandles(layout: TerminalLayout): readonly TerminalResizeHandleDefinition[] {
  if (layout === 'columns') return [{ axis: 'column', scope: 'full', columnIndex: 0 }]
  if (layout === 'three') {
    return [
      { axis: 'column', scope: 'top', columnIndex: 0 },
      { axis: 'row', scope: 'full' }
    ]
  }
  if (layout === 'quadrant') {
    return [
      { axis: 'column', scope: 'full', columnIndex: 0 },
      { axis: 'row', scope: 'full' }
    ]
  }
  if (layout === 'threeColumns') {
    return [
      { axis: 'column', scope: 'full', columnIndex: 0 },
      { axis: 'column', scope: 'full', columnIndex: 1 }
    ]
  }
  if (layout === 'fiveGrid') {
    return [
      { axis: 'column', scope: 'top', columnIndex: 0 },
      { axis: 'column', scope: 'top', columnIndex: 1 },
      { axis: 'row', scope: 'full' }
    ]
  }
  if (layout === 'sixGrid') {
    return [
      { axis: 'column', scope: 'full', columnIndex: 0 },
      { axis: 'column', scope: 'full', columnIndex: 1 },
      { axis: 'row', scope: 'full' }
    ]
  }
  if (isThreeRowLayout(layout)) {
    // A short last row has its own even split, so the shared column dividers stop above it.
    const scope = layout === 'nineGrid' ? 'full' : 'upper'
    return [
      { axis: 'column', scope, columnIndex: 0 },
      { axis: 'column', scope, columnIndex: 1 },
      { axis: 'row', scope: 'full', rowIndex: 0 },
      { axis: 'row', scope: 'full', rowIndex: 1 }
    ]
  }
  return []
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

function validRatioPair(first: number, second: number): boolean {
  return Number.isFinite(first) && Number.isFinite(second) && first > 0 && first < second && second < 1
}

export function terminalColumnRatios(sizes: TerminalLayoutSizes): [number, number] {
  const first = sizes.columnRatio
  const second = sizes.secondColumnRatio ?? 2 / 3
  return validRatioPair(first, second) ? [first, second] : [1 / 3, 2 / 3]
}

export function terminalRowRatios(sizes: TerminalLayoutSizes): [number, number] {
  const first = sizes.rowRatio
  const second = sizes.secondRowRatio ?? 2 / 3
  return validRatioPair(first, second) ? [first, second] : [1 / 3, 2 / 3]
}

/** Converts a pointer position into a bounded ratio for one of three tracks. */
function threeTrackSplitRatio(
  pointerPosition: number,
  trackSize: number,
  index: 0 | 1,
  [first, second]: [number, number],
  minTrackSize: number,
  gap: number
): number {
  const gapCount = 2
  const usableSize = Math.max(0, trackSize - gap * gapCount)
  if (usableSize === 0) return index === 0 ? 1 / 3 : 2 / 3

  const usablePosition = Math.min(
    Math.max(pointerPosition - (index + 0.5) * gap, 0),
    usableSize
  )
  const minimumRatio = Math.min(Math.max(minTrackSize, 0) / usableSize, 1 / 3)
  const lowerBound = index === 0 ? minimumRatio : first + minimumRatio
  const upperBound = index === 0 ? second - minimumRatio : 1 - minimumRatio
  if (lowerBound >= upperBound) return (lowerBound + upperBound) / 2
  return Math.min(Math.max(usablePosition / usableSize, lowerBound), upperBound)
}

/** Converts a pointer position into a bounded ratio for one of three columns. */
export function terminalColumnSplitRatio(
  pointerPosition: number,
  trackSize: number,
  columnIndex: TerminalColumnIndex,
  sizes: TerminalLayoutSizes,
  minTrackSize = TERMINAL_RESIZE_MIN_TRACK_PX,
  gap = TERMINAL_RESIZE_GAP_PX
): number {
  return threeTrackSplitRatio(
    pointerPosition,
    trackSize,
    columnIndex,
    terminalColumnRatios(sizes),
    minTrackSize,
    gap
  )
}

/** Converts a pointer position into a bounded ratio for one of three rows. */
export function terminalRowSplitRatio(
  pointerPosition: number,
  trackSize: number,
  rowIndex: TerminalRowIndex,
  sizes: TerminalLayoutSizes,
  minTrackSize = TERMINAL_RESIZE_MIN_TRACK_PX,
  gap = TERMINAL_RESIZE_GAP_PX
): number {
  return threeTrackSplitRatio(
    pointerPosition,
    trackSize,
    rowIndex,
    terminalRowRatios(sizes),
    minTrackSize,
    gap
  )
}

export function terminalGridTemplates(
  layout: TerminalLayout,
  sizes: TerminalLayoutSizes
): { columns: string; rows: string } {
  if (isThreeRowLayout(layout)) {
    const [firstRowRatio, secondRowRatio] = terminalRowRatios(sizes)
    return {
      columns: 'minmax(0, 1fr)',
      rows: `minmax(0, ${firstRowRatio}fr) minmax(0, ${secondRowRatio - firstRowRatio}fr) minmax(0, ${1 - secondRowRatio}fr)`
    }
  }
  const [firstColumnRatio, secondColumnRatio] = terminalColumnRatios(sizes)
  const columns = layout === 'single'
    ? 'minmax(0, 1fr)'
    : layout === 'fiveGrid'
      ? 'minmax(0, 1fr)'
      : isThreeColumnLayout(layout)
        ? `minmax(0, ${firstColumnRatio}fr) minmax(0, ${secondColumnRatio - firstColumnRatio}fr) minmax(0, ${1 - secondColumnRatio}fr)`
        : `minmax(0, ${sizes.columnRatio}fr) minmax(0, ${1 - sizes.columnRatio}fr)`
  const rows = layout === 'single' || layout === 'columns' || layout === 'threeColumns'
    ? 'minmax(0, 1fr)'
    : `minmax(0, ${sizes.rowRatio}fr) minmax(0, ${1 - sizes.rowRatio}fr)`
  return { columns, rows }
}

export interface TerminalLayoutShortcutInput {
  type: string
  key: string
  code?: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

export function getTerminalLayoutShortcut(input: TerminalLayoutShortcutInput): TerminalLayout | null {
  if (input.type !== 'keydown' || !input.control || input.meta || input.alt || input.shift) return null

  const digit = /^[1-9]$/.test(input.key)
    ? input.key
    : input.code?.match(/^(?:Digit|Numpad)([1-9])$/)?.[1]
  if (!digit) return null

  return TERMINAL_LAYOUTS.find((candidate) => candidate.shortcut === Number(digit))?.value ?? null
}

export function layoutClass(layout: TerminalLayout): string {
  if (layout === 'single') return 'grid-cols-1 grid-rows-1'
  if (layout === 'threeColumns') return 'grid-cols-3 grid-rows-1'
  if (layout === 'fiveGrid') return 'grid-cols-1 grid-rows-2'
  if (layout === 'sixGrid') return 'grid-cols-3 grid-rows-2'
  if (isThreeRowLayout(layout)) return 'grid-cols-1 grid-rows-3'
  return layout === 'three' || layout === 'quadrant'
    ? 'grid-cols-2 grid-rows-2'
    : 'grid-cols-2 grid-rows-1'
}

export function paneClass(layout: TerminalLayout, index: number): string {
  return layout === 'three' && index === 2 ? 'col-span-2' : ''
}

export function createSessionTerminalLayout(sessionId: string): SessionTerminalLayout {
  return {
    layout: 'single',
    panes: [{ terminalId: sessionId }],
    sizes: defaultTerminalLayoutSizes()
  }
}

/** Returns the newest panes needed to reach the requested count. */
export function panesToTrim(
  panes: readonly TerminalPaneState[],
  targetCount: number
): string[] {
  const excess = Math.max(0, panes.length - targetCount)
  const newest = [...panes].reverse().map((pane) => pane.terminalId)
  return newest.slice(0, excess)
}

/** A terminal pane can close only while another pane can remain visible. */
export function isTerminalPaneClosable(
  panes: readonly TerminalPaneState[],
  terminalId: string
): boolean {
  return panes.length > 1 && panes.some((pane) => pane.terminalId === terminalId)
}

export function removeTerminalPane(
  layout: SessionTerminalLayout,
  terminalId: string
): SessionTerminalLayout | null {
  if (!isTerminalPaneClosable(layout.panes, terminalId)) return null
  const panes = layout.panes.filter((pane) => pane.terminalId !== terminalId)
  const nextLayout = layoutForCount(panes.length)
  return {
    layout: nextLayout,
    panes,
    sizes: defaultTerminalLayoutSizes(nextLayout)
  }
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
