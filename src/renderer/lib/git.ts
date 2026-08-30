import type { GitStatusResponse } from '@shared/types'

const gitTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
})

export type GitDiffLineKind = 'addition' | 'deletion' | 'hunk' | 'metadata' | 'context'

export interface GitDiffLine {
  text: string
  kind: GitDiffLineKind
}

export function shortGitHash(hash: string): string {
  return hash.slice(0, 7)
}

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

export function gitStatusChangesLabel(status: GitStatusResponse): string {
  if (status.additions === 0 && status.deletions === 0) return 'Clean'
  return `+${status.additions} −${status.deletions}`
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

export function formatGitTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? timestamp : gitTimestampFormatter.format(date)
}

function diffLineKind(line: string): GitDiffLineKind {
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+') && !line.startsWith('+++')) return 'addition'
  if (line.startsWith('-') && !line.startsWith('---')) return 'deletion'
  if (
    line.startsWith('diff ') ||
    line.startsWith('index ') ||
    line.startsWith('---') ||
    line.startsWith('+++') ||
    line.startsWith('new file ') ||
    line.startsWith('deleted file ') ||
    line.startsWith('similarity index ') ||
    line.startsWith('rename ') ||
    line.startsWith('copy ') ||
    line.startsWith('Binary files ') ||
    line.startsWith('GIT binary patch') ||
    line.startsWith('\\ No newline')
  ) {
    return 'metadata'
  }
  return 'context'
}

export function parseGitDiff(diff: string): GitDiffLine[] {
  if (!diff) return []
  const lines = diff.replaceAll('\r\n', '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines.map((text) => ({ text, kind: diffLineKind(text) }))
}
