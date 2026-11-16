import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import type { InboxThread, OpenCodeModelRef } from '@shared/types'
import {
  AUTOMATION_LIMIT,
  followingAutomationRun,
  isAutomationId,
  isAutomationSchedule,
  nextAutomationRun,
  normalizeAutomationSchedule,
  sameAutomationSchedule,
  type AutomationSaveRequest,
  type InboxAutomation,
} from '@shared/automations'
import { isThreadPermissionMode } from '@shared/permission-modes'
import { PROMPT_CONTROL_CHARACTERS, PROMPT_TEXT_LIMIT } from '@shared/prompt-text'
import { writeJsonAtomic } from '../store/atomic-json'
import { isChatAgentId, isInboxFolderId, isInboxThreadId } from './store'

export const AUTOMATIONS_FILE = 'inbox-automations.json'
/**
 * The longest the timer waits before looking again. Timers do not count time the computer slept, and the clock
 * can be changed, so a long wait could run an automation far too late; looking each minute bounds that.
 */
export const AUTOMATION_CHECK_MS = 60_000
/** How long after MDE starts the first look is taken, so that the window and OpenCode are there for what is due. */
export const AUTOMATION_START_DELAY_MS = 5_000
const ERROR_LIMIT = 500
const TEXT_LIMIT = 512

export interface InboxAutomationsDependencies {
  now(): number
  /** Starts the thread of one run. Rejects when nothing was started. */
  run(automation: InboxAutomation): Promise<InboxThread>
  folderExists(folderId: string): boolean
  /** Whether a thread is still at work (working, or waiting for an answer). */
  busy(threadId: string): boolean
  /** Whether a thread is still in the Inbox. */
  threadExists(threadId: string): boolean
  onChanged(automations: InboxAutomation[]): void
  /** Defaults to the global timers; tests pass fakes. */
  setTimer?(callback: () => void, ms: number): unknown
  clearTimer?(timer: unknown): void
}

interface Stored {
  version: 1
  automations: InboxAutomation[]
}

function shortText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= TEXT_LIMIT && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
}

function promptText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= PROMPT_TEXT_LIMIT && !PROMPT_CONTROL_CHARACTERS.test(value)
}

function modelRef(value: unknown): OpenCodeModelRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { id, providerId, variant } = value as Record<string, unknown>
  if (!shortText(id) || !shortText(providerId)) return null
  if (variant !== undefined && !shortText(variant)) return null
  return { id, providerId, ...(variant !== undefined ? { variant } : {}) }
}

function moment(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** What is run, checked the same whether it comes from the window or from the file. Null when it cannot be run. */
function runnable(record: Record<string, unknown>): Pick<InboxAutomation, 'folderId' | 'text' | 'agent' | 'model' | 'mode' | 'permissionMode' | 'worktree' | 'schedule'> | null {
  const model = modelRef(record.model)
  if (!isInboxFolderId(record.folderId) || !promptText(record.text) || !isChatAgentId(record.agent) || !model) return null
  if (!isAutomationSchedule(record.schedule)) return null
  const worktree = record.worktree as { base?: unknown } | undefined
  if (worktree !== undefined && (!worktree || typeof worktree !== 'object' || !shortText(worktree.base))) return null
  const permissionMode = isThreadPermissionMode(record.permissionMode) && record.permissionMode !== 'default' ? record.permissionMode : undefined
  return {
    folderId: record.folderId,
    text: record.text,
    agent: record.agent,
    model,
    ...(record.mode === 'terminal' ? { mode: 'terminal' as const } : {}),
    ...(permissionMode ? { permissionMode } : {}),
    ...(worktree ? { worktree: { base: worktree.base as string } } : {}),
    schedule: normalizeAutomationSchedule(record.schedule),
  }
}

function stored(value: unknown): InboxAutomation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const base = runnable(record)
  if (!base || !isAutomationId(record.id) || !moment(record.createdAt) || !moment(record.nextRunAt)) return null
  return {
    id: record.id,
    ...base,
    enabled: record.enabled !== false,
    createdAt: record.createdAt,
    nextRunAt: record.nextRunAt,
    ...(moment(record.lastRunAt) ? { lastRunAt: record.lastRunAt } : {}),
    ...(isInboxThreadId(record.lastThreadId) ? { lastThreadId: record.lastThreadId } : {}),
    ...(typeof record.lastError === 'string' && record.lastError ? { lastError: record.lastError.slice(0, ERROR_LIMIT) } : {}),
    ...(moment(record.skippedAt) ? { skippedAt: record.skippedAt } : {}),
    runs: typeof record.runs === 'number' && Number.isInteger(record.runs) && record.runs >= 0 ? record.runs : 0,
  }
}

/** What a file holds, with anything malformed left out. */
export function parseAutomations(raw: string): InboxAutomation[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const list = (parsed as Partial<Stored> | null)?.automations
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const result: InboxAutomation[] = []
  for (const item of list) {
    const automation = stored(item)
    if (!automation || seen.has(automation.id)) continue
    seen.add(automation.id)
    result.push(automation)
  }
  return result.slice(0, AUTOMATION_LIMIT)
}

/**
 * The automations of the Inbox: prompts that start a new thread on a schedule. They are kept in one file, and a
 * timer in the main process runs what is due, so they run with the window in the mini mode or behind others too.
 *
 * A run that was due while MDE was closed, or while the computer slept, is made up once when MDE is back: the
 * time of the next run is moved past now BEFORE the thread is started and saved with it, so however many runs
 * were missed there is one, and a crash in the middle of a run does not repeat it at the next start either.
 */
export class InboxAutomations {
  private automations: InboxAutomation[] = []
  private timer: unknown = null
  private started = false
  private readonly running = new Set<string>()
  private writing: Promise<void> = Promise.resolve()
  private failing = false

  constructor(
    private readonly file: string,
    private readonly dependencies: InboxAutomationsDependencies,
  ) {}

  async load(): Promise<void> {
    let raw = ''
    try {
      raw = await fs.readFile(this.file, 'utf8')
    } catch {
      // No file yet, or one that cannot be read: start with none.
    }
    this.automations = raw ? parseAutomations(raw) : []
  }

  list(): InboxAutomation[] {
    // The pointer to the last thread is only good while that thread is in the Inbox.
    return this.automations.map((automation) => {
      if (!automation.lastThreadId || this.dependencies.threadExists(automation.lastThreadId)) return automation
      const { lastThreadId: _gone, ...rest } = automation
      return rest
    })
  }

  /** Starts running what is due: a first look shortly after the start, then on time. */
  start(): void {
    this.started = true
    this.wait(AUTOMATION_START_DELAY_MS)
  }

  /** Stops the timer, on quit. Runs that are under way finish on their own. */
  dispose(): void {
    this.started = false
    this.clearTimer()
  }

  /** Resolves once everything queued has been written (or has failed to be). */
  flush(): Promise<void> {
    return this.writing
  }

  /** Makes an automation, or changes one. A changed schedule is counted from now; a paused one stays paused. */
  save(request: AutomationSaveRequest): InboxAutomation {
    const base = runnable(request as unknown as Record<string, unknown>)
    if (!base) throw new Error('The automation needs a project, a message, an agent, a model and a schedule.')
    if (!this.dependencies.folderExists(base.folderId)) throw new Error('That project is no longer in the Inbox.')
    const now = this.dependencies.now()
    let saved: InboxAutomation
    if (request.id !== undefined) {
      const existing = this.automations.find((item) => item.id === request.id)
      if (!existing) throw new Error('That automation no longer exists.')
      const rescheduled = !sameAutomationSchedule(existing.schedule, base.schedule)
      const { mode: _mode, permissionMode: _permission, worktree: _worktree, ...kept } = existing
      saved = { ...kept, ...base, ...(rescheduled ? { nextRunAt: nextAutomationRun(base.schedule, now) } : {}) }
      this.automations = this.automations.map((item) => (item.id === saved.id ? saved : item))
    } else {
      if (this.automations.length >= AUTOMATION_LIMIT) throw new Error(`MDE keeps at most ${AUTOMATION_LIMIT} automations. Delete one first.`)
      saved = { id: `aut_${randomUUID()}`, ...base, enabled: true, createdAt: now, nextRunAt: nextAutomationRun(base.schedule, now), runs: 0 }
      this.automations = [...this.automations, saved]
    }
    this.changed()
    return saved
  }

  remove(id: string): void {
    if (!this.automations.some((item) => item.id === id)) return
    this.automations = this.automations.filter((item) => item.id !== id)
    this.changed()
  }

  /** Pauses an automation, or turns it back on. Turned on, it waits for its next time: what it missed while paused is not made up. */
  setEnabled(id: string, enabled: boolean): InboxAutomation | null {
    const existing = this.automations.find((item) => item.id === id)
    if (!existing) return null
    if (existing.enabled === enabled) return existing
    if (enabled && !this.dependencies.folderExists(existing.folderId)) throw new Error('Its project is no longer in the Inbox.')
    const { lastError: _error, ...rest } = existing
    const saved: InboxAutomation = enabled
      ? { ...rest, enabled, nextRunAt: nextAutomationRun(existing.schedule, this.dependencies.now()) }
      : { ...existing, enabled }
    this.automations = this.automations.map((item) => (item.id === id ? saved : item))
    this.changed()
    return saved
  }

  /** Runs an automation now, whether or not it is paused, and leaves its schedule as it is. */
  async runNow(id: string): Promise<InboxAutomation | null> {
    const existing = this.automations.find((item) => item.id === id)
    if (!existing) return null
    if (this.running.has(id)) throw new Error('This automation is starting a thread right now.')
    await this.execute(existing)
    return this.automations.find((item) => item.id === id) ?? null
  }

  /**
   * Runs what is due and waits for the next. Called by the timer, and whenever the clock may have jumped
   * (the computer woke up).
   */
  check(): void {
    if (!this.started) return
    this.clearTimer()
    const now = this.dependencies.now()
    let dirty = false
    const due: InboxAutomation[] = []
    this.automations = this.automations.map((automation) => {
      if (!automation.enabled) return automation
      if (automation.nextRunAt > now) {
        // A clock that was set back would leave the run further away than the schedule ever puts it.
        const latest = nextAutomationRun(automation.schedule, now)
        if (automation.nextRunAt <= latest) return automation
        dirty = true
        return { ...automation, nextRunAt: latest }
      }
      dirty = true
      const moved = { ...automation, nextRunAt: followingAutomationRun(automation.schedule, automation.nextRunAt, now) }
      if (this.running.has(automation.id)) return moved
      // The run before it is still at work: starting another would pile them up, so this one is left out.
      if (automation.lastThreadId && this.dependencies.busy(automation.lastThreadId)) return { ...moved, skippedAt: now }
      due.push(moved)
      return moved
    })
    // Saved before anything starts, so that a run is never made twice.
    if (dirty) this.changed()
    const written = this.writing
    for (const automation of due) void written.then(() => this.execute(automation))
    this.wait()
  }

  private async execute(automation: InboxAutomation): Promise<void> {
    const { id } = automation
    this.running.add(id)
    let patch: Partial<InboxAutomation>
    let pause = false
    try {
      if (!this.dependencies.folderExists(automation.folderId)) {
        pause = true
        throw new Error('Its project is no longer in the Inbox, so it was paused.')
      }
      const thread = await this.dependencies.run(automation)
      patch = { lastThreadId: thread.id, lastError: thread.sendError }
    } catch (error) {
      patch = { lastError: (error instanceof Error ? error.message : String(error)).slice(0, ERROR_LIMIT) || 'The thread could not be started.' }
    } finally {
      this.running.delete(id)
    }
    const current = this.automations.find((item) => item.id === id)
    // Deleted while its thread was starting.
    if (!current) return
    const { lastError: _error, skippedAt: _skipped, ...rest } = current
    const saved: InboxAutomation = {
      ...rest,
      ...(pause ? { enabled: false } : {}),
      lastRunAt: this.dependencies.now(),
      runs: current.runs + (patch.lastThreadId ? 1 : 0),
      ...(patch.lastThreadId ? { lastThreadId: patch.lastThreadId } : {}),
      ...(patch.lastError ? { lastError: patch.lastError } : {}),
    }
    this.automations = this.automations.map((item) => (item.id === id ? saved : item))
    this.changed()
  }

  private changed(): void {
    this.write()
    this.dependencies.onChanged(this.list())
    if (this.started) this.wait()
  }

  private wait(delay?: number): void {
    this.clearTimer()
    if (!this.started) return
    let ms = delay
    if (ms === undefined) {
      const now = this.dependencies.now()
      const next = Math.min(...this.automations.filter((item) => item.enabled).map((item) => item.nextRunAt))
      // With nothing to run there is nothing to wait for; saving or turning one on starts the wait again.
      if (next === Infinity) return
      ms = Math.max(0, Math.min(next - now, AUTOMATION_CHECK_MS))
    }
    const setTimer = this.dependencies.setTimer ?? ((callback: () => void, wait: number) => {
      const timer = setTimeout(callback, wait)
      timer.unref?.()
      return timer
    })
    this.timer = setTimer(() => {
      this.timer = null
      this.check()
    }, ms)
  }

  private clearTimer(): void {
    if (this.timer === null) return
    const clearTimer = this.dependencies.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>))
    clearTimer(this.timer)
    this.timer = null
  }

  /** Queues a write of what is held now. Never rejects. */
  private write(): void {
    const automations = this.automations
    this.writing = this.writing.then(async () => {
      try {
        await writeJsonAtomic(this.file, { version: 1, automations } satisfies Stored)
        this.failing = false
      } catch (error) {
        // Once, and without the path: it names the user's profile folder.
        if (!this.failing) console.warn(`[inbox] Could not save the automations (${(error as NodeJS.ErrnoException).code ?? 'error'}); they are kept in memory.`)
        this.failing = true
      }
    })
  }
}
