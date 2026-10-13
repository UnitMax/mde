import type { OpenCodeTuiInstanceStatus, OpenCodeTuiStatus } from '@shared/types'

/** Which theme color a pane highlight is drawn in: accent, ok, or danger. */
export type TerminalHighlightTone = 'attention' | 'done' | 'error'

export interface TerminalHighlight {
  tone: TerminalHighlightTone
  /** Increases on every flash of the same terminal, so a repeat restarts the animation. */
  token: number
  /** Epoch milliseconds when the flash was requested. */
  at: number
}

/** Length of the CSS animation, and how long a flash stays worth replaying. */
export const TERMINAL_HIGHLIGHT_MS = 1600

export function highlightToneForStatus(
  status: OpenCodeTuiStatus | undefined
): TerminalHighlightTone {
  if (status === 'completed') return 'done'
  if (status === 'error') return 'error'
  return 'attention'
}

function highlightTone(status: OpenCodeTuiStatus): TerminalHighlightTone | null {
  return status === 'attention' || status === 'completed' || status === 'error'
    ? highlightToneForStatus(status)
    : null
}

/**
 * Finds the panes whose OpenCode agent just started waiting on the user, finished, or failed.
 * The plugin bumps `revision` only on a real status change, so a changed revision is a
 * transition and a title-only update is not. A pane with no earlier report never flashes, so
 * launching the app or first seeing an already-finished agent stays quiet.
 */
export function detectInstanceHighlights(
  previous: readonly OpenCodeTuiInstanceStatus[] | undefined,
  next: readonly OpenCodeTuiInstanceStatus[]
): { terminalId: string; tone: TerminalHighlightTone }[] {
  if (!previous) return []
  const previousRevisions = new Map(
    previous.map((instance) => [instance.terminalId, instance.revision])
  )
  return next.flatMap((instance) => {
    const tone = highlightTone(instance.status)
    const revision = previousRevisions.get(instance.terminalId)
    if (!tone || revision === undefined || revision === instance.revision) return []
    return [{ terminalId: instance.terminalId, tone }]
  })
}
