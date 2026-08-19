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
