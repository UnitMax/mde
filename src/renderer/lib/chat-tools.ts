import type { ChatPart, ChatToolStatus } from '@shared/types'
import { displayPath, type MessageBlock } from '@/lib/chat'
import { countChanges, type DiffHunk, type DiffLine, type FileChange } from '@/lib/diff'

type ToolPart = Extract<ChatPart, { kind: 'tool' }>

/** The kinds of tool call the chat knows how to draw; everything else is `other`. */
export type ToolKind =
  | 'read'
  | 'write'
  | 'edit'
  | 'patch'
  | 'shell'
  | 'grep'
  | 'glob'
  | 'list'
  | 'webfetch'
  | 'websearch'
  | 'todo'
  | 'question'
  | 'skill'
  | 'subagent'
  | 'execute'
  | 'lookup'
  | 'other'

// OpenCode renamed some tools (`bash` is now `shell`, `task` is `subagent`, `apply_patch` is `patch`), and
// conversations stored before keep the old names, so both are read as the same thing.
const KINDS: Record<string, ToolKind> = {
  read: 'read',
  write: 'write',
  edit: 'edit',
  multiedit: 'edit',
  patch: 'patch',
  apply_patch: 'patch',
  shell: 'shell',
  bash: 'shell',
  grep: 'grep',
  glob: 'glob',
  list: 'list',
  ls: 'list',
  webfetch: 'webfetch',
  fetch: 'webfetch',
  websearch: 'websearch',
  codesearch: 'websearch',
  todowrite: 'todo',
  todoread: 'todo',
  todo: 'todo',
  question: 'question',
  skill: 'skill',
  subagent: 'subagent',
  task: 'subagent',
  execute: 'execute',
  search: 'lookup',
}

export function toolKind(name: string): ToolKind {
  return KINDS[name.toLowerCase()] ?? 'other'
}

/** A tool's own name as words: `apply_patch` and `apply-patch` are "Apply patch". */
export function humanizeTool(name: string): string {
  const words = name.replace(/[_\-.]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase()
  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : 'Tool'
}

export function toolInputOf(part: ToolPart): Record<string, unknown> {
  try {
    const value = JSON.parse(part.input) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export function inputText(input: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

/** The file or folder a tool call is about, as its input names it. */
export function toolPath(part: ToolPart): string | null {
  return inputText(toolInputOf(part), 'path', 'filePath', 'file_path')
}

export function inputNumber(input: Record<string, unknown>, key: string): number | null {
  const value = input[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** A path split at its last slash, so that the folder can be drawn dim and the file bright. */
export function splitPath(path: string): { dir: string; base: string } {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1
  return { dir: path.slice(0, cut), base: path.slice(cut) }
}

/** A web address as its host and the rest, for a row that has little room; the whole address when it is not one. */
export function urlParts(url: string): { host: string; rest: string } {
  try {
    const parsed = new URL(url)
    const rest = `${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`
    return { host: parsed.host.replace(/^www\./, ''), rest }
  } catch {
    return { host: url, rest: '' }
  }
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

// ---------------------------------------------------------------------------------------------------------------
// Shell

export interface ShellInfo {
  command: string
  description: string | null
  workdir: string | null
  exitCode: number | null
  /** The command exited with something other than 0, or the tool failed. */
  failed: boolean
}

export function shellInfo(part: ToolPart, directory = ''): ShellInfo {
  const input = toolInputOf(part)
  const asked = inputText(input, 'workdir', 'cwd')
  // Only a folder other than the thread's own is worth saying.
  const workdir = asked && asked.replace(/[\\/]+$/, '') !== directory.replace(/[\\/]+$/, '') ? displayPath(asked, directory) : null
  const exitCode = part.exitCode ?? null
  return {
    command: inputText(input, 'command') ?? '',
    description: inputText(input, 'description'),
    workdir,
    exitCode,
    failed: part.status === 'error' || (exitCode !== null && exitCode !== 0),
  }
}

/**
 * A command's output as text. The escape character of a color code is dropped on its way here and leaves the rest
 * of it behind (`[32m`), so those remnants go too; a lone carriage return would draw over the line in a terminal
 * but is a line break here.
 */
export function shellOutput(output: string): string {
  return output.replace(/\r\n?/g, '\n').replace(/\[(?:\d{1,3}(?:;\d{1,3}){0,4})?[mKGHJ]/g, '').replace(/\n+$/, '')
}

// ---------------------------------------------------------------------------------------------------------------
// Read

export interface ReadLine {
  no: number
  text: string
}

export interface ReadView {
  lines: ReadLine[]
  /** What OpenCode said after the lines, such as that the file goes on. */
  notes: string[]
}

const NUMBERED_LINE = /^\s*(\d+)(?::|\|) ?(.*)$/
const WRAPPER_TAG = /^\s*<\/?(?:file|path|type|content|entries|directory)\b[^>]*>(?:[^<]*<\/(?:path|type)>)?\s*$/

/**
 * The lines a `read` call returned. OpenCode answers with a line saying what was read, then one line per line
 * of the file, each led by its number (`12: text`; older versions wrote `00012| text`), then maybe a note. Output
 * in any other shape (a folder's listing, an image, an error) returns null and is shown as it came.
 */
export function parseReadOutput(output: string): ReadView | null {
  const lines: ReadLine[] = []
  const notes: string[] = []
  let started = false
  for (const raw of output.replace(/\r\n?/g, '\n').split('\n')) {
    const numbered = NUMBERED_LINE.exec(raw)
    const last = lines[lines.length - 1]
    // A number only continues the file when it follows the one before; a note that happens to start with a digit does not.
    if (numbered && (last === undefined || Number(numbered[1]) === last.no + 1)) {
      lines.push({ no: Number(numbered[1]), text: numbered[2] ?? '' })
      started = true
      continue
    }
    if (!started || WRAPPER_TAG.test(raw) || !raw.trim()) continue
    notes.push(raw.trim())
  }
  return lines.length > 0 ? { lines, notes } : null
}

// ---------------------------------------------------------------------------------------------------------------
// Search

export interface GrepFile {
  path: string
  lines: { no: number | null; text: string }[]
}

export interface GrepView {
  /** How many matches OpenCode counted; null when it did not say. */
  matches: number | null
  files: GrepFile[]
  notes: string[]
}

/** The matches a `grep` call found, by file. Output in any other shape returns null. */
export function parseGrepOutput(output: string): GrepView | null {
  const text = output.replace(/\r\n?/g, '\n').trim()
  if (/^no (?:matches|files)\b/i.test(text)) return { matches: 0, files: [], notes: [] }
  const files: GrepFile[] = []
  const notes: string[] = []
  const loose: string[] = []
  let matches: number | null = null
  let current: GrepFile | null = null
  for (const raw of text.split('\n')) {
    const found = /^Found (\d+) (?:matches|match|files?)\b/i.exec(raw)
    if (found) {
      matches = Number(found[1])
      continue
    }
    const line = /^\s+Line (\d+): ?(.*)$/.exec(raw)
    if (line && current) {
      current.lines.push({ no: Number(line[1]), text: line[2] ?? '' })
      continue
    }
    if (!raw.trim()) continue
    const header = /^(\S.*):$/.exec(raw)
    if (header) {
      current = { path: header[1]!, lines: [] }
      files.push(current)
      continue
    }
    if (/^\(.*\)$/.test(raw.trim())) notes.push(raw.trim())
    else loose.push(raw.trim())
  }
  // A search that only listed the files has no lines under them.
  if (files.length === 0 && loose.length > 0 && loose.every((entry) => /[\\/]/.test(entry) || /\.\w+$/.test(entry))) {
    return { matches, files: loose.map((path) => ({ path, lines: [] })), notes }
  }
  if (files.length === 0) return null
  return { matches: matches ?? files.reduce((sum, file) => sum + file.lines.length, 0), files, notes }
}

/** The paths a `glob` call matched, one per line; none for "No files found". */
export function parseGlobOutput(output: string): string[] | null {
  const text = output.replace(/\r\n?/g, '\n').trim()
  if (!text || /^no files?\b/i.test(text)) return []
  const rows = text.split('\n').map((row) => row.trim()).filter(Boolean)
  const paths = rows.filter((row) => !/^\(.*\)$/.test(row))
  return paths.length > 0 ? paths : null
}

/** A search pattern as a regular expression for marking the matches; null when it is not a valid one. */
export function searchRegExp(pattern: string): RegExp | null {
  if (!pattern || pattern.length > 500) return null
  try {
    const regexp = new RegExp(pattern, 'gi')
    // A pattern that matches nothing at all would mark nothing and could loop on an empty match.
    return regexp.test('') ? null : new RegExp(pattern, 'gi')
  } catch {
    return null
  }
}

/** A line cut into runs, with the parts that matched the pattern marked. */
export function markMatches(text: string, regexp: RegExp | null): { text: string; match: boolean }[] {
  if (!regexp) return [{ text, match: false }]
  const runs: { text: string; match: boolean }[] = []
  let at = 0
  regexp.lastIndex = 0
  for (let found = regexp.exec(text); found && runs.length < 200; found = regexp.exec(text)) {
    if (found[0] === '') {
      regexp.lastIndex += 1
      continue
    }
    if (found.index > at) runs.push({ text: text.slice(at, found.index), match: false })
    runs.push({ text: found[0], match: true })
    at = found.index + found[0].length
  }
  if (at < text.length) runs.push({ text: text.slice(at), match: false })
  return runs.length > 0 ? runs : [{ text, match: false }]
}

export interface WebResult {
  title: string
  url: string
  snippet: string | null
}

/** The results of a web search, from the JSON OpenCode's search tool answers with; null for any other answer. */
export function parseWebSearch(output: string): WebResult[] | null {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    return null
  }
  const results = value && typeof value === 'object' ? (value as { results?: unknown }).results : undefined
  if (!Array.isArray(results)) return null
  const found: WebResult[] = []
  for (const entry of results.slice(0, 50)) {
    if (!entry || typeof entry !== 'object') continue
    const { url, title, excerpts, snippet } = entry as { url?: unknown; title?: unknown; excerpts?: unknown; snippet?: unknown }
    if (typeof url !== 'string' || !url) continue
    const excerpt = Array.isArray(excerpts) ? excerpts.find((item): item is string => typeof item === 'string' && item.trim() !== '') : undefined
    const text = excerpt ?? (typeof snippet === 'string' ? snippet : '')
    found.push({
      title: typeof title === 'string' && title.trim() ? title.trim() : urlParts(url).host,
      url,
      snippet: text.trim() ? text.replace(/\s+/g, ' ').trim() : null,
    })
  }
  return found
}

// ---------------------------------------------------------------------------------------------------------------
// To-do list and questions

export type TodoState = 'pending' | 'active' | 'done' | 'cancelled'

export interface TodoItem {
  text: string
  state: TodoState
  priority: 'high' | 'medium' | 'low' | null
}

export interface TodoView {
  items: TodoItem[]
  done: number
  /** The item being worked on, or else the first one waiting. */
  current: TodoItem | null
}

const TODO_STATES: Record<string, TodoState> = {
  pending: 'pending',
  in_progress: 'active',
  active: 'active',
  completed: 'done',
  done: 'done',
  cancelled: 'cancelled',
  canceled: 'cancelled',
}

/** The to-do list the agent wrote: every call writes the whole list, so this is the list as of that call. */
export function todoView(part: ToolPart): TodoView {
  const todos = toolInputOf(part).todos
  const items: TodoItem[] = []
  for (const entry of Array.isArray(todos) ? todos.slice(0, 100) : []) {
    if (!entry || typeof entry !== 'object') continue
    const { content, status, priority } = entry as { content?: unknown; status?: unknown; priority?: unknown }
    if (typeof content !== 'string' || !content.trim()) continue
    items.push({
      text: content.trim(),
      state: (typeof status === 'string' && TODO_STATES[status]) || 'pending',
      priority: priority === 'high' || priority === 'medium' || priority === 'low' ? priority : null,
    })
  }
  return {
    items,
    done: items.filter((item) => item.state === 'done').length,
    current: items.find((item) => item.state === 'active') ?? items.find((item) => item.state === 'pending') ?? null,
  }
}

export interface AnsweredQuestion {
  header: string | null
  question: string
  answers: string[]
}

/** The questions the agent asked with what the person answered to each, once they have. */
export function answeredQuestions(part: ToolPart): AnsweredQuestion[] {
  const asked = toolInputOf(part).questions
  const questions = (Array.isArray(asked) ? asked : []).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const { question, header } = entry as { question?: unknown; header?: unknown }
    if (typeof question !== 'string' || !question.trim()) return []
    return [{ question: question.trim(), header: typeof header === 'string' && header.trim() ? header.trim() : null }]
  })
  // The answers come in the metadata, in the order of the questions; older text-only output says them as "question"="answer".
  const fromText = new Map<string, string>()
  for (const pair of (part.output ?? '').matchAll(/"([^"\n]+)"="([^"\n]*)"/g)) fromText.set(pair[1]!, pair[2]!)
  return questions.map((entry, index) => {
    const answers = part.answers?.[index] ?? (fromText.has(entry.question) ? [fromText.get(entry.question)!] : [])
    return { ...entry, answers: answers.filter((answer) => answer !== '') }
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Patches

/**
 * The files an `apply_patch` call changes, read from its `patchText`:
 * `*** Begin Patch`, then for each file `*** Add File:`, `*** Update File:` (maybe with `*** Move to:`) or
 * `*** Delete File:`, and the lines of the change led by a space, `-` or `+`, with `@@` between the pieces.
 */
export function patchFileChanges(part: ToolPart): FileChange[] | null {
  const text = toolInputOf(part).patchText
  if (typeof text !== 'string' || !text.includes('*** ')) return null
  const changes: FileChange[] = []
  let current: { path: string; action: FileChange['action']; hunks: DiffHunk[] } | null = null
  const finish = (): void => {
    if (!current) return
    const hunks = current.hunks.filter((hunk) => hunk.lines.length > 0)
    const stats = countChanges(hunks)
    changes.push({ path: current.path, action: current.action, hunks, numbered: false, ...stats })
    current = null
  }
  const rows = text.replace(/\r\n?/g, '\n').split('\n')
  // The text's last newline ends its last line; it does not start another one.
  if (rows[rows.length - 1] === '') rows.pop()
  for (const row of rows) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(row)
    if (header) {
      finish()
      const action = header[1] === 'Add' ? 'create' : header[1] === 'Delete' ? 'delete' : 'edit'
      current = { path: header[2]!.trim(), action, hunks: [{ lines: [] }] }
      continue
    }
    if (!current) continue
    const move = /^\*\*\* Move to: (.+)$/.exec(row)
    if (move) {
      current.path = move[1]!.trim()
      continue
    }
    if (row.startsWith('*** End Patch') || row.startsWith('*** Begin Patch')) {
      finish()
      continue
    }
    if (row.startsWith('@@')) {
      if (current.hunks[current.hunks.length - 1]!.lines.length > 0) current.hunks.push({ lines: [] })
      continue
    }
    if (row.startsWith('***')) continue
    const hunk = current.hunks[current.hunks.length - 1]!
    const sign = row[0]
    const line: DiffLine = sign === '+'
      ? { kind: 'add', text: row.slice(1) }
      : sign === '-'
        ? { kind: 'del', text: row.slice(1) }
        : { kind: 'context', text: sign === ' ' ? row.slice(1) : row }
    hunk.lines.push(line)
  }
  finish()
  return changes.length > 0 ? changes : null
}

// ---------------------------------------------------------------------------------------------------------------
// Thinking

function plainMarkdown(line: string): string {
  return line
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function headingOf(line: string): string | null {
  const bold = /^\*\*([^*]+)\*\*[:.]?$/.exec(line.trim())
  const heading = /^#{1,4}\s+(.+)$/.exec(line.trim())
  const title = plainMarkdown((bold?.[1] ?? heading?.[1] ?? '').trim())
  return title ? (title.length > 120 ? `${title.slice(0, 119)}…` : title) : null
}

/** The heading a thought opens with, as the models that title their thoughts write it (`**Planning the change**`). */
export function reasoningTitle(text: string): string | null {
  return headingOf(text.split('\n').find((line) => line.trim()) ?? '')
}

/**
 * What the thought is on, as one calm line for while it is still streaming. Only what is finished counts: the latest
 * heading whose line has ended, else the latest sentence that has ended. A line that is half written is left out, so the
 * result changes once per thought rather than once per token (and never reads as if it were being typed over).
 * Null until there is something finished to show.
 */
export function reasoningPreview(text: string, max = 160): string | null {
  // The last line is open until a newline closes it; of it, only the sentences that have ended are taken.
  const closed = text.slice(0, text.lastIndexOf('\n') + 1)
  const ended = /^[\s\S]*[.!?:](?=\s)/.exec(text.slice(closed.length))?.[0] ?? ''
  const headings = closed.split('\n')
  for (let index = headings.length - 1; index >= 0; index -= 1) {
    const title = headingOf(headings[index]!)
    if (title) return title
  }
  const last = (closed + ended).split('\n').map(plainMarkdown).filter(Boolean).pop()
  if (!last) return null
  const sentence = last.split(/(?<=[.!?])\s+/).filter(Boolean).pop() ?? last
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence
}

// ---------------------------------------------------------------------------------------------------------------
// Grouping

/** What a stretch of activity is counted as in the line that sums it up. */
export type ActivityCategory = 'thinking' | 'read' | 'search' | 'list' | 'web' | 'shell' | 'skill' | 'todo' | 'tool'

export function activityCategory(part: ChatPart): ActivityCategory {
  if (part.kind !== 'tool') return 'thinking'
  switch (toolKind(part.name)) {
    case 'read':
      return 'read'
    case 'grep':
    case 'glob':
    case 'websearch':
    case 'lookup':
      return 'search'
    case 'list':
      return 'list'
    case 'webfetch':
      return 'web'
    case 'shell':
      return 'shell'
    case 'skill':
      return 'skill'
    case 'todo':
      return 'todo'
    default:
      return 'tool'
  }
}

const PHRASES: Record<ActivityCategory, (count: number, active: boolean) => string> = {
  thinking: (count, active) => (active ? 'thinking' : count > 1 ? `thought ${count} times` : 'thought'),
  read: (count, active) => `${active ? 'reading' : 'read'} ${plural(count, 'file')}`,
  search: (count, active) => `${active ? 'searching' : 'searched'} ${count === 1 ? 'once' : `${count} times`}`,
  list: (count, active) => `${active ? 'listing' : 'listed'} ${plural(count, 'folder')}`,
  web: (count, active) => `${active ? 'fetching' : 'fetched'} ${plural(count, 'page')}`,
  shell: (count, active) => `${active ? 'running' : 'ran'} ${plural(count, 'command')}`,
  skill: (count, active) => `${active ? 'loading' : 'loaded'} ${plural(count, 'skill')}`,
  todo: (_count, active) => (active ? 'updating the to-do list' : 'updated the to-do list'),
  tool: (count, active) => `${active ? 'calling' : 'called'} ${plural(count, 'tool')}`,
}

const CATEGORY_ORDER: ActivityCategory[] = ['thinking', 'read', 'search', 'list', 'web', 'shell', 'skill', 'tool', 'todo']

const ACTIVE: ReadonlySet<ChatToolStatus> = new Set(['pending', 'running'])

export function isActiveTool(part: ChatPart): boolean {
  return part.kind === 'tool' && ACTIVE.has(part.status)
}

/** Whether a tool call ended badly: it failed, or it was a command that exited with an error. */
export function toolFailed(part: ChatPart): boolean {
  if (part.kind !== 'tool') return false
  if (part.status === 'error') return true
  return toolKind(part.name) === 'shell' && part.exitCode !== undefined && part.exitCode !== 0
}

/**
 * One line that sums up a stretch of activity: "Read 4 files, searched 2 times, ran 3 commands". A kind of
 * work that is still going on is in the present tense, so the line is right while the agent works too.
 */
export function activitySummary(parts: readonly ChatPart[], live = false): string {
  const counts = new Map<ActivityCategory, { count: number; active: boolean }>()
  parts.forEach((part, index) => {
    const category = activityCategory(part)
    const entry = counts.get(category) ?? { count: 0, active: false }
    entry.count += 1
    // The thought being written is the last part of a message that is still streaming.
    entry.active ||= part.kind === 'tool' ? isActiveTool(part) : live && index === parts.length - 1
    counts.set(category, entry)
  })
  const phrases = CATEGORY_ORDER.flatMap((category) => {
    const entry = counts.get(category)
    return entry ? [PHRASES[category](entry.count, entry.active)] : []
  })
  const text = phrases.join(', ')
  return text ? `${text[0]!.toUpperCase()}${text.slice(1)}` : 'Activity'
}

/** A tool call that is drawn as a card of its own rather than as one row among others: a file change or an answered question. */
export function isFeaturedTool(part: ChatPart): boolean {
  if (part.kind !== 'tool') return false
  const kind = toolKind(part.name)
  if (part.status === 'error') return false
  if (kind === 'edit' || kind === 'write') return true
  if (kind === 'patch') return part.status === 'completed' && patchFileChanges(part) !== null
  if (kind === 'question') return part.status === 'completed' && answeredQuestions(part).some((entry) => entry.answers.length > 0)
  return false
}

export type ActivityItem = { part: ChatPart; index: number }

export type RenderBlock =
  | Exclude<MessageBlock, { kind: 'part' }>
  | { kind: 'part'; part: ChatPart; index: number }
  | { kind: 'activity'; items: ActivityItem[]; index: number }

/** A run of this many rows or more is folded into one line that sums it up. */
export const GROUP_MIN = 3

/**
 * Lays out the blocks of a message for drawing: runs of three or more ordinary steps (thinking, reading,
 * searching, commands) become one group, and everything else (text, file changes, answers, subagents)
 * stays as it is and breaks the run.
 */
export function activityBlocks(blocks: readonly MessageBlock[]): RenderBlock[] {
  const result: RenderBlock[] = []
  let run: ActivityItem[] = []
  const flush = (): void => {
    if (run.length >= GROUP_MIN) result.push({ kind: 'activity', items: run, index: run[0]!.index })
    else for (const item of run) result.push({ kind: 'part', part: item.part, index: item.index })
    run = []
  }
  for (const block of blocks) {
    if (block.kind === 'part' && isGroupable(block.part)) {
      run.push({ part: block.part, index: block.index })
      continue
    }
    flush()
    result.push(block)
  }
  flush()
  return result
}

function isGroupable(part: ChatPart): boolean {
  if (part.kind === 'text') return false
  if (part.kind === 'reasoning') return part.text.trim() !== ''
  return !isFeaturedTool(part)
}
