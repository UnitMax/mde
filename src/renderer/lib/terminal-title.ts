/**
 * The last folder of a terminal's working directory, for titling a shell that has no custom
 * title. Accepts `/` and `\` separators because a Windows session can report either, and
 * returns null when there is nothing to show so the caller falls back to a fixed label.
 */
export function directoryLeafName(directory: string | null | undefined): string | null {
  const trimmed = directory?.trim()
  if (!trimmed) return null

  const parts = trimmed.split(/[\\/]+/).filter(Boolean)
  const leaf = parts.at(-1)
  if (leaf) return leaf

  // Only separators were left: the filesystem root.
  return trimmed.startsWith('\\') || trimmed.startsWith('/') ? '/' : null
}
