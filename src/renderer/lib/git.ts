const gitTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
})

export function shortGitHash(hash: string): string {
  return hash.slice(0, 7)
}

export function formatGitTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? timestamp : gitTimestampFormatter.format(date)
}
