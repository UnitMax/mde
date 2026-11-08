import type { GitStatusResponse } from '@shared/types'

export function formatGitCount(value: number): string {
  if (value < 1_000) return String(value)

  const formatUnit = (divisor: number, suffix: string): string => {
    const compact = value / divisor
    const precision = compact < 10 ? 1 : 0
    return `${compact.toFixed(precision).replace(/\.0$/, '')}${suffix}`
  }

  if (value < 1_000_000) return formatUnit(1_000, 'k')
  if (value < 1_000_000_000) return formatUnit(1_000_000, 'm')
  return formatUnit(1_000_000_000, 'b')
}

export function gitStatusBranchLabel(status: GitStatusResponse): string {
  return status.branch ?? 'Detached HEAD'
}

export function gitStatusAccessibleLabel(status: GitStatusResponse): string {
  const details = [`Branch ${gitStatusBranchLabel(status)}`]
  if (status.additions > 0 || status.deletions > 0) {
    details.push(`${status.additions} additions`, `${status.deletions} deletions`)
  }
  if (status.commitsAhead !== null && status.commitsAhead > 0) {
    details.push(`${status.commitsAhead} commits ahead of upstream`)
  }
  return details.join(' · ')
}
