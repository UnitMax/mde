import {
  AUTOMATION_MAX_INTERVAL_MINUTES,
  AUTOMATION_MIN_INTERVAL_MINUTES,
  AUTOMATION_PRESETS,
  automationScheduleLabel,
  normalizeAutomationSchedule,
  sameAutomationSchedule,
  type AutomationSchedule,
  type InboxAutomation,
} from '@shared/automations'
import { dayTimeLabel } from '@/lib/time-label'

/** What an automation is called in a list: the first line of its message, without quote marks, cut short. */
export function automationTitle(text: string, limit = 80): string {
  const line = text.split('\n').map((entry) => entry.replace(/^\s*>+\s?/, '').trim()).find(Boolean) ?? ''
  return line.length > limit ? `${line.slice(0, limit - 1).trimEnd()}…` : line
}

/**
 * A moment as it is said from `now`: "in 12 minutes", "today at 14:00", "tomorrow at 9:00", "Mon 23 Nov at 9:00",
 * and for the past "5 minutes ago", "today at 9:00", "yesterday at 9:00". It starts in lower case, to go in a sentence.
 * `past` says which way this very minute is said: "just now" for something that happened, "in a moment" otherwise.
 */
export function automationTimeLabel(at: number, now: number, past = false): string {
  const minutes = Math.round((at - now) / 60_000)
  if (minutes === 0) return past ? 'just now' : 'in a moment'
  if (minutes > 0 && minutes < 60) return minutes === 1 ? 'in 1 minute' : `in ${minutes} minutes`
  if (minutes < 0 && minutes > -60) return minutes === -1 ? '1 minute ago' : `${-minutes} minutes ago`
  return dayTimeLabel(at, now)
}

/** The line under an automation's name: when it runs next, or that it does not. */
export function automationStatusLine(automation: InboxAutomation, now: number): string {
  if (!automation.enabled) return 'Paused'
  return `Next run ${automationTimeLabel(Math.max(automation.nextRunAt, now), now)}`
}

/** The preset a schedule is, if it is one. */
export function automationPresetId(schedule: AutomationSchedule): string | null {
  return AUTOMATION_PRESETS.find((preset) => sameAutomationSchedule(preset.schedule, schedule))?.id ?? null
}

export type IntervalUnit = 'minutes' | 'hours' | 'days'
const UNIT_MINUTES: Record<IntervalUnit, number> = { minutes: 1, hours: 60, days: 1440 }

/** A schedule as the form holds it while it is typed: the number may be half written, and both kinds keep their fields. */
export interface ScheduleForm {
  kind: AutomationSchedule['kind']
  amount: string
  unit: IntervalUnit
  /** `HH:MM`, as a time field gives it. */
  time: string
  /** The chosen days of the week (0 is Sunday); none means every day. */
  days: number[]
}

export function scheduleForm(schedule: AutomationSchedule | null): ScheduleForm {
  const form: ScheduleForm = { kind: 'daily', amount: '2', unit: 'hours', time: '09:00', days: [] }
  if (!schedule) return form
  const value = normalizeAutomationSchedule(schedule)
  if (value.kind === 'interval') {
    const unit: IntervalUnit = value.minutes % 1440 === 0 ? 'days' : value.minutes % 60 === 0 ? 'hours' : 'minutes'
    return { ...form, kind: 'interval', amount: String(value.minutes / UNIT_MINUTES[unit]), unit }
  }
  const time = `${String(Math.floor(value.time / 60)).padStart(2, '0')}:${String(value.time % 60).padStart(2, '0')}`
  return { ...form, kind: 'daily', time, days: value.days ?? [] }
}

/** The schedule a form describes, or why it describes none. */
export function formSchedule(form: ScheduleForm): { schedule: AutomationSchedule } | { problem: string } {
  if (form.kind === 'interval') {
    if (!/^\d{1,5}$/.test(form.amount.trim())) return { problem: 'Enter a whole number.' }
    const minutes = Number(form.amount.trim()) * UNIT_MINUTES[form.unit]
    if (minutes < AUTOMATION_MIN_INTERVAL_MINUTES) return { problem: `The shortest is every ${AUTOMATION_MIN_INTERVAL_MINUTES} minutes.` }
    if (minutes > AUTOMATION_MAX_INTERVAL_MINUTES) return { problem: 'The longest is every 28 days.' }
    return { schedule: { kind: 'interval', minutes } }
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(form.time)
  const hours = match ? Number(match[1]) : NaN
  const minutes = match ? Number(match[2]) : NaN
  if (!match || hours > 23 || minutes > 59) return { problem: 'Enter a time of day.' }
  return { schedule: normalizeAutomationSchedule({ kind: 'daily', time: hours * 60 + minutes, ...(form.days.length > 0 ? { days: form.days } : {}) }) }
}

/** A schedule inside a sentence: "every day at 9:00", "weekdays at 9:00"; a list of days keeps its capitals. */
export function automationScheduleInSentence(schedule: AutomationSchedule): string {
  const label = automationScheduleLabel(schedule)
  return /^(Every|Weekdays|Weekends)\b/.test(label) ? `${label[0]!.toLowerCase()}${label.slice(1)}` : `on ${label}`
}

export { automationScheduleLabel }
