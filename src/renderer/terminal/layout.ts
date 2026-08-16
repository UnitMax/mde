export type TerminalLayout = 'single' | 'columns' | 'three' | 'quadrant'

export interface TerminalPaneState {
  terminalId: string
  primary: boolean
  exited?: boolean
}

export interface SessionTerminalLayout {
  layout: TerminalLayout
  panes: TerminalPaneState[]
}

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
    panes: [{ terminalId: sessionId, primary: true }]
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
