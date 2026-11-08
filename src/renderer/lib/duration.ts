/**
 * A span of time as short text: `45s`, `1m 30s`, `2m`, `1h 5m`. Seconds are cut off, never rounded
 * up, so a count that ticks up once a second never shows a second that has not happened yet.
 * Seconds are left out from an hour on, where they say nothing useful.
 */
export function formatDuration(ms: number): string {
  const seconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    const rest = seconds % 60
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

function unit(count: number, name: string): string {
  return `${count} ${name}${count === 1 ? '' : 's'}`
}

/** The same span in words, for a tooltip or a screen reader: `1 minute 30 seconds`. */
export function spokenDuration(ms: number): string {
  const seconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0
  if (seconds < 60) return unit(seconds, 'second')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    const rest = seconds % 60
    return rest ? `${unit(minutes, 'minute')} ${unit(rest, 'second')}` : unit(minutes, 'minute')
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${unit(hours, 'hour')} ${unit(rest, 'minute')}` : unit(hours, 'hour')
}

/** A generation speed with one decimal, as OpenCode's own interface writes it: `53.1`. */
export function formatRate(tokensPerSecond: number): string {
  return Number.isFinite(tokensPerSecond) && tokensPerSecond > 0 ? tokensPerSecond.toFixed(1) : '0.0'
}

/**
 * How long to wait before the next whole second of `now - since` is reached, so a counter shown
 * from `since` goes up by exactly one each time. A start in the future (clocks that disagree)
 * counts down to the same boundaries.
 */
export function msToNextSecond(now: number, since: number): number {
  const into = (((now - since) % 1000) + 1000) % 1000
  return 1000 - into
}
