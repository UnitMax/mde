/**
 * Estimates token counts for live display only. OpenCode supplies the exact
 * output/reasoning usage once a turn is complete.
 */
export function estimateTokenCount(text: string): number {
  if (!text.trim()) return 0
  return Math.max(1, Math.ceil(Array.from(text).length / 4))
}

export function formatMetricRate(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate) || rate < 0) return '—'
  if (rate >= 1000) return `${(rate / 1000).toFixed(1)}k`
  if (rate >= 100) return `${Math.round(rate)}`
  if (rate >= 10) return rate.toFixed(1)
  return rate.toFixed(2)
}

export function formatMetricDuration(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return '—'
  const seconds = durationMs / 1000
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  if (seconds < 60) return `${Math.round(seconds)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}
