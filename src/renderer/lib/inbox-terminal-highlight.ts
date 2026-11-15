import type { InboxThread } from '@shared/types'

/** The theme color used by an Inbox Terminal chat border. */
export type InboxTerminalHighlightTone = 'attention' | 'done' | 'error'

export interface InboxTerminalHighlight {
  tone: InboxTerminalHighlightTone
  /** Increases for each new animation, so a repeat restarts it. */
  token: number
  at: number
}

export const INBOX_TERMINAL_HIGHLIGHT_MS = 1600

/** Only new activity or status changes on an existing Terminal chat thread animate its border. */
export function inboxTerminalHighlightTone(
  previous: InboxThread | undefined,
  next: InboxThread
): InboxTerminalHighlightTone | null {
  if (previous?.mode !== 'terminal' || next.mode !== 'terminal') return null
  // Coming back from a snooze is not something the agent did.
  if (next.woke && !previous.woke && previous.status === next.status) return null
  if (
    previous.status === next.status &&
    previous.attentionReason === next.attentionReason &&
    next.lastActivityAt <= previous.lastActivityAt
  ) return null

  if (next.status === 'completed') return 'done'
  if (next.status === 'error') return 'error'
  return next.status === 'attention' ? 'attention' : null
}
