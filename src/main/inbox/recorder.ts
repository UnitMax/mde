import type {
  InboxFolder,
  InboxThread,
  InboxThreadMode,
  InboxWorktree,
  OpenCodeModelRef,
  InboxAttentionReason,
  InboxThreadStatus,
  Session
} from '@shared/types'
import { targetSession } from '../opencode/service/discovery'
import type { ServiceEvent } from '../opencode/service/events'
import { serviceEventSessionId } from '../opencode/service/events'
import { parseModelRef } from '../opencode/service/parse'
import type { InboxStore } from './store'

export const UNTITLED_THREAD = 'Untitled session'
/** The furthest ahead a thread can be snoozed. */
export const INBOX_SNOOZE_MAX_MS = 366 * 24 * 60 * 60 * 1000
/**
 * The longest the wake timer waits before looking again. Timers do not count time the computer slept, and the
 * clock can be changed, so a long wait could wake a thread far too late; looking each minute bounds that.
 */
export const INBOX_SNOOZE_CHECK_MS = 60_000

export interface InboxRecorderDependencies {
  now(): number
  /** Branch of `directory`, or null outside a repository or on a detached HEAD. Throws on failure. */
  readBranch(session: Session, directory: string): Promise<string | null>
  onChanged(thread: InboxThread): void
  /** Defaults to the global timers; tests pass fakes. */
  setTimer?(callback: () => void, ms: number): unknown
  clearTimer?(timer: unknown): void
}

/** Statuses that count as the agent doing something the user should look at. */
export function isInboxActivity(status: InboxThreadStatus): boolean {
  return status === 'completed' || status === 'attention' || status === 'error'
}

export function isInboxThreadUnread(thread: InboxThread): boolean {
  return thread.lastActivityAt > thread.readAt
}

function isBusy(status: InboxThreadStatus): boolean {
  return status === 'working' || status === 'attention'
}

function sameModel(a: InboxThread['model'], b: InboxThread['model']): boolean {
  return a?.id === b?.id && a?.providerId === b?.providerId && a?.variant === b?.variant
}

interface ThreadReport {
  status?: InboxThreadStatus
  attentionReason?: InboxAttentionReason
  title?: string
  model?: OpenCodeModelRef
}

function threadTitle(value: unknown): string | null {
  return typeof value === 'string' && value.trim() && value.length <= 512 && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
    ? value.trim()
    : null
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
      const title = threadTitle(event.data.title)
      return title ? { title } : null
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
    a.customTitle === b.customTitle &&
    a.directory === b.directory &&
    JSON.stringify(a.target) === JSON.stringify(b.target) &&
    a.branch === b.branch &&
    sameModel(a.model, b.model) &&
    a.status === b.status &&
    a.attentionReason === b.attentionReason &&
    a.lastActivityAt === b.lastActivityAt &&
    a.workingSince === b.workingSince &&
    a.readAt === b.readAt &&
    a.archived === b.archived &&
    Boolean(a.pinned) === Boolean(b.pinned) &&
    a.snoozedUntil === b.snoozedUntil &&
    Boolean(a.woke) === Boolean(b.woke) &&
    a.folderId === b.folderId
}

/**
 * MDE's record of the threads started in the Inbox, kept like mail: finishing,
 * failing, or asking for input moves a thread to the top, marks it unread, and
 * brings it back from the archive. Starting work only updates the status, so a
 * busy thread does not keep jumping.
 */
export class InboxRecorder {
  private wakeTimer: unknown = null

  constructor(
    private readonly store: InboxStore,
    private readonly dependencies: InboxRecorderDependencies
  ) {}

  /**
   * Wakes the threads whose snooze ran out, including while MDE was closed or the computer slept, and waits
   * for the next one. Called once the store is loaded, and again whenever the clock may have jumped (resume).
   */
  wakeSnoozed(): void {
    this.clearWakeTimer()
    const now = this.dependencies.now()
    let next = Infinity
    for (const thread of this.store.list()) {
      if (thread.snoozedUntil === undefined) continue
      if (thread.snoozedUntil <= now) this.wake(thread, now)
      else next = Math.min(next, thread.snoozedUntil)
    }
    if (next === Infinity) return
    const delay = Math.max(0, Math.min(next - now, INBOX_SNOOZE_CHECK_MS))
    const setTimer = this.dependencies.setTimer ?? ((callback: () => void, ms: number) => {
      const timer = setTimeout(callback, ms)
      timer.unref?.()
      return timer
    })
    this.wakeTimer = setTimer(() => {
      this.wakeTimer = null
      this.wakeSnoozed()
    }, delay)
  }

  /** Stops the wake timer, on quit. */
  dispose(): void {
    this.clearWakeTimer()
  }

  /**
   * Snoozes a thread until `until`, or brings it back now with null. A snoozed thread leaves the list (and the
   * parked threads) and comes back unread, as "Woke up". Bringing it back by hand marks nothing.
   */
  setSnoozed(id: string, until: number | null): InboxThread | null {
    const thread = this.store.get(id)
    if (!thread) return null
    const now = this.dependencies.now()
    if (until !== null && (!Number.isFinite(until) || until <= now || until - now > INBOX_SNOOZE_MAX_MS)) {
      throw new Error('Choose a time in the future, within a year.')
    }
    const { snoozedUntil: _until, woke: _woke, ...rest } = thread
    const saved = this.save(thread, until === null ? rest : { ...rest, archived: false, snoozedUntil: until })
    this.wakeSnoozed()
    return saved
  }

  private wake(thread: InboxThread, now: number): void {
    const { snoozedUntil: _until, ...rest } = thread
    // Back at the top and unread, like new activity; `readAt` can be ahead of the clock after it was changed.
    this.save(thread, { ...rest, woke: true, lastActivityAt: Math.max(now, thread.readAt + 1) })
  }

  private clearWakeTimer(): void {
    if (this.wakeTimer === null) return
    const clearTimer = this.dependencies.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>))
    clearTimer(this.wakeTimer)
    this.wakeTimer = null
  }

  list(): InboxThread[] {
    return this.store.list()
  }

  /** Reconciles service metadata without treating a rename as conversation activity. */
  updateTitle(id: string, value: string): void {
    const thread = this.store.get(id)
    const title = threadTitle(value)
    if (thread && title) this.transition(thread, { title })
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
    // Parking a snoozed thread ends the snooze: a parked thread stays parked until it is moved back.
    const { snoozedUntil: _until, ...rest } = thread
    return this.save(thread, archived ? { ...rest, archived } : { ...thread, archived })
  }

  setCustomTitle(id: string, value: string | null): InboxThread | null {
    const customTitle = value === null ? null : threadTitle(value)
    if (value !== null && !customTitle) throw new Error('Enter a name of up to 512 characters without control characters.')
    const thread = this.store.get(id)
    if (!thread) return null
    const { customTitle: _previous, ...rest } = thread
    return this.save(thread, { ...rest, ...(customTitle ? { customTitle } : {}) })
  }

  setPinned(id: string, pinned: boolean): InboxThread | null {
    const thread = this.store.get(id)
    if (!thread) return null
    return this.save(thread, { ...thread, pinned })
  }

  /** Forgets MDE's record only; later events for the removed thread are ignored. */
  remove(id: string): void {
    this.store.remove(id)
  }

  /**
   * Records a thread the Inbox just started; it is working and already read. It runs in the
   * folder's directory unless it was given a worktree of its own, whose directory is then used.
   */
  recordChatThread(input: {
    mode?: InboxThreadMode
    id: string
    title?: string | null
    folder: InboxFolder
    model: OpenCodeModelRef
    directory?: string
    worktree?: InboxWorktree
    spawnedBy?: InboxThread['spawnedBy']
  }): InboxThread {
    const now = this.dependencies.now()
    const existing = this.store.get(input.id)
    if (existing) return existing
    const created: InboxThread = {
      ...(input.mode === 'terminal' ? { mode: input.mode } : {}),
      id: input.id,
      title: input.title?.trim() || UNTITLED_THREAD,
      directory: input.directory ?? input.folder.directory,
      target: input.folder.target,
      branch: null,
      model: input.model,
      status: 'working',
      workingSince: now,
      createdAt: now,
      lastActivityAt: now,
      readAt: now,
      archived: false,
      folderId: input.folder.id,
      ...(input.spawnedBy ? { spawnedBy: input.spawnedBy } : {}),
      ...(input.worktree ? { worktree: input.worktree } : {})
    }
    this.insert(created)
    return created
  }

  /**
   * Records a thread forked from another: idle until it is given something to do, already read, and
   * in the source's folder, target and directory, which stay valid if the folder has been removed.
   */
  recordForkedThread(input: { id: string; title?: string | null; source: InboxThread; model?: OpenCodeModelRef }): InboxThread {
    const now = this.dependencies.now()
    const existing = this.store.get(input.id)
    if (existing) return existing
    const { source } = input
    const model = input.model ?? source.model
    const created: InboxThread = {
      id: input.id,
      title: input.title?.trim() || source.title,
      directory: source.directory,
      target: source.target,
      branch: source.branch,
      ...(model ? { model } : {}),
      status: 'idle',
      createdAt: now,
      lastActivityAt: now,
      readAt: now,
      archived: false,
      folderId: source.folderId,
      forkedFrom: source.id,
      ...(source.mode === 'terminal' ? { mode: source.mode } : {}),
      // A fork shares the source's directory, so it shares the worktree too.
      ...(source.worktree ? { worktree: source.worktree } : {})
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
    // A run goes on while the agent waits for an answer, so only a thread that was idle starts the clock.
    const busy = isBusy(status)
    const workingSince = busy ? (isBusy(existing.status) ? existing.workingSince ?? now : now) : undefined
    // New activity brings a snoozed thread back early, like a reply to a snoozed mail, and anything that happens
    // in a thread that woke up replaces "Woke up".
    const { attentionReason: _previousReason, workingSince: _previousSince, snoozedUntil, woke, ...rest } = existing
    const next: InboxThread = {
      ...rest,
      status,
      ...(status === 'attention' && attentionReason ? { attentionReason } : {}),
      ...(workingSince !== undefined ? { workingSince } : {}),
      title: report.title ?? existing.title,
      ...(report.model ?? existing.model ? { model: report.model ?? existing.model } : {}),
      ...(snoozedUntil !== undefined && !activity ? { snoozedUntil } : {}),
      ...(woke && !changedStatus ? { woke } : {}),
      ...(activity ? { lastActivityAt: now, archived: false } : {})
    }
    const saved = this.save(existing, next)
    if (saved !== existing && activity) this.refreshBranch(saved)
    if (snoozedUntil !== undefined && next.snoozedUntil === undefined) this.wakeSnoozed()
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
      const branch = await this.dependencies.readBranch(targetSession(target), directory)
      const current = this.store.get(id)
      // The thread may have moved or been deleted while Git was running.
      if (!current || current.directory !== directory) return
      this.save(current, { ...current, branch })
    })().catch(() => {})
  }
}
