import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { InboxThread } from '../src/shared/types'
import {
  AUTOMATION_PRESETS,
  automationScheduleLabel,
  followingAutomationRun,
  isAutomationSchedule,
  nextAutomationRun,
  type AutomationSaveRequest,
  type InboxAutomation,
} from '../src/shared/automations'
import { AUTOMATION_CHECK_MS, AUTOMATION_START_DELAY_MS, InboxAutomations, parseAutomations } from '../src/main/inbox/automations'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const model = { id: 'model-1', providerId: 'provider-1' }
const at = (year: number, month: number, day: number, hour = 0, minute = 0): number => new Date(year, month - 1, day, hour, minute).getTime()

describe('automation schedules', () => {
  it('accepts only whole schedules', () => {
    expect(isAutomationSchedule({ kind: 'interval', minutes: 30 })).toBe(true)
    expect(isAutomationSchedule({ kind: 'daily', time: 540 })).toBe(true)
    expect(isAutomationSchedule({ kind: 'daily', time: 540, days: [1, 5] })).toBe(true)
    for (const bad of [null, {}, { kind: 'interval', minutes: 4 }, { kind: 'interval', minutes: 30.5 }, { kind: 'daily', time: -1 }, { kind: 'daily', time: 540, days: [] }, { kind: 'daily', time: 540, days: [1, 8] }, { kind: 'cron', minutes: 30 }]) {
      expect(isAutomationSchedule(bad)).toBe(false)
    }
    for (const preset of AUTOMATION_PRESETS) expect(isAutomationSchedule(preset.schedule)).toBe(true)
  })

  it('says a schedule in words', () => {
    expect(automationScheduleLabel({ kind: 'interval', minutes: 30 })).toBe('Every 30 minutes')
    expect(automationScheduleLabel({ kind: 'interval', minutes: 60 })).toBe('Every hour')
    expect(automationScheduleLabel({ kind: 'interval', minutes: 240 })).toBe('Every 4 hours')
    expect(automationScheduleLabel({ kind: 'interval', minutes: 2880 })).toBe('Every 2 days')
    expect(automationScheduleLabel({ kind: 'daily', time: 540 })).toBe('Every day at 9:00')
    expect(automationScheduleLabel({ kind: 'daily', time: 545, days: [5, 4, 3, 2, 1] })).toBe('Weekdays at 9:05')
    expect(automationScheduleLabel({ kind: 'daily', time: 540, days: [0, 6] })).toBe('Weekends at 9:00')
    expect(automationScheduleLabel({ kind: 'daily', time: 540, days: [1] })).toBe('Every Monday at 9:00')
    expect(automationScheduleLabel({ kind: 'daily', time: 1110, days: [0, 1, 3] })).toBe('Mon, Wed and Sun at 18:30')
    expect(automationScheduleLabel({ kind: 'daily', time: 540, days: [0, 1, 2, 3, 4, 5, 6] })).toBe('Every day at 9:00')
  })

  it('finds the next time of day, today or on the next chosen day', () => {
    // 2026-11-16 is a Monday.
    const daily = { kind: 'daily' as const, time: 9 * 60 }
    expect(nextAutomationRun(daily, at(2026, 11, 16, 8))).toBe(at(2026, 11, 16, 9))
    expect(nextAutomationRun(daily, at(2026, 11, 16, 9))).toBe(at(2026, 11, 17, 9))
    const weekdays = { ...daily, days: [1, 2, 3, 4, 5] }
    expect(nextAutomationRun(weekdays, at(2026, 11, 20, 10))).toBe(at(2026, 11, 23, 9))
    const mondays = { ...daily, days: [1] }
    expect(nextAutomationRun(mondays, at(2026, 11, 16, 9))).toBe(at(2026, 11, 23, 9))
    expect(nextAutomationRun({ kind: 'interval', minutes: 30 }, 1000)).toBe(1000 + 30 * MINUTE)
  })

  it('skips every missed run but keeps the rhythm of an interval', () => {
    const hourly = { kind: 'interval' as const, minutes: 60 }
    expect(followingAutomationRun(hourly, 10 * HOUR, 10 * HOUR)).toBe(11 * HOUR)
    expect(followingAutomationRun(hourly, 10 * HOUR, 10 * HOUR + 5 * MINUTE)).toBe(11 * HOUR)
    // Three days late: the next run is the first one after now, not three days of runs.
    expect(followingAutomationRun(hourly, 10 * HOUR, 10 * HOUR + 3 * DAY + 20 * MINUTE)).toBe(11 * HOUR + 3 * DAY)
    expect(followingAutomationRun({ kind: 'daily', time: 540 }, at(2026, 11, 10, 9), at(2026, 11, 16, 14))).toBe(at(2026, 11, 17, 9))
  })
})

describe('InboxAutomations', () => {
  let directory = ''
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'mde-automations-')) })
  afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

  const request = (patch: Partial<AutomationSaveRequest> = {}): AutomationSaveRequest => ({
    folderId: 'fld_app', text: 'Check the build', agent: 'build', model, schedule: { kind: 'interval', minutes: 60 }, ...patch,
  })

  /** One MDE: its clock, its timers, and the threads its automations started. `open` starts another over the same file. */
  function setup(start = at(2026, 11, 16, 8)) {
    const world = {
      now: start,
      folders: new Set(['fld_app']),
      busy: new Set<string>(),
      threads: new Set<string>(),
      runs: [] as InboxAutomation[],
      fail: null as string | null,
      sendError: false,
    }
    const open = () => {
      const timers: Array<{ callback: () => void; ms: number; cleared: boolean }> = []
      const changes: InboxAutomation[][] = []
      const automations = new InboxAutomations(join(directory, 'inbox-automations.json'), {
        now: () => world.now,
        folderExists: (id) => world.folders.has(id),
        busy: (id) => world.busy.has(id),
        threadExists: (id) => world.threads.has(id),
        run: async (automation) => {
          if (world.fail) throw new Error(world.fail)
          world.runs.push(automation)
          const id = `ses_run${world.runs.length}`
          world.threads.add(id)
          return { id, ...(world.sendError ? { sendError: 'Could not send the first message.' } : {}) } as InboxThread
        },
        onChanged: (list) => changes.push(list),
        setTimer: (callback, ms) => {
          const timer = { callback, ms, cleared: false }
          timers.push(timer)
          return timer
        },
        clearTimer: (timer) => { (timer as { cleared: boolean }).cleared = true },
      })
      const pending = () => timers.filter((timer) => !timer.cleared)
      /** Lets the pending timer fire, and what it started finish. */
      const tick = async () => {
        const timer = pending()[0]
        if (!timer) throw new Error('No timer is waiting.')
        timer.cleared = true
        timer.callback()
        await settle(automations)
      }
      return { automations, timers, pending, changes, tick }
    }
    return { world, open }
  }

  async function settle(automations: InboxAutomations): Promise<void> {
    for (let turn = 0; turn < 5; turn += 1) {
      await automations.flush()
      await new Promise((resolve) => setImmediate(resolve))
    }
  }

  it('runs on time, once, and waits for the next time', async () => {
    const { world, open } = setup()
    const { automations, pending, tick } = open()
    await automations.load()
    automations.start()
    expect(pending().map((timer) => timer.ms)).toEqual([AUTOMATION_START_DELAY_MS])
    const saved = automations.save(request())
    expect(saved.nextRunAt).toBe(world.now + HOUR)
    // The timer never waits longer than a minute, whatever the schedule.
    expect(pending().map((timer) => timer.ms)).toEqual([AUTOMATION_CHECK_MS])
    world.now += 30 * MINUTE
    await tick()
    expect(world.runs).toHaveLength(0)
    world.now += 30 * MINUTE
    await tick()
    expect(world.runs).toHaveLength(1)
    const [after] = automations.list()
    expect(after).toMatchObject({ runs: 1, lastThreadId: 'ses_run1', lastRunAt: world.now, nextRunAt: saved.nextRunAt + HOUR })
    // The same moment again starts nothing more.
    await tick()
    expect(world.runs).toHaveLength(1)
  })

  it('runs once after MDE was closed over many runs, and not again at the next start', async () => {
    const { world, open } = setup()
    const first = open()
    await first.automations.load()
    first.automations.start()
    const saved = first.automations.save(request({ schedule: { kind: 'interval', minutes: 30 } }))
    await first.automations.flush()
    first.automations.dispose()

    // Closed for ten days: 480 runs were due.
    world.now += 10 * DAY + 7 * MINUTE
    const second = open()
    await second.automations.load()
    second.automations.start()
    await second.tick()
    expect(world.runs).toHaveLength(1)
    const [after] = second.automations.list()
    expect(after!.nextRunAt).toBeGreaterThan(world.now)
    expect(after!.nextRunAt - world.now).toBeLessThanOrEqual(30 * MINUTE)
    expect((after!.nextRunAt - saved.nextRunAt) % (30 * MINUTE)).toBe(0)
    await second.tick()
    expect(world.runs).toHaveLength(1)
    second.automations.dispose()

    // Started again a moment later: the made-up run is not made again.
    world.now += MINUTE
    const third = open()
    await third.automations.load()
    third.automations.start()
    await third.tick()
    expect(world.runs).toHaveLength(1)
  })

  it('has moved the next run on in the file before the thread starts', async () => {
    const { world, open } = setup()
    const { automations, tick } = open()
    await automations.load()
    automations.start()
    automations.save(request())
    world.now += 2 * HOUR
    let stored: InboxAutomation[] = []
    const file = join(directory, 'inbox-automations.json')
    const original = world.runs.push.bind(world.runs)
    world.runs.push = (...items) => {
      // What a crash at this very moment would leave behind.
      stored = parseAutomations(readFileSync(file, 'utf8'))
      return original(...items)
    }
    await tick()
    expect(world.runs).toHaveLength(1)
    expect(stored[0]!.nextRunAt).toBeGreaterThan(world.now)
  })

  it('makes up a missed daily run once when the computer wakes', async () => {
    const { world, open } = setup(at(2026, 11, 16, 8))
    const { automations, tick } = open()
    await automations.load()
    automations.start()
    automations.save(request({ schedule: { kind: 'daily', time: 9 * 60 } }))
    // Asleep from Monday morning to Thursday afternoon.
    world.now = at(2026, 11, 19, 15)
    automations.check()
    await settle(automations)
    expect(world.runs).toHaveLength(1)
    expect(automations.list()[0]!.nextRunAt).toBe(at(2026, 11, 20, 9))
    await tick()
    expect(world.runs).toHaveLength(1)
  })

  it('runs nothing while paused, and does not make up for it when turned back on', async () => {
    const { world, open } = setup()
    const { automations, tick, pending } = open()
    await automations.load()
    automations.start()
    const saved = automations.save(request())
    automations.setEnabled(saved.id, false)
    expect(pending()).toHaveLength(0)
    world.now += 5 * HOUR
    automations.check()
    await settle(automations)
    expect(world.runs).toHaveLength(0)
    const back = automations.setEnabled(saved.id, true)
    expect(back!.nextRunAt).toBe(world.now + HOUR)
    await tick()
    expect(world.runs).toHaveLength(0)
  })

  it('leaves a run out while the thread of the one before it is still working', async () => {
    const { world, open } = setup()
    const { automations, tick } = open()
    await automations.load()
    automations.start()
    automations.save(request())
    world.now += HOUR
    await tick()
    world.busy.add('ses_run1')
    world.now += HOUR
    await tick()
    expect(world.runs).toHaveLength(1)
    expect(automations.list()[0]).toMatchObject({ skippedAt: world.now, runs: 1 })
    world.busy.clear()
    world.now += HOUR
    await tick()
    expect(world.runs).toHaveLength(2)
    expect(automations.list()[0]!.skippedAt).toBeUndefined()
  })

  it('keeps the reason when a run fails, tries again at the next time, and pauses when its project is gone', async () => {
    const { world, open } = setup()
    const { automations, tick } = open()
    await automations.load()
    automations.start()
    const saved = automations.save(request())
    world.fail = 'OpenCode is not running.'
    world.now += HOUR
    await tick()
    expect(automations.list()[0]).toMatchObject({ lastError: 'OpenCode is not running.', runs: 0, enabled: true })
    await tick()
    expect(automations.list()[0]!.nextRunAt).toBe(saved.nextRunAt + HOUR)
    world.fail = null
    world.sendError = true
    world.now += HOUR
    await tick()
    expect(automations.list()[0]).toMatchObject({ lastError: 'Could not send the first message.', runs: 1, lastThreadId: 'ses_run1' })
    world.sendError = false
    world.folders.clear()
    world.now += HOUR
    await tick()
    expect(automations.list()[0]).toMatchObject({ enabled: false, runs: 1 })
    expect(automations.list()[0]!.lastError).toContain('project')
    expect(() => automations.setEnabled(saved.id, true)).toThrow(/project/)
  })

  it('pulls a run back when the clock was set back', async () => {
    const { world, open } = setup()
    const { automations } = open()
    await automations.load()
    automations.start()
    automations.save(request())
    world.now -= 30 * DAY
    automations.check()
    expect(automations.list()[0]!.nextRunAt).toBe(world.now + HOUR)
  })

  it('runs now without touching the schedule, even when paused', async () => {
    const { world, open } = setup()
    const { automations } = open()
    await automations.load()
    automations.start()
    const saved = automations.save(request())
    automations.setEnabled(saved.id, false)
    const after = await automations.runNow(saved.id)
    expect(world.runs).toHaveLength(1)
    expect(after).toMatchObject({ enabled: false, nextRunAt: saved.nextRunAt, runs: 1 })
    expect(await automations.runNow('aut_missing')).toBeNull()
  })

  it('counts a changed schedule from now, keeps the rest, and forgets a thread that left the Inbox', async () => {
    const { world, open } = setup(at(2026, 11, 16, 8))
    const { automations, tick, changes } = open()
    await automations.load()
    automations.start()
    const saved = automations.save(request({ permissionMode: 'default', worktree: { base: 'main' } }))
    expect(saved).toMatchObject({ worktree: { base: 'main' } })
    expect(saved.permissionMode).toBeUndefined()
    world.now += HOUR
    await tick()
    const edited = automations.save({ ...request({ text: 'Check the build and the tests' }), id: saved.id })
    expect(edited).toMatchObject({ text: 'Check the build and the tests', runs: 1, nextRunAt: saved.nextRunAt + HOUR })
    expect(edited.worktree).toBeUndefined()
    const moved = automations.save({ ...request({ schedule: { kind: 'daily', time: 18 * 60 } }), id: saved.id })
    expect(moved.nextRunAt).toBe(at(2026, 11, 16, 18))
    expect(changes[changes.length - 1]![0]!.lastThreadId).toBe('ses_run1')
    world.threads.clear()
    expect(automations.list()[0]!.lastThreadId).toBeUndefined()
    automations.remove(saved.id)
    expect(automations.list()).toEqual([])
    expect(() => automations.save({ ...request(), id: saved.id })).toThrow(/no longer exists/)
    expect(() => automations.save(request({ folderId: 'fld_gone' }))).toThrow(/project/)
  })

  it('reads back what it wrote and drops what is malformed', async () => {
    const { open } = setup()
    const { automations } = open()
    await automations.load()
    const saved = automations.save(request({ schedule: { kind: 'daily', time: 540, days: [5, 1] } }))
    await automations.flush()
    const file = join(directory, 'inbox-automations.json')
    const raw = JSON.parse(await readFile(file, 'utf8')) as { automations: unknown[] }
    expect(parseAutomations(JSON.stringify(raw))).toEqual([{ ...saved, schedule: { kind: 'daily', time: 540, days: [1, 5] } }])
    raw.automations.push({ ...saved }, { ...saved, id: 'aut_two', schedule: { kind: 'interval', minutes: 0 } }, { ...saved, id: 'bad' }, 'text')
    await writeFile(file, JSON.stringify(raw))
    const again = open().automations
    await again.load()
    expect(again.list().map((item) => item.id)).toEqual([saved.id])
    expect(parseAutomations('not json')).toEqual([])
  })
})
