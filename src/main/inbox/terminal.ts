import type { Distro, Session } from '@shared/types'
import { INBOX_TERMINAL_SESSION_ID, inboxTerminalSession } from '@shared/inbox-terminal'

interface Dependencies {
  /** The stored workspace session with this ID. */
  getSession: (id: string) => Promise<Session | null>
  listDistros: () => Promise<Distro[]>
  platform: string
}

/**
 * Finds the session a terminal belongs to: a workspace session, or the Inbox's one global terminal. That
 * terminal is not stored anywhere, so it is built on demand. It is kept once it has been built, which spares
 * every later request a `wsl.exe` call. Settings replace the cached session; a failed lookup is tried again.
 *
 * Only terminal requests use this lookup. Files and Git require a live terminal directory or an Inbox
 * folder, so a reserved terminal identity alone never grants access to a filesystem root.
 */
export function terminalSessionResolver(dependencies: Dependencies): ((id: string) => Promise<Session | null>) & { setInboxSession: (session: Session | null) => void } {
  let inbox: Promise<Session | null> | null = null
  const build = (): Promise<Session | null> => {
    if (!inbox) {
      const attempt = (async () => inboxTerminalSession(
        dependencies.platform,
        dependencies.platform === 'win32' ? await dependencies.listDistros() : [],
      ))()
      inbox = attempt
      void attempt.then((session) => { if (!session && inbox === attempt) inbox = null }, () => { if (inbox === attempt) inbox = null })
    }
    return inbox
  }
  return Object.assign(
    (id: string) => id === INBOX_TERMINAL_SESSION_ID ? build() : dependencies.getSession(id),
    { setInboxSession: (session: Session | null) => {
      inbox = session ? Promise.resolve(session) : null
    } },
  )
}
