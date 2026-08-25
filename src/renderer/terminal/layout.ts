import type { TerminalLayout, TerminalLayoutSizes } from '@shared/types'

export type { TerminalLayout, TerminalLayoutSizes } from '@shared/types'

export type TerminalResizeAxis = 'column' | 'row'

export type TerminalResizeScope = 'full' | 'top'
export type TerminalColumnIndex = 0 | 1

export interface TerminalPaneState {
  terminalId: string
  primary: boolean
  /** Stable persisted pane key when the layout belongs to a session tab. */
  paneId?: string
  exited?: boolean
}

export interface SessionTerminalLayout {
  layout: TerminalLayout
  panes: TerminalPaneState[]
  sizes: TerminalLayoutSizes
}

export interface TerminalResizeHandleDefinition {
  axis: TerminalResizeAxis
  scope: TerminalResizeScope
  columnIndex?: TerminalColumnIndex
}

export const TERMINAL_RESIZE_MIN_TRACK_PX = 120
export const TERMINAL_RESIZE_GAP_PX = 1

export const TERMINAL_LAYOUTS: readonly {
  value: TerminalLayout
  label: string
  count: number
  shortcut: number
}[] = [
  { value: 'single', label: 'One terminal', count: 1, shortcut: 1 },
  { value: 'columns', label: 'Two terminals side by side', count: 2, shortcut: 2 },
  { value: 'three', label: 'Three terminals', count: 3, shortcut: 3 },
  { value: 'quadrant', label: 'Four terminals in a quadrant', count: 4, shortcut: 4 },
  { value: 'threeColumns', label: 'Three terminals side by side', count: 3, shortcut: 5 },
  { value: 'sixGrid', label: 'Six terminals in a 3 × 2 grid', count: 6, shortcut: 6 }
]

export const MAX_TERMINAL_COUNT = Math.max(...TERMINAL_LAYOUTS.map((candidate) => candidate.count))

export function isThreeColumnLayout(layout: TerminalLayout): boolean {
  return layout === 'threeColumns' || layout === 'sixGrid'
}

export function terminalCount(layout: TerminalLayout): number {
  return TERMINAL_LAYOUTS.find((candidate) => candidate.value === layout)?.count ?? 1
}

export function layoutForCount(count: number): TerminalLayout {
  return TERMINAL_LAYOUTS.find((candidate) => candidate.count === count)?.value ?? 'single'
}

export function defaultTerminalLayoutSizes(layout: TerminalLayout = 'single'): TerminalLayoutSizes {
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
  if (layout === 'sixGrid') {
    return [
      { axis: 'column', scope: 'full', columnIndex: 0 },
      { axis: 'column', scope: 'full', columnIndex: 1 },
      { axis: 'row', scope: 'full' }
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

export function terminalColumnRatios(sizes: TerminalLayoutSizes): [number, number] {
  const first = sizes.columnRatio
  const second = sizes.secondColumnRatio ?? 2 / 3
  if (
    Number.isFinite(first) &&
    Number.isFinite(second) &&
    first > 0 &&
    first < second &&
    second < 1
  ) {
    return [first, second]
  }
  return [1 / 3, 2 / 3]
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
  const gapCount = 2
  const usableSize = Math.max(0, trackSize - gap * gapCount)
  if (usableSize === 0) return columnIndex === 0 ? 1 / 3 : 2 / 3

  const [first, second] = terminalColumnRatios(sizes)
  const usablePosition = Math.min(
    Math.max(pointerPosition - (columnIndex + 0.5) * gap, 0),
    usableSize
  )
  const minimumRatio = Math.min(Math.max(minTrackSize, 0) / usableSize, 1 / 3)
  const lowerBound = columnIndex === 0 ? minimumRatio : first + minimumRatio
  const upperBound = columnIndex === 0 ? second - minimumRatio : 1 - minimumRatio
  if (lowerBound >= upperBound) return (lowerBound + upperBound) / 2
  return Math.min(Math.max(usablePosition / usableSize, lowerBound), upperBound)
}

export function terminalGridTemplates(
  layout: TerminalLayout,
  sizes: TerminalLayoutSizes
): { columns: string; rows: string } {
  const [firstColumnRatio, secondColumnRatio] = terminalColumnRatios(sizes)
  const columns = layout === 'single'
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

  const digit = /^[1-6]$/.test(input.key)
    ? input.key
    : input.code?.match(/^(?:Digit|Numpad)([1-6])$/)?.[1]
  if (!digit) return null

  return TERMINAL_LAYOUTS.find((candidate) => candidate.shortcut === Number(digit))?.value ?? null
}

export function layoutClass(layout: TerminalLayout): string {
  if (layout === 'single') return 'grid-cols-1 grid-rows-1'
  if (layout === 'threeColumns') return 'grid-cols-3 grid-rows-1'
  if (layout === 'sixGrid') return 'grid-cols-3 grid-rows-2'
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
    panes: [{ terminalId: sessionId, primary: true }],
    sizes: defaultTerminalLayoutSizes()
  }
}

/** Returns the newest removable panes needed to reach the requested count. */
export function panesToTrim(
  panes: readonly TerminalPaneState[],
  targetCount: number,
  requestedTerminalId?: string
): string[] {
  const excess = Math.max(0, panes.length - targetCount)
  const newest = [...panes]
    .reverse()
    .filter((pane) => !pane.primary)
    .map((pane) => pane.terminalId)
  if (!requestedTerminalId || !newest.includes(requestedTerminalId)) return newest.slice(0, excess)
  return [requestedTerminalId, ...newest.filter((terminalId) => terminalId !== requestedTerminalId)]
    .slice(0, excess)
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
