/** How many readings the meter keeps for its graph: two minutes at one every two seconds. */
export const RESOURCE_HISTORY_LENGTH = 60

export type ResourceLevel = 'normal' | 'high' | 'critical'

/** How loaded something is, for its color. */
export function resourceLevel(share: number): ResourceLevel {
  if (share >= 0.9) return 'critical'
  if (share >= 0.75) return 'high'
  return 'normal'
}

/** A share from 0 to 1 as a whole percentage. */
export function formatShare(share: number): string {
  return `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%`
}

/**
 * A size the way Task Manager writes it: binary units, labelled GB and MB. Never more than four
 * digits' worth of text ("999 MB", "99.9 GB", "128 GB"): the title bar gives it a fixed width, so
 * a size just under a gigabyte is written "1.0 GB", not "1020 MB".
 */
export function formatMemory(bytes: number): string {
  const gigabytes = bytes / 1024 ** 3
  const megabytes = Math.round(bytes / 1024 ** 2)
  if (gigabytes >= 99.95) return `${Math.round(gigabytes)} GB`
  if (megabytes >= 1000) return `${gigabytes.toFixed(1)} GB`
  return `${megabytes} MB`
}

/** The history with one more reading, oldest first, no longer than the graph is wide. */
export function pushResourceHistory(history: readonly number[], value: number): number[] {
  return [...history, value].slice(-RESOURCE_HISTORY_LENGTH)
}

/**
 * The points of a line graph of shares from 0 to 1, newest at the right edge. A history that is
 * not full yet starts further right, so the line grows in from the right like a monitor's.
 */
export function historyPoints(history: readonly number[], width: number, height: number): string {
  const step = width / (RESOURCE_HISTORY_LENGTH - 1)
  const start = width - (history.length - 1) * step
  return history
    .map((value, index) => `${(start + index * step).toFixed(1)},${(height - Math.min(1, Math.max(0, value)) * height).toFixed(1)}`)
    .join(' ')
}

/** The same line closed along the bottom edge, for the tint under it. */
export function historyArea(history: readonly number[], width: number, height: number): string {
  const start = width - (history.length - 1) * (width / (RESOURCE_HISTORY_LENGTH - 1))
  return `${historyPoints(history, width, height)} ${width.toFixed(1)},${height.toFixed(1)} ${start.toFixed(1)},${height.toFixed(1)}`
}
