import type { Distro, Session } from '@shared/types'
import { INBOX_TERMINAL_SESSION_ID, inboxTerminalSession } from '@shared/inbox-terminal'

interface Dependencies {
  /** The stored workspace session with this ID. */
  getSession: (id: string) => Promise<Session | null>
  listDistros: () => Promise<Distro[]>
  platform: string
  home: () => string
}

/**
 * Finds the session a terminal belongs to: a workspace session, or the Inbox's one global terminal. That
 * terminal is not stored anywhere, so it is built on demand. It is kept once it has been built, which spares
 * every later request a `wsl.exe` call, but a failed lookup (no distro yet) is tried again.
 *
 * Only requests that start or look after a terminal use this. File browsing, Git status and the like keep
 * asking for stored sessions, so the home directory never becomes something those can read.
 */
export function terminalSessionResolver(dependencies: Dependencies): (id: string) => Promise<Session | null> {
  let inbox: Promise<Session | null> | null = null
  const build = (): Promise<Session | null> => {
    if (!inbox) {
      const attempt = (async () => inboxTerminalSession(
        dependencies.platform,
        dependencies.platform === 'win32' ? await dependencies.listDistros() : [],
        dependencies.home()
      ))()
      inbox = attempt
      void attempt.then((session) => { if (!session && inbox === attempt) inbox = null }, () => { if (inbox === attempt) inbox = null })
    }
    return inbox
  }
  return (id) => id === INBOX_TERMINAL_SESSION_ID ? build() : dependencies.getSession(id)
}
