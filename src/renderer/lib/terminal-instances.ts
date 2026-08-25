import type { SessionTerminalLayout, TerminalPaneState } from '@/terminal/layout'

/** Returns panes that should be represented by the general terminal switcher. */
export function terminalPanesForSidebar(
  layout: SessionTerminalLayout,
  openCodeTerminalIds: ReadonlySet<string>
): TerminalPaneState[] {
  return layout.panes.filter((pane) => !openCodeTerminalIds.has(pane.terminalId))
}

/** Labels a terminal by its current visible pane position. */
export function terminalPaneLabel(
  pane: TerminalPaneState,
  layout: SessionTerminalLayout
): string {
  const paneIndex = layout.panes.findIndex((candidate) => candidate.terminalId === pane.terminalId)
  return `Terminal ${paneIndex >= 0 ? paneIndex + 1 : 1}`
}

/** Produces a compact directory label while retaining the full path for a tooltip. */
export function terminalDirectoryLabel(directory?: string): string | null {
  const value = directory?.trim()
  if (!value) return null

  const withoutTrailingSeparators = value.replace(/[\\/]+$/, '')
  if (!withoutTrailingSeparators) return value

  const separator = Math.max(
    withoutTrailingSeparators.lastIndexOf('/'),
    withoutTrailingSeparators.lastIndexOf('\\')
  )
  return withoutTrailingSeparators.slice(separator + 1) || withoutTrailingSeparators
}
