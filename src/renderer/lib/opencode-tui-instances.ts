import type { OpenCodeTuiInstanceStatus } from '@shared/types'
import type { SessionTerminalLayout } from '@/terminal/layout'
import { directoryLeafName } from '@/lib/terminal-title'

/**
 * What a pane is called until it is renamed: its OpenCode label, else the folder the shell is in,
 * else a fixed word while the directory is not known yet.
 */
export function terminalPaneDefaultTitle(
  instance: OpenCodeTuiInstanceStatus | undefined,
  layout: SessionTerminalLayout,
  directory?: string | null
): string {
  if (instance) {
    const paneIndex = layout.panes.findIndex((pane) => pane.terminalId === instance.terminalId)
    return instance.title?.trim() || `OpenCode ${paneIndex >= 0 ? paneIndex + 1 : 1}`
  }
  return directoryLeafName(directory) ?? 'terminal'
}

export function terminalPaneTitle(
  instance: OpenCodeTuiInstanceStatus | undefined,
  layout: SessionTerminalLayout,
  customTitle?: string,
  directory?: string | null
): string {
  const trimmedCustomTitle = customTitle?.trim()
  if (trimmedCustomTitle) return trimmedCustomTitle
  return terminalPaneDefaultTitle(instance, layout, directory)
}
