import { describe, expect, it, vi } from 'vitest'
import { InboxStore } from '../src/main/inbox/store'
import { InboxRecorder, isInboxThreadUnread } from '../src/main/inbox/recorder'
import { BACKGROUND_HOLD_GRACE_MS, BACKGROUND_HOLD_POLL_MS, BackgroundHold } from '../src/main/inbox/background-hold'

const folder = {
  id: 'fld_app', name: 'app', directory: '/home/me/app',
  target: { kind: 'wsl' as const, distro: 'Ubuntu-24.04' }, createdAt: 1, lastUsedAt: 1
}

interface Timer { at: number; run: () => void; cleared: boolean }

/** A thread that is working, the recorder behind it and a hold in front, with a job count the test sets. */
function setup() {
  let now = 1_000
  let jobs: number | Error = 0
  const timers: Timer[] = []
  const store = new InboxStore('/unused', { writeFile: async () => {}, writeDelayMs: 60_000 })
  const recorder = new InboxRecorder(store, { now: () => now, readBranch: async () => 'main', onChanged: () => {} })
  const countJobs = vi.fn(async () => {
    if (jobs instanceof Error) throw jobs
    return jobs
  })
  const hold = new BackgroundHold({
    thread: (id) => store.get(id),
    countJobs,
    apply: (event) => recorder.applyServiceEvent(event),
    setBackground: (id, count) => recorder.markBackground(id, count),
    setTimer: (run, ms) => {
      const timer = { at: now + ms, run, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (timer) => { (timer as Timer).cleared = true },
  })
  recorder.recordChatThread({ id: 'ses_one', title: 'Fix login', folder, model: { id: 'm', providerId: 'p' } })
  const emit = (type: string, data: Record<string, unknown> = {}) => hold.apply({ type, data: { sessionID: 'ses_one', ...data } })
  emit('session.execution.started')
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
  return {
    hold, countJobs, emit, settle,
    thread: () => store.get('ses_one')!,
    setJobs: (value: number | Error) => { jobs = value },
    /** Moves the clock on and runs the timers that came due. */
    advance: async (ms: number) => {
      now += ms
      for (const timer of [...timers]) {
        if (!timer.cleared && timer.at <= now) {
          timer.cleared = true
          timer.run()
        }
      }
      await settle()
    },
  }
}

describe('inbox background hold', () => {
  it('finishes a turn with no background work after one look at the job list', async () => {
    const { emit, settle, thread, countJobs, advance } = setup()
    await advance(10)
    emit('session.execution.succeeded')
    await settle()
    expect(countJobs).toHaveBeenCalledTimes(1)
    expect(thread().status).toBe('completed')
    expect(isInboxThreadUnread(thread())).toBe(true)
  })

  it('keeps a thread working, not unread, while a background subagent runs, through its report turn', async () => {
    const { emit, settle, thread, setJobs, advance } = setup()
    setJobs(1)
    emit('session.execution.succeeded')
    await settle()
    expect(thread()).toMatchObject({ status: 'working', backgroundTasks: 1 })
    expect(isInboxThreadUnread(thread())).toBe(false)

    // Still running at the next look.
    await advance(BACKGROUND_HOLD_POLL_MS)
    expect(thread()).toMatchObject({ status: 'working', backgroundTasks: 1 })

    // The subagent reports back: OpenCode starts the parent's next turn, which then ends with nothing left.
    setJobs(0)
    emit('experimental.job.updated')
    emit('session.execution.started')
    await settle()
    expect(thread().status).toBe('working')
    expect(thread().backgroundTasks).toBeUndefined()
    expect(isInboxThreadUnread(thread())).toBe(false)
    emit('session.execution.succeeded')
    await settle()
    expect(thread().status).toBe('completed')
    expect(isInboxThreadUnread(thread())).toBe(true)
  })

  it('finishes a short while after background work ends when no new turn follows', async () => {
    const { emit, settle, thread, setJobs, advance } = setup()
    setJobs(2)
    emit('session.execution.succeeded')
    await settle()
    expect(thread().backgroundTasks).toBe(2)
    setJobs(0)
    emit('experimental.job.updated')
    await settle()
    // The hint goes, but the thread waits a moment for a turn with the results.
    expect(thread().status).toBe('working')
    expect(thread().backgroundTasks).toBeUndefined()
    await advance(BACKGROUND_HOLD_GRACE_MS - 1)
    expect(thread().status).toBe('working')
    await advance(1)
    expect(thread().status).toBe('completed')
    expect(isInboxThreadUnread(thread())).toBe(true)
  })

  it('finishes as before when the job list cannot be read', async () => {
    const { emit, settle, thread, setJobs } = setup()
    setJobs(new Error('404'))
    emit('session.execution.succeeded')
    await settle()
    expect(thread().status).toBe('completed')
  })

  it('lets a failure or a stop through at once and drops what was held', async () => {
    const { emit, settle, thread, setJobs, advance, hold } = setup()
    setJobs(1)
    emit('session.execution.succeeded')
    await settle()
    emit('session.execution.failed')
    expect(thread().status).toBe('error')
    expect(thread().backgroundTasks).toBeUndefined()
    expect(hold.holding('ses_one')).toBe(false)
    // The held finish never comes later.
    setJobs(0)
    await advance(BACKGROUND_HOLD_POLL_MS + BACKGROUND_HOLD_GRACE_MS)
    expect(thread().status).toBe('error')
  })

  it('keeps holding across a question from the background work and its answer', async () => {
    const { emit, settle, thread, setJobs, advance } = setup()
    setJobs(1)
    emit('session.execution.succeeded')
    await settle()
    emit('permission.asked', { id: 'per_1' })
    expect(thread().status).toBe('attention')
    emit('permission.replied', { id: 'per_1' })
    expect(thread().status).toBe('working')
    await advance(BACKGROUND_HOLD_POLL_MS)
    expect(thread()).toMatchObject({ status: 'working', backgroundTasks: 1 })
  })

  it('does not hold a finish that came while the thread was not working', async () => {
    const { emit, settle, thread, countJobs } = setup()
    emit('session.execution.interrupted')
    countJobs.mockClear()
    emit('session.execution.succeeded')
    await settle()
    expect(countJobs).not.toHaveBeenCalled()
    expect(thread().status).toBe('completed')
  })
})
