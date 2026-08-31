import type { OpenCodeTuiInstanceStatus } from '@shared/types'

export type OpenCodeTuiReadRevisions = Readonly<Record<string, number>>

/**
 * Counts one notification per live OpenCode agent, rather than one per request.
 * Completed instances are notifications until their exact revision is viewed.
 */
export function countOpenCodeTuiNotifications(
  instances: readonly OpenCodeTuiInstanceStatus[],
  readRevisions: OpenCodeTuiReadRevisions
): number {
  return instances.reduce((count, instance) => {
    if (instance.status === 'attention') return count + 1
    if (instance.status === 'completed' && readRevisions[instance.terminalId] !== instance.revision) {
      return count + 1
    }
    return count
  }, 0)
}
