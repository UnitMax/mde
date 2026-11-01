import { describe, expect, it } from 'vitest'
import { formatDuration, formatRate, msToNextSecond, spokenDuration } from '../src/renderer/lib/duration'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

describe('formatDuration', () => {
  it('counts seconds, then minutes and seconds, then hours and minutes', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(45 * SECOND)).toBe('45s')
    expect(formatDuration(MINUTE)).toBe('1m')
    expect(formatDuration(MINUTE + 30 * SECOND)).toBe('1m 30s')
    expect(formatDuration(12 * MINUTE + 5 * SECOND)).toBe('12m 5s')
    expect(formatDuration(HOUR)).toBe('1h')
    expect(formatDuration(HOUR + 5 * MINUTE + 59 * SECOND)).toBe('1h 5m')
    expect(formatDuration(26 * HOUR + 2 * MINUTE)).toBe('26h 2m')
  })

  it('cuts off a partial second instead of rounding it up', () => {
    expect(formatDuration(999)).toBe('0s')
    expect(formatDuration(1999)).toBe('1s')
    expect(formatDuration(59_999)).toBe('59s')
    expect(formatDuration(HOUR - 1)).toBe('59m 59s')
  })

  it('shows no time that has not passed', () => {
    expect(formatDuration(-5 * SECOND)).toBe('0s')
    expect(formatDuration(Number.NaN)).toBe('0s')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0s')
  })
})

describe('spokenDuration', () => {
  it('writes the span out in words with the right plural', () => {
    expect(spokenDuration(0)).toBe('0 seconds')
    expect(spokenDuration(SECOND)).toBe('1 second')
    expect(spokenDuration(MINUTE + 30 * SECOND)).toBe('1 minute 30 seconds')
    expect(spokenDuration(2 * MINUTE)).toBe('2 minutes')
    expect(spokenDuration(HOUR + MINUTE)).toBe('1 hour 1 minute')
    expect(spokenDuration(3 * HOUR)).toBe('3 hours')
  })
})

describe('formatRate', () => {
  it('writes one decimal, as OpenCode does', () => {
    expect(formatRate(53.104)).toBe('53.1')
    expect(formatRate(40)).toBe('40.0')
    expect(formatRate(0.04)).toBe('0.0')
    expect(formatRate(1234.56)).toBe('1234.6')
  })

  it('shows nothing odd for numbers that are not rates', () => {
    expect(formatRate(Number.NaN)).toBe('0.0')
    expect(formatRate(-3)).toBe('0.0')
    expect(formatRate(Number.POSITIVE_INFINITY)).toBe('0.0')
  })
})

describe('msToNextSecond', () => {
  it('waits for the next whole second of the count, not of the clock', () => {
    expect(msToNextSecond(10_250, 10_000)).toBe(750)
    expect(msToNextSecond(12_999, 10_000)).toBe(1)
    // Exactly on a boundary: the next one is a full second away.
    expect(msToNextSecond(12_000, 10_000)).toBe(1000)
  })

  it('stays within one second when the start is ahead of the clock', () => {
    const wait = msToNextSecond(10_000, 10_300)
    expect(wait).toBeGreaterThan(0)
    expect(wait).toBeLessThanOrEqual(1000)
    expect(wait).toBe(300)
  })
})
