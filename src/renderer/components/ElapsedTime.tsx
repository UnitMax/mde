import { useEffect, useRef, useState } from 'react'
import { formatDuration, msToNextSecond } from '@/lib/duration'
import { cn } from '@/lib/utils'

/**
 * Milliseconds since `since`, brought up to date as each whole second passes. A start of null means
 * "from now": the count begins when this is first drawn. The clock only runs while this is mounted.
 */
export function useElapsed(since: number | null): number {
  // A start that is not known yet is the moment it was first needed, and stays that moment.
  const fallback = useRef(Date.now())
  const start = since ?? fallback.current
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let timer = 0
    const schedule = (): void => {
      // A little past the boundary, so the timer never wakes just short of it and shows the old second again.
      timer = window.setTimeout(() => {
        setNow(Date.now())
        schedule()
      }, msToNextSecond(Date.now(), start) + 15)
    }
    setNow(Date.now())
    schedule()
    return () => window.clearTimeout(timer)
  }, [start])

  return Math.max(0, now - start)
}

/** A running count of how long something has been going on, e.g. `1m 30s`. */
export function ElapsedTime({ since, className }: { since: number | null; className?: string }): JSX.Element {
  const elapsed = useElapsed(since)
  // role=timer keeps a screen reader from announcing every second.
  return (
    <span role="timer" className={cn('tabular-nums', className)}>
      {formatDuration(elapsed)}
    </span>
  )
}
