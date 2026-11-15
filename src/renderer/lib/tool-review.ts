import type { ChatMessage, ChatPart } from '@shared/types'
import { displayPath, skillCall } from '@/lib/chat'
import { commandName, humanizeTool, inputText, shellInfo, toolFailed, toolInputOf, toolKind, toolPath, type ToolKind } from '@/lib/chat-tools'
import { argsPreview, mcpCalls, type McpCall } from '@/lib/mcp'

type ToolPart = Extract<ChatPart, { kind: 'tool' }>

/*
 * The Tools tab of the Inbox sidebar: every tool call of a thread, turn by turn, to be looked over after the fact.
 * The chat shows the same calls among the agent's words; here they are on their own, can be narrowed to the calls
 * that went to an MCP server or that failed, and searched.
 */

/** One tool call as the review lists it. */
export interface ToolEntry {
  /** The tool part's id, unique in the thread. */
  id: string
  messageId: string
  part: ToolPart
  kind: ToolKind
  /** What the part called on MCP servers or Code Mode groups; empty for one of the agent's own tools. */
  calls: McpCall[]
  /** Whether any of `calls` went to a known MCP server. */
  mcp: boolean
  /**
   * Whether the call acts on the world beyond reading and editing files: a shell command, a call to an MCP server or a
   * Code Mode script, or a tool MDE does not know (often an MCP tool whose server list has not loaded yet). These are
   * what the Tools tab shows by default.
   */
  action: boolean
  /** What kind of call it is, in a word or two: "Read", "Shell", or the MCP tool's own name. */
  title: string
  /** What it was about: a file, a command, the arguments. Empty when there is nothing to say. */
  subject: string
  failed: boolean
  active: boolean
}

/** The calls made in answer to one message of the person's. */
export interface ToolTurn {
  /** The person's message, or `start` for calls before the first one that is loaded. */
  id: string
  /** 1-based among the turns that are loaded. */
  number: number
  /** The first line of what the person asked; null for calls before the first loaded message. */
  prompt: string | null
  time: number
  entries: ToolEntry[]
}

const TITLES: Partial<Record<ToolKind, string>> = {
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  patch: 'Patch',
  shell: 'Shell',
  grep: 'Grep',
  glob: 'Glob',
  list: 'List',
  webfetch: 'Fetch',
  websearch: 'Web search',
  todo: 'To-dos',
  question: 'Question',
  skill: 'Skill',
  subagent: 'Subagent',
  execute: 'Code Mode',
  lookup: 'Tool search',
}

function firstLine(text: string, max = 120): string {
  const line = text.split('\n').map((item) => item.trim()).find(Boolean) ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function subjectOf(part: ToolPart, kind: ToolKind, calls: readonly McpCall[], directory: string): string {
  const input = toolInputOf(part)
  switch (kind) {
    case 'read':
    case 'write':
    case 'edit':
    case 'patch':
    case 'list': {
      const path = toolPath(part)
      return path ? displayPath(path, directory) : ''
    }
    case 'shell':
      return firstLine(shellInfo(part, directory).command)
    case 'grep':
    case 'glob':
    case 'lookup':
      return inputText(input, 'pattern', 'query') ?? ''
    case 'webfetch':
      return inputText(input, 'url') ?? ''
    case 'websearch':
      return inputText(input, 'query', 'q') ?? ''
    case 'skill':
      return skillCall(part).name ?? ''
    case 'subagent':
      return firstLine(inputText(input, 'description', 'prompt') ?? '')
    case 'question': {
      const questions = input.questions
      const first = Array.isArray(questions) ? (questions[0] as { question?: unknown } | undefined)?.question : undefined
      return typeof first === 'string' ? firstLine(first) : ''
    }
    case 'execute':
      return [...new Set(calls.map((call) => (call.namespace ? `${call.namespace}.${call.tool}` : call.tool)))].join(', ')
    case 'todo':
      return ''
    default:
      return calls.length === 1 ? argsPreview(calls[0]!.input) : argsPreview(part.input)
  }
}

/** One tool part as the review lists it, with what MCP servers it called told by their names. */
export function toolEntry(part: ToolPart, messageId: string, servers: readonly string[], directory: string): ToolEntry {
  const kind = toolKind(part.name)
  const calls = mcpCalls(part, servers)
  const direct = kind !== 'execute' && calls.length === 1 ? calls[0]! : null
  return {
    id: part.id,
    messageId,
    part,
    kind,
    calls,
    mcp: calls.some((call) => call.server !== null),
    action: kind === 'shell' || kind === 'execute' || kind === 'other' || calls.length > 0,
    title: direct ? direct.tool : TITLES[kind] ?? humanizeTool(part.name),
    subject: subjectOf(part, kind, calls, directory),
    failed: toolFailed(part),
    active: part.status === 'running' || part.status === 'pending',
  }
}

/** Every tool call in these messages, under the message of the person's that it answered. Turns without calls are left out. */
export function toolTurns(messages: readonly ChatMessage[], servers: readonly string[], directory: string): ToolTurn[] {
  const turns: ToolTurn[] = []
  let current: ToolTurn | null = null
  let number = 0
  for (const message of messages) {
    if (message.kind === 'user') {
      number += 1
      current = { id: message.id, number, prompt: firstLine(message.text) || 'Message', time: message.time, entries: [] }
      turns.push(current)
      continue
    }
    if (message.kind !== 'assistant') continue
    for (const part of message.parts) {
      if (part.kind !== 'tool') continue
      if (!current) {
        current = { id: 'start', number: 0, prompt: null, time: message.time, entries: [] }
        turns.push(current)
      }
      current.entries.push(toolEntry(part, message.id, servers, directory))
    }
  }
  return turns.filter((turn) => turn.entries.length > 0)
}

/** `actions` (the default) is commands and MCP calls; `all` adds reads, edits, searches, questions and the rest. */
export type ToolFilter = 'actions' | 'mcp' | 'failed' | 'all'

export interface ToolCounts {
  actions: number
  all: number
  mcp: number
  failed: number
  running: number
}

export function toolCounts(turns: readonly ToolTurn[]): ToolCounts {
  const counts: ToolCounts = { actions: 0, all: 0, mcp: 0, failed: 0, running: 0 }
  for (const turn of turns) {
    for (const entry of turn.entries) {
      counts.all += 1
      if (entry.action) counts.actions += 1
      if (entry.mcp) counts.mcp += 1
      if (entry.failed) counts.failed += 1
      if (entry.active) counts.running += 1
    }
  }
  return counts
}

/** How many tool calls these messages hold; cheap enough to count on every change, for the tab's badge. */
export function toolCallCount(messages: readonly ChatMessage[]): number {
  let count = 0
  for (const message of messages) {
    if (message.kind !== 'assistant') continue
    for (const part of message.parts) if (part.kind === 'tool') count += 1
  }
  return count
}

function matches(entry: ToolEntry, words: readonly string[]): boolean {
  const haystack = [
    entry.title,
    entry.subject,
    entry.part.name,
    ...entry.calls.flatMap((call) => [call.server ?? '', call.namespace, call.tool]),
    ...(entry.kind === 'shell' ? [commandName(shellInfo(entry.part).command) ?? ''] : []),
    entry.part.input,
    entry.part.error ?? '',
  ].join('\n').toLowerCase()
  return words.every((word) => haystack.includes(word))
}

/** The turns with only the calls the filter and the search keep; a turn left empty goes. Every word must match. */
export function filterTurns(turns: readonly ToolTurn[], filter: ToolFilter, query: string): ToolTurn[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (filter === 'all' && words.length === 0) return turns as ToolTurn[]
  return turns.flatMap((turn) => {
    const entries = turn.entries.filter((entry) =>
      (filter === 'all' || (filter === 'actions' ? entry.action : filter === 'mcp' ? entry.mcp : entry.failed)) && (words.length === 0 || matches(entry, words)))
    return entries.length > 0 ? [{ ...turn, entries }] : []
  })
}

export interface ToolTally {
  all: number
  /** Commands, scripts and calls to tools MDE does not know: what the Actions view shows, counted without the server list. */
  actions: number
  failed: number
}

/** The thread's tool calls counted for a summary line, cheaply enough to do on every change. */
export function toolTally(messages: readonly ChatMessage[]): ToolTally {
  const tally: ToolTally = { all: 0, actions: 0, failed: 0 }
  for (const message of messages) {
    if (message.kind !== 'assistant') continue
    for (const part of message.parts) {
      if (part.kind !== 'tool') continue
      tally.all += 1
      const kind = toolKind(part.name)
      if (kind === 'shell' || kind === 'execute' || kind === 'other' || (part.calls?.length ?? 0) > 0) tally.actions += 1
      if (toolFailed(part)) tally.failed += 1
    }
  }
  return tally
}
