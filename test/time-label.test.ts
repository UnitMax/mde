import { describe, expect, it } from 'vitest'
import { dayTimeLabel } from '../src/renderer/lib/time-label'

const at = (year: number, month: number, day: number, hour: number, minute: number): number =>
  new Date(year, month - 1, day, hour, minute).getTime()

describe('dayTimeLabel', () => {
  const now = at(2026, 11, 20, 10, 30)

  it('says today, yesterday and tomorrow by the calendar, not by 24 hours', () => {
    expect(dayTimeLabel(at(2026, 11, 20, 9, 5), now)).toBe('today at 9:05')
    expect(dayTimeLabel(at(2026, 11, 19, 20, 9), now)).toBe('yesterday at 20:09')
    expect(dayTimeLabel(at(2026, 11, 21, 23, 59), now)).toBe('tomorrow at 23:59')
    expect(dayTimeLabel(at(2026, 11, 19, 23, 0), at(2026, 11, 20, 1, 0))).toBe('yesterday at 23:00')
  })

  it('gives the date further away, with the year only when it is another one', () => {
    expect(dayTimeLabel(at(2026, 11, 16, 8, 0), now)).toBe('Mon 16 Nov at 8:00')
    expect(dayTimeLabel(at(2025, 12, 31, 18, 45), now)).toBe('Wed 31 Dec 2025 at 18:45')
  })
})
