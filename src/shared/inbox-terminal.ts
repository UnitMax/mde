import type { Distro, Session } from './types'

/**
 * The Inbox has one terminal, shared by every thread. It is not a workspace session: nothing stores it and
 * it is not listed under Projects. This ID stands in for the session ID in terminal requests, and the main
 * process resolves it to a shell in the user's home directory.
 */
export const INBOX_TERMINAL_SESSION_ID = 'inbox-terminal'

/** Where the Inbox terminal starts: the home directory, which `wsl.exe --cd` understands as `~`. */
export const INBOX_TERMINAL_WSL_DIRECTORY = '~'

/**
 * The Inbox terminal as a session: a Windows shell inside the default WSL distro, or a native shell
 * everywhere else. `nativeHome` is the home directory a native shell starts in; the renderer, which does not
 * know it, shows `~` and never sends the path anywhere.
 */
export function inboxTerminalSession(
  platform: string,
  distros: readonly Pick<Distro, 'name' | 'isDefault'>[],
  nativeHome: string
): Session | null {
  const base = { id: INBOX_TERMINAL_SESSION_ID, projectId: '', name: 'Terminal', createdAt: '' }
  if (platform !== 'win32') return { ...base, kind: 'native', path: nativeHome }
  const distro = distros.find((item) => item.isDefault) ?? distros[0]
  return distro ? { ...base, kind: 'wsl', distro: distro.name, path: INBOX_TERMINAL_WSL_DIRECTORY } : null
}
