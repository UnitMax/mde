import type { InboxThread, Session } from './types'

const PREFIX = 'inbox-thread:'

/** One terminal per Inbox conversation; no renderer-provided path or command is needed. */
export function inboxThreadTerminalId(threadId: string): string {
  return `${PREFIX}${threadId}`
}

export function inboxTerminalThreadId(terminalId: string): string | null {
  return /^inbox-thread:ses_[A-Za-z0-9_-]{1,200}$/.test(terminalId)
    ? terminalId.slice(PREFIX.length)
    : null
}

export function inboxThreadTerminalSession(thread: InboxThread): Session {
  return {
    id: inboxThreadTerminalId(thread.id),
    name: thread.title,
    kind: thread.target.kind,
    ...(thread.target.kind === 'wsl' ? { distro: thread.target.distro } : {}),
    createdAt: new Date(thread.createdAt).toISOString(),
  }
}
