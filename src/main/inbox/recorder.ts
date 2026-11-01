import type {
  InboxFolder,
  InboxThread,
  OpenCodeModelRef,
  OpenCodeTuiAttentionReason,
  OpenCodeTuiStatus,
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
    a.branch === b.branch &&
    sameModel(a.model, b.model) &&
    a.status === b.status &&
    a.attentionReason === b.attentionReason &&
    a.lastActivityAt === b.lastActivityAt &&
    a.readAt === b.readAt &&
    a.archived === b.archived &&
    a.folderId === b.folderId
}

/**
 * MDE's record of the threads started in the Inbox, kept like mail: finishing,
 * failing, or asking for input moves a thread to the top, marks it unread, and
 * brings it back from the archive. Starting work only updates the status, so a
 * busy thread does not keep jumping.
 */
export class InboxRecorder {
  constructor(
    private readonly store: InboxStore,
    private readonly dependencies: InboxRecorderDependencies
  ) {}

  list(): InboxThread[] {
    return this.store.list()
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

  /** Records a thread the Inbox just started; it is working and already read. */
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
   * Events never add threads: only starting one in the Inbox does.
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
      status,
      ...(status === 'attention' && attentionReason ? { attentionReason } : {}),
      title: report.title ?? existing.title,
      ...(report.model ?? existing.model ? { model: report.model ?? existing.model } : {}),
      ...(activity ? { lastActivityAt: now, archived: false } : {})
    }
    const saved = this.save(existing, next)
    if (saved !== existing && activity) this.refreshBranch(saved)
  }

  private save(previous: InboxThread, next: InboxThread): InboxThread {
    if (sameThread(previous, next)) return previous
    this.store.put(next)
    this.dependencies.onChanged(next)
    return next
  }

  private refreshBranch(thread: InboxThread): void {
    const { id, directory, target } = thread
    void (async () => {
      const branch = await this.dependencies.readBranch(targetSession(target, directory), directory)
      const current = this.store.get(id)
      // The thread may have moved or been deleted while Git was running.
      if (!current || current.directory !== directory) return
      this.save(current, { ...current, branch })
    })().catch(() => {})
  }
}
