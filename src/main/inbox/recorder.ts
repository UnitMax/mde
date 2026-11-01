import type {
  InboxThread,
  OpenCodeTuiStatus,
  OpenCodeTuiThreadSnapshot,
  OpenCodeTuiThreadsUpdate,
  Session
} from '@shared/types'
import type { InboxStore } from './store'

export const UNTITLED_THREAD = 'Untitled session'

export interface InboxRecorderDependencies {
  now(): number
  /** The MDE session whose transport (native or WSL distro) reads the branch. */
  lookupSession(sessionId: string): Promise<Session | null>
  /** Branch of `directory`, or null outside a repository or on a detached HEAD. Throws on failure. */
  readBranch(session: Session, directory: string): Promise<string | null>
  onChanged(thread: InboxThread): void
}

/** Statuses that count as the agent doing something the user should look at. */
export function isInboxActivity(status: OpenCodeTuiStatus): boolean {
  return status === 'completed' || status === 'attention' || status === 'error'
}

export function isInboxThreadUnread(thread: InboxThread): boolean {
  return thread.lastActivityAt > thread.readAt
}

function sameModel(a: InboxThread['model'], b: InboxThread['model']): boolean {
  return a?.id === b?.id && a?.providerId === b?.providerId && a?.variant === b?.variant
}

function sameThread(a: InboxThread, b: InboxThread): boolean {
  return a.title === b.title &&
    a.directory === b.directory &&
    JSON.stringify(a.target) === JSON.stringify(b.target) &&
    a.mdeSessionId === b.mdeSessionId &&
    a.branch === b.branch &&
    sameModel(a.model, b.model) &&
    a.status === b.status &&
    a.attentionReason === b.attentionReason &&
    a.lastActivityAt === b.lastActivityAt &&
    a.readAt === b.readAt &&
    a.archived === b.archived
}

/**
 * Applies the status plugin's thread reports to the inbox, like mail:
 * finishing, failing, or asking for input moves a thread to the top, marks it
 * unread, and brings it back from the archive. Starting work only updates the
 * status, so a busy thread does not keep jumping. A thread that has only been
 * looked at, never run, is not recorded.
 */
export class InboxRecorder {
  constructor(
    private readonly store: InboxStore,
    private readonly dependencies: InboxRecorderDependencies
  ) {}

  list(): InboxThread[] {
    return this.store.list()
  }

  apply(update: OpenCodeTuiThreadsUpdate): void {
    for (const snapshot of update.threads) {
      if (update.closed) this.close(snapshot.id)
      else this.record(update, snapshot)
    }
  }

  setRead(id: string, read: boolean): InboxThread | null {
    const thread = this.store.get(id)
    if (!thread) return null
    const readAt = read ? Math.max(this.dependencies.now(), thread.lastActivityAt) : 0
    return this.save(thread, { ...thread, readAt })
  }

  setArchived(id: string, archived: boolean): InboxThread | null {
    const thread = this.store.get(id)
    if (!thread) return null
    return this.save(thread, { ...thread, archived })
  }

  /** Forgets MDE's record only; a later report of new activity records it again. */
  remove(id: string): void {
    this.store.remove(id)
  }

  private close(id: string): void {
    const thread = this.store.get(id)
    if (thread?.status === 'working') this.save(thread, { ...thread, status: 'idle' })
  }

  private record(update: OpenCodeTuiThreadsUpdate, snapshot: OpenCodeTuiThreadSnapshot): void {
    const now = this.dependencies.now()
    const existing = this.store.get(snapshot.id)
    const reported = {
      directory: snapshot.directory,
      target: update.target,
      mdeSessionId: update.sessionId,
      status: snapshot.status,
      ...(snapshot.attentionReason ? { attentionReason: snapshot.attentionReason } : {})
    }

    if (!existing) {
      if (snapshot.status === 'idle') return
      const created: InboxThread = {
        id: snapshot.id,
        title: snapshot.title ?? UNTITLED_THREAD,
        ...reported,
        branch: null,
        ...(snapshot.model ? { model: snapshot.model } : {}),
        createdAt: now,
        lastActivityAt: now,
        // A thread first seen already finished arrives unread; one first seen working does not.
        readAt: isInboxActivity(snapshot.status) ? 0 : now,
        archived: false
      }
      this.store.put(created)
      this.dependencies.onChanged(created)
      this.refreshBranch(created)
      return
    }

    const changedStatus = existing.status !== snapshot.status ||
      existing.attentionReason !== snapshot.attentionReason
    const activity = changedStatus && isInboxActivity(snapshot.status)
    const { attentionReason: _previousReason, ...rest } = existing
    const next: InboxThread = {
      ...rest,
      ...reported,
      title: snapshot.title ?? existing.title,
      ...(snapshot.model ?? existing.model ? { model: snapshot.model ?? existing.model } : {}),
      ...(activity ? { lastActivityAt: now, archived: false } : {})
    }
    const saved = this.save(existing, next)
    if (saved && (activity || existing.directory !== next.directory)) this.refreshBranch(saved)
  }

  private save(previous: InboxThread, next: InboxThread): InboxThread {
    if (sameThread(previous, next)) return previous
    this.store.put(next)
    this.dependencies.onChanged(next)
    return next
  }

  private refreshBranch(thread: InboxThread): void {
    if (!thread.mdeSessionId) return
    const { id, directory, mdeSessionId } = thread
    void (async () => {
      const session = await this.dependencies.lookupSession(mdeSessionId)
      if (!session) return
      const branch = await this.dependencies.readBranch(session, directory)
      const current = this.store.get(id)
      // The thread may have moved or been deleted while Git was running.
      if (!current || current.directory !== directory) return
      this.save(current, { ...current, branch })
    })().catch(() => {})
  }
}
