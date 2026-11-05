import type { FileRoot } from './ipc'

/** Reject mixed roots so a terminal request cannot fall back to a saved session. */
export function isFileRoot(value: unknown): value is FileRoot {
  if (!value || typeof value !== 'object') return false
  const root = value as Record<string, unknown>
  if (typeof root.sessionId === 'string' && root.sessionId.length > 0) {
    return root.terminalId === undefined && root.directory === undefined
  }
  return root.sessionId === undefined &&
    typeof root.terminalId === 'string' && root.terminalId.length > 0 &&
    typeof root.directory === 'string' && root.directory.length > 0
}
