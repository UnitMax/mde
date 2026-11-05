import type { OpenCodeTuiAttentionReason, OpenCodeTuiStatus } from '@shared/types'

export const OPENCODE_STATUS_ICON_SLOT_CLASS = 'flex h-2.5 w-2.5 shrink-0 items-center justify-center'

export function openCodeStatusIconLayout(status: OpenCodeTuiStatus): {
  slotClassName: string
  glyphClassName: string
} {
  return {
    slotClassName: OPENCODE_STATUS_ICON_SLOT_CLASS,
    glyphClassName: status === 'working' || status === 'attention'
      ? 'h-2.5 w-2.5'
      : 'h-1.5 w-1.5'
  }
}

export function openCodeStatusLabel(
  status: OpenCodeTuiStatus,
  attentionReason?: OpenCodeTuiAttentionReason
): string {
  if (status === 'attention') {
    return attentionReason === 'question'
      ? 'OpenCode is asking a question'
      : 'OpenCode is waiting for permission'
  }
  if (status === 'working') return 'OpenCode is working'
  if (status === 'completed') return 'OpenCode finished'
  if (status === 'error') return 'OpenCode request failed'
  return 'OpenCode idle'
}
