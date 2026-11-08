import type { Distro, Session } from './types'

/**
 * The Inbox has one terminal, shared by every thread. It is not a workspace session: nothing stores it and
 * it is not listed under Sessions. This ID stands in for the session ID in terminal requests, and the main
 * process resolves it to a shell in the user's home directory.
 */
export const INBOX_TERMINAL_SESSION_ID = 'inbox-terminal'

export interface InboxTerminalSettings {
  /** null follows the Windows default distribution. */
  distro: string | null
}

export interface InboxTerminalConfiguration {
  session: Session | null
  changed: boolean
}

/**
 * The Inbox terminal as a session: a Windows shell inside the chosen WSL distro, or a native shell
 * everywhere else. The PTY layer starts fresh shells in the target user’s home directory.
 */
export function inboxTerminalSession(
  platform: string,
  distros: readonly Pick<Distro, 'name' | 'isDefault'>[],
  preferredDistro: string | null = null,
): Session | null {
  const base = { id: INBOX_TERMINAL_SESSION_ID, name: 'Terminal', createdAt: '' }
  if (platform !== 'win32') return { ...base, kind: 'native' }
  const distro = preferredDistro === null
    ? distros.find((item) => item.isDefault) ?? distros[0]
    : distros.find((item) => item.name === preferredDistro)
  return distro ? { ...base, kind: 'wsl', distro: distro.name } : null
}
