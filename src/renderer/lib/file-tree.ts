import type { FileTreeEntry, FileTreeEntryKind } from '@shared/types'

export type FileTreeDirectoryState =
  | { status: 'loading' }
  | { status: 'ready'; entries: FileTreeEntry[]; truncated: boolean }
  | { status: 'error'; error: string }

/** Loaded directories keyed by their path relative to the session root. */
export type FileTreeCache = ReadonlyMap<string, FileTreeDirectoryState>

export interface FileTreeEntryRow {
  type: 'entry'
  path: string
  name: string
  kind: FileTreeEntryKind
  depth: number
  expanded: boolean
}

export interface FileTreeStatusRow {
  type: 'loading' | 'error' | 'empty' | 'truncated'
  /** Directory the status belongs to. */
  path: string
  depth: number
  message?: string
}

export type FileTreeRow = FileTreeEntryRow | FileTreeStatusRow

export function childPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

function appendDirectory(
  rows: FileTreeRow[],
  cache: FileTreeCache,
  expanded: ReadonlySet<string>,
  path: string,
  depth: number
): void {
  const state = cache.get(path)
  if (!state || state.status === 'loading') {
    rows.push({ type: 'loading', path, depth })
    return
  }
  if (state.status === 'error') {
    rows.push({ type: 'error', path, depth, message: state.error })
    return
  }
  if (state.entries.length === 0) {
    rows.push({ type: 'empty', path, depth })
    return
  }

  for (const entry of state.entries) {
    const entryPath = childPath(path, entry.name)
    const isExpanded = entry.kind === 'directory' && expanded.has(entryPath)
    rows.push({
      type: 'entry',
      path: entryPath,
      name: entry.name,
      kind: entry.kind,
      depth,
      expanded: isExpanded
    })
    if (isExpanded) appendDirectory(rows, cache, expanded, entryPath, depth + 1)
  }
  if (state.truncated) rows.push({ type: 'truncated', path, depth })
}

/** Flattens the loaded, expanded part of the tree into display order. */
export function visibleFileTreeRows(
  cache: FileTreeCache,
  expanded: ReadonlySet<string>
): FileTreeRow[] {
  const rows: FileTreeRow[] = []
  appendDirectory(rows, cache, expanded, '', 0)
  return rows
}

/** Directory containing `path`, or null for a root-level entry. */
export function parentPath(path: string): string | null {
  const index = path.lastIndexOf('/')
  return index === -1 ? null : path.slice(0, index)
}
