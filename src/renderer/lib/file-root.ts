import type { FileRoot } from '@shared/ipc'

/** Preview state belongs to a particular terminal directory, or an Inbox folder. */
export function fileRootKey(root: FileRoot): string {
  return root.sessionId ?? `terminal:${JSON.stringify([root.terminalId, root.directory])}`
}

export function fileRootTerminalId(key: string): string | null {
  if (!key.startsWith('terminal:')) return null
  try {
    const root: unknown = JSON.parse(key.slice('terminal:'.length))
    return Array.isArray(root) && typeof root[0] === 'string' ? root[0] : null
  } catch {
    return null
  }
}
