import type {
  InboxFolder,
  InboxThread,
  OpenCodeModelRef,
  OpenCodeTuiAttentionReason,
  OpenCodeTuiStatus,
  OpenCodeTuiThreadSnapshot,
  OpenCodeTuiThreadsUpdate,
  Session
} from '@shared/types'
import { targetSession } from '../opencode/service/discovery'
import type { ServiceEvent } from '../opencode/service/events'
import { serviceEventSessionId } from '../opencode/service/events'
import { parseModelRef } from '../opencode/service/parse'
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

interface ThreadReport {
  status?: OpenCodeTuiStatus
  attentionReason?: OpenCodeTuiAttentionReason
  title?: string
  model?: OpenCodeModelRef
  directory?: string
  target?: InboxThread['target']
  mdeSessionId?: string
}

/** What a service event says about its thread, or null when it says nothing the inbox keeps. */
export function serviceEventReport(event: ServiceEvent): ThreadReport | null {
  switch (event.type) {
    case 'session.execution.started':
    case 'permission.replied':
    case 'form.replied':
    case 'form.cancelled':
      return { status: 'working' }
    case 'session.execution.succeeded':
      return { status: 'completed' }
    case 'session.execution.failed':
      return { status: 'error' }
    case 'session.execution.interrupted':
      return { status: 'idle' }
    case 'permission.asked':
      return { status: 'attention', attentionReason: 'permission' }
    case 'form.created':
      return { status: 'attention', attentionReason: 'question' }
    case 'session.renamed': {
      const title = event.data.title
      return typeof title === 'string' && title.trim() && title.length <= 512 && !/[\u0000-\u001f\u007f-\u009f]/.test(title)
        ? { title: title.trim() }
        : null
    }
    case 'session.model.selected':
    case 'session.step.started': {
      const model = parseModelRef(event.data.model)
      return model ? { model } : null
    }
    default:
      return null
  }
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
    a.archived === b.archived &&
    a.origin === b.origin &&
    a.folderId === b.folderId
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
    if (!existing) {
      if (snapshot.status === 'idle') return
      const created: InboxThread = {
        id: snapshot.id,
        title: snapshot.title ?? UNTITLED_THREAD,
        directory: snapshot.directory,
        target: update.target,
        mdeSessionId: update.sessionId,
        status: snapshot.status,
        ...(snapshot.attentionReason ? { attentionReason: snapshot.attentionReason } : {}),
        branch: null,
        ...(snapshot.model ? { model: snapshot.model } : {}),
        createdAt: now,
        lastActivityAt: now,
        // A thread first seen already finished arrives unread; one first seen working does not.
        readAt: isInboxActivity(snapshot.status) ? 0 : now,
        archived: false
      }
      this.insert(created)
      return
    }
    this.transition(existing, {
      status: snapshot.status,
      attentionReason: snapshot.attentionReason,
      title: snapshot.title,
      model: snapshot.model,
      directory: snapshot.directory,
      target: update.target,
      mdeSessionId: update.sessionId
    })
  }

  /** Records a thread the Inbox chat view just started; it is working and already read. */
  recordChatThread(input: { id: string; title?: string | null; folder: InboxFolder; model: OpenCodeModelRef }): InboxThread {
    const now = this.dependencies.now()
    const existing = this.store.get(input.id)
    if (existing) return existing
    const created: InboxThread = {
      id: input.id,
      title: input.title?.trim() || UNTITLED_THREAD,
      directory: input.folder.directory,
      target: input.folder.target,
      branch: null,
      model: input.model,
      status: 'working',
      createdAt: now,
      lastActivityAt: now,
      readAt: now,
      archived: false,
      origin: 'chat',
      folderId: input.folder.id
    }
    this.insert(created)
    return created
  }

  /** Sets a known thread's status, e.g. working after the user sent it a message. */
  markStatus(id: string, status: 'working' | 'idle'): void {
    const thread = this.store.get(id)
    if (thread) this.transition(thread, { status })
  }

  /**
   * Applies an OpenCode service event to a thread the inbox already knows.
   * Events never add threads: only MDE terminals and the chat view do.
   */
  applyServiceEvent(event: ServiceEvent): void {
    const id = serviceEventSessionId(event)
    if (!id) return
    const thread = this.store.get(id)
    if (!thread) return
    const report = serviceEventReport(event)
    if (!report) return
    // A reply only resumes a thread that was waiting for one.
    if ((event.type === 'permission.replied' || event.type.startsWith('form.')) &&
      report.status === 'working' && thread.status !== 'attention') return
    this.transition(thread, report)
  }

  private insert(created: InboxThread): void {
    this.store.put(created)
    this.dependencies.onChanged(created)
    this.refreshBranch(created)
  }

  private transition(existing: InboxThread, report: ThreadReport): void {
    const now = this.dependencies.now()
    const status = report.status ?? existing.status
    const attentionReason = report.status ? report.attentionReason : existing.attentionReason
    const changedStatus = existing.status !== status || existing.attentionReason !== attentionReason
    const activity = changedStatus && isInboxActivity(status)
    const { attentionReason: _previousReason, ...rest } = existing
    const next: InboxThread = {
      ...rest,
      ...(report.directory ? { directory: report.directory } : {}),
      ...(report.target ? { target: report.target } : {}),
      ...(report.mdeSessionId ? { mdeSessionId: report.mdeSessionId } : {}),
      status,
      ...(status === 'attention' && attentionReason ? { attentionReason } : {}),
      title: report.title ?? existing.title,
      ...(report.model ?? existing.model ? { model: report.model ?? existing.model } : {}),
      ...(activity ? { lastActivityAt: now, archived: false } : {})
    }
    const saved = this.save(existing, next)
    if (saved !== existing && (activity || existing.directory !== next.directory)) this.refreshBranch(saved)
  }

  private save(previous: InboxThread, next: InboxThread): InboxThread {
    if (sameThread(previous, next)) return previous
    this.store.put(next)
    this.dependencies.onChanged(next)
    return next
  }

  private refreshBranch(thread: InboxThread): void {
    const { id, directory, mdeSessionId, target } = thread
    void (async () => {
      // A chat thread has no MDE session; its target alone says how to run Git.
      const session = mdeSessionId
        ? await this.dependencies.lookupSession(mdeSessionId)
        : targetSession(target, directory)
      if (!session) return
      const branch = await this.dependencies.readBranch(session, directory)
      const current = this.store.get(id)
      // The thread may have moved or been deleted while Git was running.
      if (!current || current.directory !== directory) return
      this.save(current, { ...current, branch })
    })().catch(() => {})
  }
}
