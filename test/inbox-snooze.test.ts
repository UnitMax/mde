import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxThread } from '../src/shared/types'
import { InboxStore, normalizeInboxFile } from '../src/main/inbox/store'
import { INBOX_SNOOZE_CHECK_MS, InboxRecorder, isInboxThreadUnread } from '../src/main/inbox/recorder'
import {
  countUnreadInboxThreads,
  inboxSnoozeOptions,
  inboxSnoozeTime,
  inboxStatusChip,
  snoozedInboxThreads,
  visibleInboxThreads,
  workingInboxThreads,
} from '../src/renderer/lib/inbox'
import { taskbarIndicator } from '../src/renderer/lib/alerts'
import { inboxTerminalHighlightTone } from '../src/renderer/lib/inbox-terminal-highlight'

const folder = {
  id: 'fld_app', name: 'app', directory: '/home/me/app',
  target: { kind: 'native' as const }, createdAt: 1, lastUsedAt: 1
}
const model = { id: 'model-1', providerId: 'provider-1' }
const HOUR = 60 * 60 * 1000

afterEach(() => {
  vi.useRealTimers()
})

/** A recorder over a store whose file is kept in memory, so a restart can be played: a new store reads it back. */
function setup(start = 1_000_000) {
  let now = start
  let file = ''
  const dependencies = {
    readFile: async () => { if (!file) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return file },
    writeFile: async (_path: string, value: unknown) => { file = JSON.stringify(value) },
    writeDelayMs: 60_000,
  }
  const timers: Array<{ callback: () => void; ms: number; cleared: boolean }> = []
  const open = (store: InboxStore) => {
    const changed: InboxThread[] = []
    const recorder = new InboxRecorder(store, {
      now: () => now,
      readBranch: async () => null,
      onChanged: (thread) => changed.push(thread),
      setTimer: (callback, ms) => {
        const timer = { callback, ms, cleared: false }
        timers.push(timer)
        return timer
      },
      clearTimer: (timer) => { (timer as { cleared: boolean }).cleared = true },
    })
    return { store, recorder, changed }
  }
  const first = open(new InboxStore('/unused', dependencies))
  const thread = first.recorder.recordChatThread({ id: 'ses_one', title: 'Fix login', folder, model })
  first.recorder.applyServiceEvent({ type: 'session.execution.succeeded', data: { sessionID: thread.id } })
  first.recorder.setRead(thread.id, true)
  return {
    ...first,
    timers,
    pending: () => timers.filter((timer) => !timer.cleared),
    advance: (ms: number) => { now += ms },
    now: () => now,
    /** Saves, then starts over from the file, as MDE does when it is opened again. */
    restart: async () => {
      await first.store.flush()
      const store = new InboxStore('/unused', dependencies)
      await store.load()
      return open(store)
    },
  }
}

describe('inbox recorder: snooze', () => {
  it('takes a thread out until its time, then brings it back unread and "woke up", at the top', () => {
    const { recorder, store, changed, pending, advance, now } = setup()
    const until = now() + HOUR
    const snoozed = recorder.setSnoozed('ses_one', until)
    expect(snoozed).toMatchObject({ snoozedUntil: until, archived: false })
    expect(snoozed?.woke).toBeUndefined()
    // It waits at most a minute at a time, so a sleeping computer or a changed clock cannot make it very late.
    expect(pending().map((timer) => timer.ms)).toEqual([INBOX_SNOOZE_CHECK_MS])

    advance(HOUR - 1)
    recorder.wakeSnoozed()
    expect(store.get('ses_one')?.snoozedUntil).toBe(until)
    expect(pending().map((timer) => timer.ms)).toEqual([1])

    advance(1)
    changed.length = 0
    const timer = pending()[0]!
    timer.cleared = true
    timer.callback()
    const woke = store.get('ses_one')!
    expect(woke.snoozedUntil).toBeUndefined()
    expect(woke).toMatchObject({ woke: true, lastActivityAt: until, status: 'completed' })
    expect(isInboxThreadUnread(woke)).toBe(true)
    expect(changed).toEqual([woke])
    expect(pending()).toEqual([])
  })

  it('wakes a thread whose time passed while MDE was closed as soon as it opens again', async () => {
    const { recorder, advance, now, restart } = setup()
    recorder.setSnoozed('ses_one', now() + 5 * HOUR)
    recorder.dispose()
    advance(10 * HOUR)
    const reopened = await restart()
    expect(reopened.store.get('ses_one')?.snoozedUntil).toBeDefined()
    reopened.recorder.wakeSnoozed()
    expect(reopened.store.get('ses_one')).toMatchObject({ woke: true, lastActivityAt: now() })
    expect(isInboxThreadUnread(reopened.store.get('ses_one')!)).toBe(true)
  })

  it('keeps a snooze that has not run out across a restart', async () => {
    const { recorder, now, restart, pending } = setup()
    const until = now() + 5 * HOUR
    recorder.setSnoozed('ses_one', until)
    const reopened = await restart()
    reopened.recorder.wakeSnoozed()
    expect(reopened.store.get('ses_one')?.snoozedUntil).toBe(until)
    expect(pending().length).toBeGreaterThan(0)
  })

  it('stays unread when the clock was turned back after the thread was read', () => {
    const { recorder, store, advance, now } = setup()
    store.put({ ...store.get('ses_one')!, readAt: now() + 10 * HOUR })
    recorder.setSnoozed('ses_one', now() + HOUR)
    advance(HOUR)
    recorder.wakeSnoozed()
    expect(isInboxThreadUnread(store.get('ses_one')!)).toBe(true)
  })

  it('comes back early, without "woke up", when the agent does something', () => {
    const { recorder, store, pending, now } = setup()
    recorder.setSnoozed('ses_one', now() + HOUR)
    // Starting work is not news; finishing is.
    recorder.applyServiceEvent({ type: 'session.execution.started', data: { sessionID: 'ses_one' } })
    expect(store.get('ses_one')?.snoozedUntil).toBeDefined()
    recorder.applyServiceEvent({ type: 'session.execution.succeeded', data: { sessionID: 'ses_one' } })
    expect(store.get('ses_one')?.snoozedUntil).toBeUndefined()
    expect(store.get('ses_one')?.woke).toBeUndefined()
    expect(pending()).toEqual([])
  })

  it('stops saying "woke up" once anything happens in the thread, but not when it is read', () => {
    const { recorder, store, advance, now } = setup()
    recorder.setSnoozed('ses_one', now() + HOUR)
    advance(HOUR)
    recorder.wakeSnoozed()
    recorder.setRead('ses_one', true)
    expect(store.get('ses_one')?.woke).toBe(true)
    recorder.markStatus('ses_one', 'working')
    expect(store.get('ses_one')?.woke).toBeUndefined()
  })

  it('brings a thread back by hand without marking it, and parking ends a snooze', () => {
    const { recorder, store, now, pending } = setup()
    recorder.setSnoozed('ses_one', now() + HOUR)
    const back = recorder.setSnoozed('ses_one', null)
    expect(back?.snoozedUntil).toBeUndefined()
    expect(back?.woke).toBeUndefined()
    expect(isInboxThreadUnread(back!)).toBe(false)
    expect(pending()).toEqual([])

    recorder.setSnoozed('ses_one', now() + HOUR)
    expect(recorder.setArchived('ses_one', true)).toMatchObject({ archived: true })
    expect(store.get('ses_one')?.snoozedUntil).toBeUndefined()
    // Snoozing a parked thread moves it out of Parked.
    expect(recorder.setSnoozed('ses_one', now() + HOUR)).toMatchObject({ archived: false })
  })

  it('refuses a time that is not in the future or more than a year away', () => {
    const { recorder, now } = setup()
    expect(() => recorder.setSnoozed('ses_one', now())).toThrow('in the future')
    expect(() => recorder.setSnoozed('ses_one', now() + 400 * 24 * HOUR)).toThrow('within a year')
    expect(recorder.setSnoozed('ses_missing', now() + HOUR)).toBeNull()
  })
})

describe('inbox store: snooze fields', () => {
  const stored = {
    id: 'ses_one', title: 'One', directory: '/home/me/app', target: { kind: 'native' }, branch: null,
    status: 'completed', createdAt: 1, lastActivityAt: 2, readAt: 2, archived: false, folderId: 'fld_app',
  }

  it('keeps a wake time and the woke mark, and drops a bad one without losing the thread', () => {
    expect(normalizeInboxFile({ threads: [{ ...stored, snoozedUntil: 5, woke: true }] })[0]).toMatchObject({ snoozedUntil: 5, woke: true })
    const [bad] = normalizeInboxFile({ threads: [{ ...stored, snoozedUntil: 'soon', woke: 'yes' }] })
    expect(bad?.id).toBe('ses_one')
    expect(bad?.snoozedUntil).toBeUndefined()
    expect(bad?.woke).toBeUndefined()
    // A parked thread is not also snoozed.
    expect(normalizeInboxFile({ threads: [{ ...stored, archived: true, snoozedUntil: 5 }] })[0]?.snoozedUntil).toBeUndefined()
  })
})

function thread(overrides: Partial<InboxThread>): InboxThread {
  return {
    id: 'ses_a', title: 'A', directory: '/home/me/app', target: { kind: 'native' }, branch: null,
    status: 'completed', createdAt: 1, lastActivityAt: 10, readAt: 0, archived: false, folderId: 'fld_app',
    ...overrides,
  }
}

describe('snoozed threads in the sidebar', () => {
  it('leaves snoozed threads out of the list, Working, the unread count and the taskbar, and lists them soonest first', () => {
    const threads = [
      thread({ id: 'ses_a' }),
      thread({ id: 'ses_b', snoozedUntil: 500, pinned: true }),
      thread({ id: 'ses_c', snoozedUntil: 300, status: 'working' }),
    ]
    expect(visibleInboxThreads(threads, 'all', '').map((item) => item.id)).toEqual(['ses_a'])
    expect(visibleInboxThreads(threads, 'unread', '').map((item) => item.id)).toEqual(['ses_a'])
    expect(visibleInboxThreads(threads, 'archived', '')).toEqual([])
    expect(workingInboxThreads(threads)).toEqual([])
    expect(countUnreadInboxThreads(threads)).toBe(1)
    expect(taskbarIndicator([thread({ snoozedUntil: 500 })])).toBeNull()
    expect(snoozedInboxThreads(threads).map((item) => item.id)).toEqual(['ses_c', 'ses_b'])
    expect(snoozedInboxThreads(threads, 'zzz')).toEqual([])
  })

  it('says "Woke up" until the agent is busy again', () => {
    expect(inboxStatusChip(thread({ woke: true }))).toEqual({ label: 'Woke up', tone: 'accent' })
    expect(inboxStatusChip(thread({ woke: true, status: 'idle' }))?.label).toBe('Woke up')
    expect(inboxStatusChip(thread({ woke: true, status: 'working' }))?.label).toBe('Working')
  })

  it('does not flash a terminal thread\'s border for a wake', () => {
    const before = thread({ mode: 'terminal', snoozedUntil: 5 })
    expect(inboxTerminalHighlightTone(before, thread({ mode: 'terminal', woke: true, lastActivityAt: 20 }))).toBeNull()
  })

  it('offers an hour, five hours and tomorrow at 8:00 local time', () => {
    const now = new Date(2026, 10, 12, 21, 30).getTime()
    const options = inboxSnoozeOptions(now)
    expect(options.map((option) => option.id)).toEqual(['hour', 'hours', 'morning'])
    expect(options[0]!.until).toBe(now + HOUR)
    expect(options[1]!.until).toBe(now + 5 * HOUR)
    expect(options[2]!.until).toBe(new Date(2026, 10, 13, 8, 0).getTime())
    // Just after midnight "tomorrow" is still the next calendar day.
    expect(inboxSnoozeOptions(new Date(2026, 10, 13, 0, 30).getTime())[2]!.until).toBe(new Date(2026, 10, 14, 8).getTime())
    // Across the end of a month.
    expect(inboxSnoozeOptions(new Date(2026, 10, 30, 12).getTime())[2]!.until).toBe(new Date(2026, 11, 1, 8).getTime())
  })

  it('names the wake time by how far off it is', () => {
    const now = new Date(2026, 10, 12, 9, 0).getTime()
    const time = (date: Date) => date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    const later = new Date(2026, 10, 12, 14, 0)
    expect(inboxSnoozeTime(later.getTime(), now)).toBe(time(later))
    const tomorrow = new Date(2026, 10, 13, 8, 0)
    expect(inboxSnoozeTime(tomorrow.getTime(), now)).toBe(`Tomorrow ${time(tomorrow)}`)
    expect(inboxSnoozeTime(new Date(2026, 10, 15, 8).getTime(), now)).toMatch(/^\S+ /)
  })
})
