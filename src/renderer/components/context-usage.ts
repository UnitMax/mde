import type { OpenCodeContextUsage, OpenCodeModelSelection } from '@shared/types'

export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value < 1_000) return `${Math.round(value)}`
  if (value < 1_000_000) {
    const decimals = value < 100_000 ? 1 : 0
    return `${(value / 1_000).toFixed(decimals).replace(/\.0$/, '')}k`
  }
  const decimals = value < 10_000_000 ? 1 : 0
  return `${(value / 1_000_000).toFixed(decimals).replace(/\.0$/, '')}M`
}

export function contextUsageMatchesModel(
  usage: OpenCodeContextUsage | null,
  model: OpenCodeModelSelection | null
): boolean {
  return Boolean(
    usage &&
      model &&
      usage.model.providerID === model.providerID &&
      usage.model.modelID === model.modelID
  )
}

export function contextUsageTone(percentage: number): 'normal' | 'warning' | 'danger' {
  if (percentage >= 90) return 'danger'
  if (percentage >= 70) return 'warning'
  return 'normal'
}

export function formatContextUsage(usage: OpenCodeContextUsage | null): string {
  if (!usage) return 'Context —'
  return `${formatTokenCount(usage.usedTokens)} / ${formatTokenCount(usage.contextWindow)} · ${usage.percentage.toFixed(1)}%`
}
