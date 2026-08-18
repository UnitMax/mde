export type TerminalLayout = 'single' | 'columns' | 'three' | 'quadrant'

export type TerminalResizeAxis = 'column' | 'row'

export type TerminalResizeScope = 'full' | 'top'

export interface TerminalPaneState {
  terminalId: string
  primary: boolean
  exited?: boolean
}

/** Ratios describe the first track on each axis; the second track gets the remainder. */
export interface TerminalLayoutSizes {
  columnRatio: number
  rowRatio: number
}

export interface SessionTerminalLayout {
  layout: TerminalLayout
  panes: TerminalPaneState[]
  sizes: TerminalLayoutSizes
}

export interface TerminalResizeHandleDefinition {
  axis: TerminalResizeAxis
  scope: TerminalResizeScope
}

export const TERMINAL_RESIZE_MIN_TRACK_PX = 120
export const TERMINAL_RESIZE_GAP_PX = 1

export const TERMINAL_LAYOUTS: readonly {
  value: TerminalLayout
  label: string
  count: number
}[] = [
  { value: 'single', label: 'One terminal', count: 1 },
  { value: 'columns', label: 'Two terminals side by side', count: 2 },
  { value: 'three', label: 'Three terminals', count: 3 },
  { value: 'quadrant', label: 'Four terminals in a quadrant', count: 4 }
]

export function terminalCount(layout: TerminalLayout): number {
  return TERMINAL_LAYOUTS.find((candidate) => candidate.value === layout)?.count ?? 1
}

export function layoutForCount(count: number): TerminalLayout {
  return TERMINAL_LAYOUTS.find((candidate) => candidate.count === count)?.value ?? 'single'
}

export function defaultTerminalLayoutSizes(): TerminalLayoutSizes {
  return { columnRatio: 0.5, rowRatio: 0.5 }
}

export function terminalResizeHandles(layout: TerminalLayout): readonly TerminalResizeHandleDefinition[] {
  if (layout === 'columns') return [{ axis: 'column', scope: 'full' }]
  if (layout === 'three') {
    return [
      { axis: 'column', scope: 'top' },
      { axis: 'row', scope: 'full' }
    ]
  }
  if (layout === 'quadrant') {
    return [
      { axis: 'column', scope: 'full' },
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

export function terminalGridTemplates(
  layout: TerminalLayout,
  sizes: TerminalLayoutSizes
): { columns: string; rows: string } {
  const columns = layout === 'single'
    ? 'minmax(0, 1fr)'
    : `minmax(0, ${sizes.columnRatio}fr) minmax(0, ${1 - sizes.columnRatio}fr)`
  const rows = layout === 'single' || layout === 'columns'
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

  const digit = /^[1-4]$/.test(input.key)
    ? input.key
    : input.code?.match(/^(?:Digit|Numpad)([1-4])$/)?.[1]
  if (!digit) return null

  return layoutForCount(Number(digit))
}

export function layoutClass(layout: TerminalLayout): string {
  if (layout === 'single') return 'grid-cols-1 grid-rows-1'
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
export function panesToTrim(panes: readonly TerminalPaneState[], targetCount: number): string[] {
  const excess = Math.max(0, panes.length - targetCount)
  return [...panes]
    .reverse()
    .filter((pane) => !pane.primary)
    .slice(0, excess)
    .map((pane) => pane.terminalId)
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
