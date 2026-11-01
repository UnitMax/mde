import type { TerminalLayout } from './types'

/** Track dimensions describe the full rows; a short last row fills the available width. */
export const TERMINAL_LAYOUT_DEFINITIONS = {
  single: { count: 1, columns: 1, rows: 1, label: 'One terminal' },
  columns: { count: 2, columns: 2, rows: 1, label: 'Two terminals side by side' },
  three: { count: 3, columns: 2, rows: 2, label: 'Three terminals' },
  quadrant: { count: 4, columns: 2, rows: 2, label: 'Four terminals in a quadrant' },
  fiveGrid: { count: 5, columns: 3, rows: 2, label: 'Five terminals in a 3 × 2 grid' },
  sixGrid: { count: 6, columns: 3, rows: 2, label: 'Six terminals in a 3 × 2 grid' },
  sevenGrid: { count: 7, columns: 3, rows: 3, label: 'Seven terminals in a 3 × 3 grid' },
  eightGrid: { count: 8, columns: 3, rows: 3, label: 'Eight terminals in a 3 × 3 grid' },
  nineGrid: { count: 9, columns: 3, rows: 3, label: 'Nine terminals in a 3 × 3 grid' },
} as const satisfies Record<TerminalLayout, { count: number; columns: number; rows: number; label: string }>

export const MAX_TERMINAL_COUNT = Math.max(...Object.values(TERMINAL_LAYOUT_DEFINITIONS).map((entry) => entry.count))

export function isTerminalLayout(value: unknown): value is TerminalLayout {
  return typeof value === 'string' && Object.hasOwn(TERMINAL_LAYOUT_DEFINITIONS, value)
}

export function isThreeRowLayout(layout: TerminalLayout): boolean {
  return TERMINAL_LAYOUT_DEFINITIONS[layout].rows === 3
}

export function isThreeColumnLayout(layout: TerminalLayout): boolean {
  return TERMINAL_LAYOUT_DEFINITIONS[layout].columns === 3
}
