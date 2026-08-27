/**
 * Electron wraps anything a main-process handler throws as
 * `Error invoking remote method '<channel>': Error: <message>`. That prefix is
 * noise to the person reading a settings panel, so strip it and show only what
 * the handler actually said.
 */
const IPC_PREFIX = /^Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?/

export function ipcErrorMessage(reason: unknown, fallback: string): string {
  const raw = reason instanceof Error ? reason.message : String(reason)
  const message = raw.replace(IPC_PREFIX, '').trim()
  return message.length > 0 ? message : fallback
}
