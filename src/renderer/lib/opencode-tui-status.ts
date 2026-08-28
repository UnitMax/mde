import type { OpenCodeTuiAttentionReason, OpenCodeTuiStatus } from '@shared/types'

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

export function openCodeStatusShortLabel(status: OpenCodeTuiStatus): string {
  if (status === 'working') return 'working'
  if (status === 'attention') return 'needs input'
  if (status === 'completed') return 'done'
  if (status === 'error') return 'failed'
  return 'idle'
}
