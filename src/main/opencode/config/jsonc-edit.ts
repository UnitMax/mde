import { findNodeAtLocation, parseTree, type JSONPath, type Node } from 'jsonc-parser'

/**
 * Small, careful edits to JSONC text: set a value, add an array element, remove an entry. `jsonc-parser`
 * finds where things are; the text itself is changed here, because its own formatter re-lays-out the whole line
 * next to an edit (an inline `{ "a": 1 }` beside a new key would be expanded). These edits touch only the entry
 * they add, replace or remove: other lines, comments, commas and the trailing-comma style stay as they were,
 * new entries copy the indentation of their siblings, and short flat values are written on one line, like
 * the rules in OpenCode's own examples. A comment on a line of its own is never deleted; a comment trailing
 * an entry on the same line goes with the entry when that entry is removed.
 */

export interface Layout {
  eol: string
  /** One level of indentation. */
  unit: string
}

interface Edit {
  offset: number
  length: number
  content: string
}

/** Flat values up to this width (counting the indentation) stay on one line. */
const INLINE_WIDTH = 100

export function layoutOf(text: string): Layout {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const indent = /^([ \t]+)\S/m.exec(text)?.[1]
  if (indent?.startsWith('\t')) return { eol, unit: '\t' }
  return { eol, unit: indent && indent.length <= 8 ? indent : '  ' }
}

const isScalar = (value: unknown): boolean => value === null || typeof value !== 'object'

function isFlat(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(isScalar)
  if (value && typeof value === 'object') {
    return Object.values(value).every((entry) => isScalar(entry) || (Array.isArray(entry) && entry.every(isScalar)))
  }
  return true
}

function inline(value: unknown): string {
  if (Array.isArray(value)) return value.length === 0 ? '[]' : `[${value.map(inline).join(', ')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    return entries.length === 0 ? '{}' : `{ ${entries.map(([key, entry]) => `${JSON.stringify(key)}: ${inline(entry)}`).join(', ')} }`
  }
  return JSON.stringify(value)
}

/** `value` as JSON text for a line that starts with `indent`. */
export function render(value: unknown, indent: string, layout: Layout): string {
  const flat = inline(value)
  if (isScalar(value) || (isFlat(value) && indent.length + flat.length <= INLINE_WIDTH)) return flat
  const child = indent + layout.unit
  const separator = `,${layout.eol}${child}`
  if (Array.isArray(value)) {
    return `[${layout.eol}${child}${value.map((entry) => render(entry, child, layout)).join(separator)}${layout.eol}${indent}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
  const body = entries.map(([key, entry]) => `${JSON.stringify(key)}: ${render(entry, child, layout)}`).join(separator)
  return `{${layout.eol}${child}${body}${layout.eol}${indent}}`
}

const isEol = (character: string | undefined): boolean => character === '\n' || character === '\r'

/** Where an entry's own text ends: after its value, before any comma or comment. */
const endOf = (entry: Node): number => entry.offset + entry.length

function lineStart(text: string, position: number): number {
  let start = position
  while (start > 0 && !isEol(text[start - 1])) start -= 1
  return start
}

function indentOfLine(text: string, position: number): string {
  const start = lineStart(text, position)
  return /^[ \t]*/.exec(text.slice(start, position))?.[0] ?? ''
}

/** True when nothing but blanks comes before `position` on its line. */
function startsItsLine(text: string, position: number): boolean {
  return text.slice(lineStart(text, position), position).trim() === ''
}

/**
 * What follows an entry on its line: its comma (if any), a comment, and whether the line ends there.
 * `end` is where the line's content ends, after the comma and any comment.
 */
function afterEntry(text: string, entry: Node): { end: number; comma: number | null; endsLine: boolean } {
  let position = endOf(entry)
  const skipBlanks = (): void => {
    while (text[position] === ' ' || text[position] === '\t') position += 1
  }
  skipBlanks()
  let comma: number | null = null
  if (text[position] === ',') {
    comma = position
    position += 1
    skipBlanks()
  }
  for (;;) {
    if (text.startsWith('//', position)) {
      while (position < text.length && !isEol(text[position])) position += 1
      break
    }
    if (text.startsWith('/*', position)) {
      const close = text.indexOf('*/', position + 2)
      if (close < 0 || /[\r\n]/.test(text.slice(position, close))) break
      position = close + 2
      skipBlanks()
      continue
    }
    break
  }
  return { end: position, comma, endsLine: position >= text.length || isEol(text[position]) }
}

/**
 * Applies edits from the end of the text backwards, so earlier offsets stay valid. Edits are listed in text order:
 * of two at the same offset, the later one is applied first and so ends up after the earlier one.
 */
function splice(text: string, edits: Edit[]): string {
  let result = text
  const order = edits.map((edit, index) => ({ edit, index })).sort((a, b) => b.edit.offset - a.edit.offset || b.index - a.index)
  for (const { edit } of order) {
    result = result.slice(0, edit.offset) + edit.content + result.slice(edit.offset + edit.length)
  }
  return result
}

function parseRoot(text: string): Node {
  const root = parseTree(text, [], { allowTrailingComma: true, disallowComments: false })
  if (!root) throw new Error('The file has no JSON object to edit.')
  return root
}

/** The edits that add one entry (`property: value` or an element) at the end of an object or array. */
function addEntry(text: string, container: Node, entry: (indent: string) => string, layout: Layout): Edit[] {
  const children = container.children ?? []
  const outer = indentOfLine(text, container.offset)
  const open = container.offset
  const close = container.offset + container.length - 1
  const first = children[0]
  const last = children[children.length - 1]
  if (!first || !last) {
    const inner = text.slice(open + 1, close)
    const indent = outer + layout.unit
    const body = `${layout.eol}${indent}${entry(indent)}`
    // Comments inside an empty container stay where they are.
    if (inner.trim() === '') return [{ offset: open + 1, length: inner.length, content: `${body}${layout.eol}${outer}` }]
    return [{ offset: open + 1, length: 0, content: body }]
  }
  const after = afterEntry(text, last)
  if (startsItsLine(text, first.offset) && after.endsLine) {
    const indent = indentOfLine(text, first.offset)
    const body = `${layout.eol}${indent}${entry(indent)}`
    // The new entry follows the file's own comma style: trailing comma after the last entry, or none.
    if (after.comma !== null) return [{ offset: after.end, length: 0, content: `${body},` }]
    return [
      { offset: endOf(last), length: 0, content: ',' },
      { offset: after.end, length: 0, content: body },
    ]
  }
  // Entries share a line (`{ "a": 1 }`): keep it that way.
  return [{ offset: endOf(last), length: 0, content: `, ${entry(indentOfLine(text, last.offset))}` }]
}

/** The edits that remove one entry of an object or array, and the comma that would be left over. */
function dropEntry(text: string, container: Node, entry: Node): Edit[] {
  const children = container.children ?? []
  const index = children.indexOf(entry)
  const after = afterEntry(text, entry)
  const open = container.offset
  const close = container.offset + container.length - 1
  const ownLines = startsItsLine(text, entry.offset) && after.endsLine

  const spanStart = ownLines ? lineStart(text, entry.offset) : entry.offset
  let spanEnd = after.end
  if (ownLines) {
    if (text.startsWith('\r\n', spanEnd)) spanEnd += 2
    else if (isEol(text[spanEnd])) spanEnd += 1
  }

  if (children.length === 1) {
    const rest = text.slice(open + 1, spanStart) + text.slice(spanEnd, close)
    // Nothing else inside: leave `{}` or `[]`, not an empty pair of lines.
    if (rest.trim() === '') return [{ offset: open + 1, length: close - open - 1, content: '' }]
    return [{ offset: spanStart, length: spanEnd - spanStart, content: '' }]
  }
  if (ownLines) {
    const edits: Edit[] = [{ offset: spanStart, length: spanEnd - spanStart, content: '' }]
    const previous = children[index - 1]
    // The last entry had no comma of its own; the one before it must not keep its comma either.
    if (index === children.length - 1 && after.comma === null && previous) {
      const comma = afterEntry(text, previous).comma
      if (comma !== null) edits.push({ offset: comma, length: 1, content: '' })
    }
    return edits
  }
  const previous = children[index - 1]
  const next = children[index + 1]
  if (previous) return [{ offset: endOf(previous), length: endOf(entry) - endOf(previous), content: '' }]
  if (next) return [{ offset: entry.offset, length: next.offset - entry.offset, content: '' }]
  return [{ offset: spanStart, length: spanEnd - spanStart, content: '' }]
}

/** Sets the value at `path`, replacing it or adding it (with any missing objects above it). */
export function setValue(text: string, path: JSONPath, value: unknown): string {
  const layout = layoutOf(text)
  const root = parseRoot(text)
  const existing = findNodeAtLocation(root, path)
  if (existing) {
    return splice(text, [{ offset: existing.offset, length: existing.length, content: render(value, indentOfLine(text, existing.offset), layout) }])
  }
  let depth = path.length - 1
  let container = findNodeAtLocation(root, path.slice(0, depth))
  while (!container && depth > 0) {
    depth -= 1
    container = findNodeAtLocation(root, path.slice(0, depth))
  }
  const segment = path[depth]
  if (!container || container.type !== 'object' || typeof segment !== 'string') {
    throw new Error(`Cannot add ${path.join('.')}: the file has something else there.`)
  }
  let wrapped = value
  for (let index = path.length - 1; index > depth; index -= 1) {
    const key = path[index]
    if (typeof key !== 'string') throw new Error(`Cannot add ${path.join('.')}: the file has something else there.`)
    wrapped = { [key]: wrapped }
  }
  const edits = addEntry(text, container, (indent) => `${JSON.stringify(segment)}: ${render(wrapped, indent, layout)}`, layout)
  return splice(text, edits)
}

/** Adds an element at the end of the array at `path`. */
export function appendElement(text: string, path: JSONPath, value: unknown): string {
  const layout = layoutOf(text)
  const array = findNodeAtLocation(parseRoot(text), path)
  if (!array || array.type !== 'array') throw new Error(`Cannot add to ${path.join('.')}: it is not a list in the file.`)
  return splice(text, addEntry(text, array, (indent) => render(value, indent, layout), layout))
}

/** Removes the property at `path` if its value is an empty object or array with nothing, not even a comment, in it. */
export function removeIfEmpty(text: string, path: JSONPath): string {
  const node = findNodeAtLocation(parseRoot(text), path)
  if (!node || (node.type !== 'object' && node.type !== 'array')) return text
  return text.slice(node.offset + 1, node.offset + node.length - 1).trim() === '' ? removeValue(text, path) : text
}

/** Removes the property or element at `path`; nothing happens when it is not there. */
export function removeValue(text: string, path: JSONPath): string {
  const node = findNodeAtLocation(parseRoot(text), path)
  if (!node) return text
  const entry = node.parent?.type === 'property' ? node.parent : node
  const container = entry.parent
  if (!container) throw new Error('The root of the file cannot be removed.')
  return splice(text, dropEntry(text, container, entry))
}
