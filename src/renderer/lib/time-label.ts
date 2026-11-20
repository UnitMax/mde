const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const clock = (date: Date): string => `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`

function dayStart(time: number): number {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Whole days between two moments by the calendar: 23:00 to 01:00 the next morning is one day. */
function daysApart(from: number, to: number): number {
  return Math.round((dayStart(to) - dayStart(from)) / 86_400_000)
}

/**
 * A moment by the calendar, as it is said from `now`: "today at 14:00", "yesterday at 9:00", "tomorrow at 9:00",
 * "Mon 23 Nov at 9:00", with the year when it is not this one. It starts in lower case, to go in a sentence.
 */
export function dayTimeLabel(at: number, now: number): string {
  const date = new Date(at)
  const days = daysApart(now, at)
  if (days === 0) return `today at ${clock(date)}`
  if (days === 1) return `tomorrow at ${clock(date)}`
  if (days === -1) return `yesterday at ${clock(date)}`
  const year = date.getFullYear() === new Date(now).getFullYear() ? '' : ` ${date.getFullYear()}`
  return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}${year} at ${clock(date)}`
}
