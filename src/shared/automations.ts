import type { OpenCodeModelRef } from './types'
import type { ThreadPermissionMode } from './permission-modes'

/** The shortest time between two runs: every run starts an agent, so nothing runs every minute. */
export const AUTOMATION_MIN_INTERVAL_MINUTES = 5
/** The longest: four weeks. */
export const AUTOMATION_MAX_INTERVAL_MINUTES = 28 * 24 * 60
/** How many automations MDE keeps. */
export const AUTOMATION_LIMIT = 100

const DAY_MINUTES = 24 * 60

/**
 * When an automation runs. `interval`: every so many minutes, counted from when it was saved. `daily`: at a time
 * of day (minutes after midnight, local time) on the days of the week listed (0 is Sunday), or on every day
 * when none are.
 */
export type AutomationSchedule =
  | { kind: 'interval'; minutes: number }
  | { kind: 'daily'; time: number; days?: number[] }

/** A prompt that starts a new Inbox thread on a schedule. */
export interface InboxAutomation {
  /** `aut_…` */
  id: string
  folderId: string
  /** The message every run starts its thread with. */
  text: string
  agent: string
  model: OpenCodeModelRef
  permissionMode?: Exclude<ThreadPermissionMode, 'default'>
  /** Each run works in a new Git worktree cut from this branch, on a branch MDE names. */
  worktree?: { base: string }
  schedule: AutomationSchedule
  /** A paused automation keeps everything and runs nothing. */
  enabled: boolean
  createdAt: number
  /** When it runs next. Kept while it is paused, and worked out again when it is turned back on. */
  nextRunAt: number
  lastRunAt?: number
  /** The thread the last run started, while it is still in the Inbox. */
  lastThreadId?: string
  /** Why the last run started nothing, or could not send its message. Gone with the next run that works. */
  lastError?: string
  /** When a run was last left out because the thread of the one before it was still working. */
  skippedAt?: number
  runs: number
}

/** What the window sends to make an automation (no `id`) or to change one. */
export interface AutomationSaveRequest {
  id?: string
  folderId: string
  text: string
  agent: string
  model: OpenCodeModelRef
  permissionMode?: ThreadPermissionMode
  worktree?: { base: string }
  schedule: AutomationSchedule
}

export interface AutomationIdRequest {
  id: string
}

export interface AutomationEnabledRequest {
  id: string
  enabled: boolean
}

export function isAutomationId(value: unknown): value is string {
  return typeof value === 'string' && /^aut_[A-Za-z0-9-]{1,64}$/.test(value)
}

function isDayList(value: unknown): value is number[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 7 &&
    value.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) && new Set(value).size === value.length
}

export function isAutomationSchedule(value: unknown): value is AutomationSchedule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (record.kind === 'interval') {
    return keys.length === 2 && Number.isInteger(record.minutes) &&
      (record.minutes as number) >= AUTOMATION_MIN_INTERVAL_MINUTES && (record.minutes as number) <= AUTOMATION_MAX_INTERVAL_MINUTES
  }
  if (record.kind === 'daily') {
    if (!Number.isInteger(record.time) || (record.time as number) < 0 || (record.time as number) >= DAY_MINUTES) return false
    if (record.days === undefined) return keys.length === 2
    return keys.length === 3 && isDayList(record.days)
  }
  return false
}

/** The same schedule with its days in order, and "every day" said in one way. */
export function normalizeAutomationSchedule(schedule: AutomationSchedule): AutomationSchedule {
  if (schedule.kind === 'interval') return { kind: 'interval', minutes: schedule.minutes }
  const days = schedule.days ? [...schedule.days].sort((a, b) => a - b) : []
  return { kind: 'daily', time: schedule.time, ...(days.length > 0 && days.length < 7 ? { days } : {}) }
}

export function sameAutomationSchedule(a: AutomationSchedule, b: AutomationSchedule): boolean {
  return JSON.stringify(normalizeAutomationSchedule(a)) === JSON.stringify(normalizeAutomationSchedule(b))
}

/**
 * The first run of a schedule after `after`, in the computer's own time zone. A time of day that a clock
 * change leaves out (02:30 on the night the clocks go forward) runs at the time the clock shows instead.
 */
export function nextAutomationRun(schedule: AutomationSchedule, after: number): number {
  if (schedule.kind === 'interval') return after + schedule.minutes * 60_000
  const start = new Date(after)
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset, Math.floor(schedule.time / 60), schedule.time % 60)
    if (candidate.getTime() <= after) continue
    if (!schedule.days || schedule.days.length === 0 || schedule.days.includes(candidate.getDay())) return candidate.getTime()
  }
  // Unreachable: one of eight days in a row is always among the chosen ones.
  return after + 7 * DAY_MINUTES * 60_000
}

/**
 * The run that follows one that was due at `due` and is dealt with at `now`. However many runs were missed in
 * between (MDE was closed, the computer slept), the next one is the first after `now`: missed runs are not made
 * up one by one. An interval keeps its rhythm, so "every hour" started at 9:10 stays at ten past.
 */
export function followingAutomationRun(schedule: AutomationSchedule, due: number, now: number): number {
  if (schedule.kind !== 'interval') return nextAutomationRun(schedule, now)
  const step = schedule.minutes * 60_000
  if (due > now) return due
  return due + (Math.floor((now - due) / step) + 1) * step
}

/** `9:00`, `14:05`. */
export function formatAutomationTime(time: number): string {
  return `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAYS = [1, 2, 3, 4, 5]
/** The days of the week as a person lists them: Monday first. */
export const AUTOMATION_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

export function automationDayName(day: number): string {
  return DAY_NAMES[day] ?? ''
}

const plural = (count: number, unit: string): string => (count === 1 ? unit : `${count} ${unit}s`)

/** A schedule in words: "Every hour", "Every day at 9:00", "Weekdays at 9:00", "Mon, Wed and Fri at 18:30". */
export function automationScheduleLabel(input: AutomationSchedule): string {
  const schedule = normalizeAutomationSchedule(input)
  if (schedule.kind === 'interval') {
    const { minutes } = schedule
    if (minutes % DAY_MINUTES === 0) return `Every ${plural(minutes / DAY_MINUTES, 'day')}`
    if (minutes % 60 === 0) return `Every ${plural(minutes / 60, 'hour')}`
    return `Every ${plural(minutes, 'minute')}`
  }
  const at = `at ${formatAutomationTime(schedule.time)}`
  const days = schedule.days
  if (!days) return `Every day ${at}`
  if (days.length === 5 && WEEKDAYS.every((day) => days.includes(day))) return `Weekdays ${at}`
  if (days.length === 2 && days.includes(0) && days.includes(6)) return `Weekends ${at}`
  if (days.length === 1) return `Every ${automationDayName(days[0]!)} ${at}`
  const names = AUTOMATION_DAY_ORDER.filter((day) => days.includes(day)).map((day) => automationDayName(day).slice(0, 3))
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} ${at}`
}

/** The schedules offered by name; anything else is made under "Custom". */
export const AUTOMATION_PRESETS: ReadonlyArray<{ id: string; schedule: AutomationSchedule }> = [
  { id: '30m', schedule: { kind: 'interval', minutes: 30 } },
  { id: '1h', schedule: { kind: 'interval', minutes: 60 } },
  { id: '4h', schedule: { kind: 'interval', minutes: 240 } },
  { id: 'daily', schedule: { kind: 'daily', time: 9 * 60 } },
  { id: 'weekdays', schedule: { kind: 'daily', time: 9 * 60, days: WEEKDAYS } },
  { id: 'weekly', schedule: { kind: 'daily', time: 9 * 60, days: [1] } },
]
