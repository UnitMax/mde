import type {
  OpenCodeTuiInstanceLabelMode,
  OpenCodeTuiInstanceStatus
} from '@shared/types'
import type { SessionTerminalLayout } from '@/terminal/layout'

export function orderOpenCodeTuiInstances(
  instances: readonly OpenCodeTuiInstanceStatus[],
  layout?: SessionTerminalLayout
): OpenCodeTuiInstanceStatus[] {
  const positions = new Map(
    layout?.panes.map((pane, index) => [pane.terminalId, index]) ?? []
  )
  return [...instances].sort((a, b) => {
    const aPosition = positions.get(a.terminalId) ?? Number.MAX_SAFE_INTEGER
    const bPosition = positions.get(b.terminalId) ?? Number.MAX_SAFE_INTEGER
    if (aPosition !== bPosition) return aPosition - bPosition
    return a.terminalId.localeCompare(b.terminalId)
  })
}

export function openCodeTuiInstanceLabel(
  instance: OpenCodeTuiInstanceStatus,
  orderedIndex: number,
  mode: OpenCodeTuiInstanceLabelMode,
  layout?: SessionTerminalLayout
): string {
  const paneIndex = layout?.panes.findIndex((pane) => pane.terminalId === instance.terminalId) ?? -1
  const fallback = `OpenCode ${paneIndex >= 0 ? paneIndex + 1 : orderedIndex + 1}`
  return mode === 'title' && instance.title?.trim() ? instance.title.trim() : fallback
}

export function terminalPaneTitle(
  instance: OpenCodeTuiInstanceStatus | undefined,
  layout: SessionTerminalLayout,
  customTitle?: string
): string {
  const trimmedCustomTitle = customTitle?.trim()
  if (trimmedCustomTitle) return trimmedCustomTitle
  if (!instance) return 'terminal'
  return openCodeTuiInstanceLabel(instance, 0, 'title', layout)
}
