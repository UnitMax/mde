const WEB_PROTOCOLS = new Set(['http:', 'https:'])
const VSCODE_REMOTE_HOST = 'vscode-remote'

function parseUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null

  try {
    return new URL(value)
  } catch {
    return null
  }
}

/** Returns a normalized web URL only when it is safe to hand to the OS browser. */
export function safeExternalWebUrl(value: unknown): string | null {
  const url = parseUrl(value)
  if (!url || !WEB_PROTOCOLS.has(url.protocol)) return null
  return url.toString()
}

/** Returns a VS Code Remote URI only for MDE's registered remote authority. */
export function safeVsCodeRemoteUrl(value: unknown): string | null {
  const url = parseUrl(value)
  if (
    !url ||
    url.protocol !== 'vscode:' ||
    url.hostname !== VSCODE_REMOTE_HOST ||
    url.username ||
    url.password ||
    url.port
  ) {
    return null
  }
  return url.toString()
}

/** Opens only an allowed web URL while always denying the in-app window. */
export function handleWindowOpen(
  value: unknown,
  openExternal: (url: string) => void
): { action: 'deny' } {
  const url = safeExternalWebUrl(value)
  if (url) openExternal(url)
  return { action: 'deny' }
}
