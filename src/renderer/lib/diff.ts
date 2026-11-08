import type { ChatPart } from '@shared/types'

export type DiffLineKind = 'context' | 'add' | 'del'

export interface DiffLine {
  kind: DiffLineKind
  text: string
  /** Line number in the old file; absent for additions and when the position is unknown. */
  oldNo?: number
  /** Line number in the new file; absent for deletions and when the position is unknown. */
  newNo?: number
}

export interface DiffHunk {
  lines: DiffLine[]
}

export interface DiffStats {
  additions: number
  deletions: number
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  // A final newline ends the last line; it does not start another one.
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

export function countChanges(hunks: readonly DiffHunk[]): DiffStats {
  let additions = 0
  let deletions = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'add') additions += 1
      else if (line.kind === 'del') deletions += 1
    }
  }
  return { additions, deletions }
}

/**
 * Reads a unified diff, such as `diff -u` or OpenCode writes, into hunks with line numbers. File
 * headers are ignored. The counts in each `@@` header say where a hunk ends, so a deleted line that
 * itself starts with dashes is never mistaken for a header. A diff cut off mid-hunk keeps what it has.
 */
export function parseUnifiedDiff(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  const rows = patch.replace(/\r\n?/g, '\n').split('\n')
  if (rows[rows.length - 1] === '') rows.pop()
  let current: DiffHunk | null = null
  let oldLeft = 0
  let newLeft = 0
  let oldNo = 0
  let newNo = 0
  for (const row of rows) {
    const header = HUNK_HEADER.exec(row)
    if (header) {
      current = { lines: [] }
      hunks.push(current)
      oldNo = Number(header[1])
      newNo = Number(header[3])
      oldLeft = header[2] === undefined ? 1 : Number(header[2])
      newLeft = header[4] === undefined ? 1 : Number(header[4])
      continue
    }
    if (!current || row.startsWith('\\')) continue
    if (oldLeft <= 0 && newLeft <= 0) {
      current = null
      continue
    }
    const sign = row[0]
    if (sign === '+') {
      current.lines.push({ kind: 'add', text: row.slice(1), newNo })
      newNo += 1
      newLeft -= 1
    } else if (sign === '-') {
      current.lines.push({ kind: 'del', text: row.slice(1), oldNo })
      oldNo += 1
      oldLeft -= 1
    } else {
      // A blank context line can lose its leading space on its way here.
      current.lines.push({ kind: 'context', text: sign === ' ' ? row.slice(1) : row, oldNo, newNo })
      oldNo += 1
      newNo += 1
      oldLeft -= 1
      newLeft -= 1
    }
  }
  return hunks.filter((hunk) => hunk.lines.length > 0)
}

/** Above this many table cells the lines in between are shown as one replacement, not matched up. */
const MAX_MATCH_CELLS = 2_000_000

/** Matches up the lines of two blocks that share no prefix and no suffix, deletions before additions. */
function matchLines(a: readonly string[], b: readonly string[]): DiffLine[] {
  const lines: DiffLine[] = []
  if (a.length === 0 || b.length === 0 || a.length * b.length > MAX_MATCH_CELLS) {
    for (const text of a) lines.push({ kind: 'del', text })
    for (const text of b) lines.push({ kind: 'add', text })
    return lines
  }
  // common[i][j]: how many lines the tails a[i..] and b[j..] have in common.
  const width = b.length + 1
  const common = new Uint16Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      common[i * width + j] = a[i] === b[j]
        ? common[(i + 1) * width + j + 1]! + 1
        : Math.max(common[(i + 1) * width + j]!, common[i * width + j + 1]!)
    }
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'context', text: a[i]! })
      i += 1
      j += 1
    } else if (common[(i + 1) * width + j]! >= common[i * width + j + 1]!) {
      lines.push({ kind: 'del', text: a[i]! })
      i += 1
    } else {
      lines.push({ kind: 'add', text: b[j]! })
      j += 1
    }
  }
  for (; i < a.length; i += 1) lines.push({ kind: 'del', text: a[i]! })
  for (; j < b.length; j += 1) lines.push({ kind: 'add', text: b[j]! })
  return lines
}

/**
 * The line changes from one text to another, with a few unchanged lines around each change. Line
 * numbers are left out: the texts are snippets whose place in the file is not known.
 */
export function diffLines(oldText: string, newText: string, context = 3): DiffHunk[] {
  const a = splitLines(oldText)
  const b = splitLines(newText)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1

  const lines: DiffLine[] = [
    ...a.slice(0, head).map((text): DiffLine => ({ kind: 'context', text })),
    ...matchLines(a.slice(head, a.length - tail), b.slice(head, b.length - tail)),
    ...a.slice(a.length - tail).map((text): DiffLine => ({ kind: 'context', text })),
  ]

  // Keep each change and `context` lines around it; changes that are close together share a hunk.
  const keep = new Array<boolean>(lines.length).fill(false)
  lines.forEach((line, index) => {
    if (line.kind === 'context') return
    for (let near = Math.max(0, index - context); near <= Math.min(lines.length - 1, index + context); near += 1) keep[near] = true
  })
  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  lines.forEach((line, index) => {
    if (!keep[index]) {
      current = null
      return
    }
    if (!current) {
      current = { lines: [] }
      hunks.push(current)
    }
    current.lines.push(line)
  })
  return hunks
}

/** Every line of a new file as an addition, numbered from 1. */
export function additionsOf(text: string): DiffHunk[] {
  const lines = splitLines(text).map((line, index): DiffLine => ({ kind: 'add', text: line, newNo: index + 1 }))
  return lines.length > 0 ? [{ lines }] : []
}

const WORD_PIECES = /\s+|\w+|[^\s\w]/g
/** Longer lines are shown without word-level marks; finding the changed words is not worth it. */
const MAX_EMPHASIS_LENGTH = 2000
/** A pair of lines is only marked up when this much of the longer one is shared. */
const MIN_SHARED = 0.4

export type CharRange = readonly [from: number, to: number]

function lengthOf(pieces: readonly string[], from: number, to: number): number {
  let length = 0
  for (let index = from; index < to; index += 1) length += pieces[index]!.length
  return length
}

const solid = (text: string): number => text.replace(/\s/g, '').length

/**
 * Which words changed between two versions of a line: the stretch left over once the same
 * beginning and end are taken off. Null when the lines are the same or too different to compare.
 */
export function changedWords(oldLine: string, newLine: string): { old: CharRange; new: CharRange } | null {
  if (oldLine === newLine || oldLine.length > MAX_EMPHASIS_LENGTH || newLine.length > MAX_EMPHASIS_LENGTH) return null
  const a = oldLine.match(WORD_PIECES) ?? []
  const b = newLine.match(WORD_PIECES) ?? []
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1
  const shared = solid(a.slice(0, head).join('')) + solid(a.slice(a.length - tail).join(''))
  if (shared < MIN_SHARED * Math.max(solid(oldLine), solid(newLine))) return null
  return {
    old: [lengthOf(a, 0, head), oldLine.length - lengthOf(a, a.length - tail, a.length)],
    new: [lengthOf(b, 0, head), newLine.length - lengthOf(b, b.length - tail, b.length)],
  }
}

/**
 * The words to mark within the changed lines of a hunk, by line index. A run of deleted lines
 * followed by added ones is read as the same lines edited, first with first.
 */
export function emphasisIn(hunk: DiffHunk): Map<number, CharRange> {
  const marks = new Map<number, CharRange>()
  const { lines } = hunk
  let index = 0
  while (index < lines.length) {
    if (lines[index]!.kind !== 'del') {
      index += 1
      continue
    }
    const deleted = index
    while (lines[index]?.kind === 'del') index += 1
    const added = index
    while (lines[index]?.kind === 'add') index += 1
    for (let pair = 0; pair < Math.min(added - deleted, index - added); pair += 1) {
      const change = changedWords(lines[deleted + pair]!.text, lines[added + pair]!.text)
      if (!change) continue
      marks.set(deleted + pair, change.old)
      marks.set(added + pair, change.new)
    }
  }
  return marks
}

export interface FileChange {
  path: string
  /** What happened to the file; `write` while it is still unknown whether the file existed. */
  action: 'edit' | 'create' | 'overwrite' | 'write' | 'delete'
  hunks: DiffHunk[]
  /** Whether the lines carry real line numbers, which only a diff from OpenCode does. */
  numbered: boolean
  additions: number
  deletions: number
}

type ToolPart = Extract<ChatPart, { kind: 'tool' }>

function inputOf(part: ToolPart): Record<string, unknown> {
  try {
    const value = JSON.parse(part.input) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function change(path: string, action: FileChange['action'], hunks: DiffHunk[], numbered: boolean): FileChange {
  return { path, action, hunks, numbered, ...countChanges(hunks) }
}

/**
 * The file changes a tool call made, ready to draw as diffs: the diff OpenCode reported for a
 * finished edit, or else one worked out from the call's own input (which is all there is while an
 * edit waits for permission). Null for any other tool, or while the input is still arriving.
 */
export function toolFileChanges(part: ToolPart): FileChange[] | null {
  if (part.name !== 'edit' && part.name !== 'write') return null
  const input = inputOf(part)
  const path = [input.filePath, input.path, input.file_path].find((value): value is string => typeof value === 'string' && value !== '')

  if (part.name === 'write') {
    if (!path || typeof input.content !== 'string') return null
    const action = part.existed === undefined ? 'write' : part.existed ? 'overwrite' : 'create'
    return [change(path, action, additionsOf(input.content), true)]
  }

  if (part.patches?.length) {
    const changes = part.patches
      .map((patch) => change(patch.path, 'edit', parseUnifiedDiff(patch.patch), true))
      .filter((entry) => entry.hunks.length > 0)
    if (changes.length > 0) return changes
  }
  if (!path || typeof input.oldString !== 'string' || typeof input.newString !== 'string') return null
  const hunks = diffLines(input.oldString, input.newString)
  return hunks.length > 0 ? [change(path, 'edit', hunks, false)] : null
}
