/**
 * Ctrl+P in the Inbox: go to a file of the open thread's project by typing part of its name. OpenCode finds the files
 * (the search the `@` picker uses, which leaves out what Git ignores); this orders and marks what it found.
 */

import type { ChatFileEntry } from '@shared/types'
import { matchSubsequence, queryTokens } from '@/lib/fuzzy-search'
import type { SessionSwitcherShortcutInput } from '@/lib/session-switcher'

/** One file in the list: its name, the folder it is in, and which of their letters the query matched. */
export interface FilePickerRow {
  path: string
  name: string
  /** The folder the file is in, ending in `/`, or empty at the top of the project. */
  folder: string
  matches: { name: number[]; folder: number[] }
}

export function isFilePickerShortcut(input: SessionSwitcherShortcutInput): boolean {
  return (
    (input.type === undefined || input.type === 'keydown') &&
    input.key.toLocaleLowerCase() === 'p' &&
    (input.ctrlKey || input.metaKey) &&
    !input.altKey &&
    !input.shiftKey &&
    !input.isComposing
  )
}

/** Whether the keyboard is in a terminal, where Ctrl+P belongs to the shell (the previous command). */
export function inTerminal(element: Element | null): boolean {
  return Boolean(element?.closest('.xterm'))
}

function splitPath(path: string): { name: string; folder: string } {
  const cut = path.lastIndexOf('/')
  return { name: path.slice(cut + 1), folder: path.slice(0, cut + 1) }
}

/**
 * The files OpenCode found for the query, as list rows. Folders are left out: a folder is no place to go. Files whose
 * name holds every word of the query come first, as VS Code puts them; otherwise OpenCode's order stays. The letters a
 * word matched are marked in the name when it holds them, else in the folder.
 */
export function filePickerRows(entries: readonly ChatFileEntry[], query: string): FilePickerRow[] {
  const tokens = queryTokens(query)
  const named: FilePickerRow[] = []
  const rest: FilePickerRow[] = []
  for (const entry of entries) {
    if (entry.directory) continue
    const { name, folder } = splitPath(entry.path)
    const matches = { name: [] as number[], folder: [] as number[] }
    let byName = tokens.length > 0
    for (const token of tokens) {
      const inName = matchSubsequence(token, name)
      if (inName) {
        matches.name.push(...inName.positions)
        continue
      }
      byName = false
      // A word that spans the folder and the name (`src/app`) is marked across the whole path.
      const inPath = matchSubsequence(token, entry.path)
      for (const position of inPath?.positions ?? []) {
        if (position < folder.length) matches.folder.push(position)
        else matches.name.push(position - folder.length)
      }
    }
    const row = { path: entry.path, name, folder, matches }
    ;(byName ? named : rest).push(row)
  }
  return [...named, ...rest]
}
