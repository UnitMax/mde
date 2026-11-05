import { formatDuration } from '@/lib/duration'
import type { ChatMcpServer, ChatMessage, ChatPart, ChatToolStatus, OpenCodeTarget } from '@shared/types'

type ToolPart = Extract<ChatPart, { kind: 'tool' }>

/** The key of a place MCP servers belong to: the OpenCode service and the directory it works in. */
export function mcpKey(target: OpenCodeTarget, directory: string): string {
  return `${mcpTargetKey(target)}\n${directory}`
}

export function mcpTargetKey(target: OpenCodeTarget): string {
  return target.kind === 'native' ? 'native' : `wsl:${target.distro}`
}

// ---------------------------------------------------------------------------------------------
// Which tool calls belong to which MCP server
// ---------------------------------------------------------------------------------------------

/**
 * The names a server's tools go by in Code Mode (`tools.<namespace>.<tool>`): OpenCode groups them by the server's
 * name with everything but letters, digits and `_` turned into `_`. Direct tools (`<server>_<tool>`) keep `-`. Which
 * of the two a namespace uses for a hyphen has not been observed, so both are accepted.
 */
export function serverNamespaces(name: string): string[] {
  return [...new Set([name.replace(/[^A-Za-z0-9_]/g, '_'), name.replace(/[^A-Za-z0-9_-]/g, '_')])]
}

/** `demo_math.add` -> namespace `demo_math`, tool `add`. Split at the first dot: a tool's own name may hold dots. */
export function splitCall(tool: string): { namespace: string; name: string } {
  const dot = tool.indexOf('.')
  return dot < 0 ? { namespace: '', name: tool } : { namespace: tool.slice(0, dot), name: tool.slice(dot + 1) }
}

export interface McpCall {
  /** The group the script called: an MCP server's normalised name, or a built-in such as `browser`. */
  namespace: string
  /** The tool's name inside the group. */
  tool: string
  /** The configured name of the MCP server the group belongs to; null for a built-in or an unknown group. */
  server: string | null
  status: ChatToolStatus
  /** The arguments as JSON text; cut when long. */
  input: string
}

function serverOf(namespace: string, servers: readonly string[]): string | null {
  for (const server of servers) if (serverNamespaces(server).includes(namespace)) return server
  return null
}

/**
 * What a tool part called. A Code Mode script (`execute`) lists its calls in its metadata, and every one of them
 * is returned, whether or not the group is a known MCP server, so that how a call looks does not depend on whether
 * the server list has loaded. A direct tool part (`<server>_<tool>`, when a server's Code Mode is switched off) is
 * one call, recognised by the longest known server name it starts with.
 */
export function mcpCalls(part: ToolPart, servers: readonly string[]): McpCall[] {
  if (part.calls && part.calls.length > 0) {
    return part.calls.map((call) => {
      const { namespace, name } = splitCall(call.tool)
      return { namespace, tool: name, server: namespace ? serverOf(namespace, servers) : null, status: call.status, input: call.input }
    })
  }
  let best: { server: string; prefix: string } | null = null
  for (const server of servers) {
    for (const namespace of serverNamespaces(server)) {
      const prefix = `${namespace}_`
      if (part.name.length > prefix.length && part.name.startsWith(prefix) && (!best || prefix.length > best.prefix.length)) best = { server, prefix }
    }
  }
  if (!best) return []
  return [{
    namespace: best.prefix.slice(0, -1),
    tool: part.name.slice(best.prefix.length),
    server: best.server,
    status: part.status,
    input: part.input,
  }]
}

/** The script a Code Mode part ran, or null when its input is not (yet) the usual `{ code }`. */
export function scriptOf(part: ToolPart): string | null {
  try {
    const input: unknown = JSON.parse(part.input)
    const code = input && typeof input === 'object' ? (input as { code?: unknown }).code : undefined
    return typeof code === 'string' && code.trim() ? code : null
  } catch {
    return null
  }
}

export interface McpUse {
  calls: number
  failed: number
}

/** How many times each known MCP server was called in these messages, counting a failed call in both numbers. */
export function mcpCallCounts(messages: readonly ChatMessage[], servers: readonly string[]): Map<string, McpUse> {
  const counts = new Map<string, McpUse>()
  for (const message of messages) {
    if (message.kind !== 'assistant') continue
    for (const part of message.parts) {
      if (part.kind !== 'tool') continue
      for (const call of mcpCalls(part, servers)) {
        if (!call.server) continue
        const use = counts.get(call.server) ?? { calls: 0, failed: 0 }
        use.calls += 1
        if (call.status === 'error') use.failed += 1
        counts.set(call.server, use)
      }
    }
  }
  return counts
}

// ---------------------------------------------------------------------------------------------
// Showing a call
// ---------------------------------------------------------------------------------------------

function scalar(value: unknown): string {
  if (typeof value === 'string') return value.length > 28 ? `${value.slice(0, 27)}…` : value
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.length}]`
  return '{…}'
}

/** A call's arguments as parsed pairs; null when the text is not a JSON object (it may have been cut). */
export function callArguments(input: string): Array<[string, unknown]> | null {
  try {
    const value: unknown = JSON.parse(input)
    return value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : null
  } catch {
    return null
  }
}

/** The arguments in one short line: `a: 7, b: 5`. */
export function argsPreview(input: string, max = 80): string {
  const pairs = callArguments(input)
  const text = pairs ? pairs.map(([key, value]) => `${key}: ${scalar(value)}`).join(', ') : input.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export type ResultView =
  | { kind: 'json'; text: string }
  | { kind: 'markdown'; text: string }
  | { kind: 'text'; text: string }

const MAX_JSON_PRETTY = 200_000
const MARKDOWN_LINE = /^\s{0,3}(?:#{1,6}\s+\S|[-*+]\s+\S|\d+[.)]\s+\S|```|>\s?\S|\|.+\|\s*$)/

/**
 * How a script's result is best shown: JSON, laid out; text that is clearly Markdown (a heading, list, table or
 * fence on at least two lines); or as it came.
 */
export function resultView(text: string): ResultView {
  const trimmed = text.trim()
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length <= MAX_JSON_PRETTY) {
    try {
      const value: unknown = JSON.parse(trimmed)
      if (value && typeof value === 'object') return { kind: 'json', text: JSON.stringify(value, null, 2) }
    } catch {
      // Not JSON after all, perhaps cut.
    }
  }
  const markdownLines = text.split('\n').filter((line) => MARKDOWN_LINE.test(line)).length
  return markdownLines >= 2 ? { kind: 'markdown', text } : { kind: 'text', text }
}

/** A result small enough to read in the collapsed row: `sum: 12`, or a one-line text. Null otherwise. */
export function inlineAnswer(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const value: unknown = JSON.parse(trimmed)
      if (Array.isArray(value) || !value || typeof value !== 'object') return null
      const pairs = Object.entries(value)
      if (pairs.length === 0 || pairs.length > 3 || pairs.some(([, item]) => item !== null && typeof item === 'object')) return null
      const line = pairs.map(([key, item]) => `${key}: ${scalar(item)}`).join(', ')
      return line.length <= 60 ? line : null
    } catch {
      return null
    }
  }
  return trimmed.length <= 60 && !trimmed.includes('\n') ? trimmed : null
}

export interface JsonToken {
  text: string
  kind: 'key' | 'string' | 'number' | 'literal' | 'punct' | 'space'
}

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b|[{}[\],:]|\s+|[^\s]/g

/** Splits (pretty-printed) JSON into pieces to colour. The pieces join back into exactly the input. */
export function highlightJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = []
  for (const match of text.matchAll(JSON_TOKEN)) {
    const [whole, quoted, colon] = match
    if (quoted !== undefined) {
      tokens.push({ text: quoted, kind: colon ? 'key' : 'string' })
      if (colon) tokens.push({ text: colon, kind: 'punct' })
    } else if (/^\s+$/.test(whole)) tokens.push({ text: whole, kind: 'space' })
    else if (/^[{}[\],:]$/.test(whole)) tokens.push({ text: whole, kind: 'punct' })
    else if (/^-?\d/.test(whole)) tokens.push({ text: whole, kind: 'number' })
    else tokens.push({ text: whole, kind: 'literal' })
  }
  return tokens
}

// ---------------------------------------------------------------------------------------------
// The server list
// ---------------------------------------------------------------------------------------------

export type McpTone = 'danger' | 'warn' | 'busy' | 'ok' | 'idle'

export interface McpSummary {
  total: number
  connected: number
  tone: McpTone
  /** What the chip shows next to "MCP": the number connected, or `connected/total` when some are not. */
  label: string
  /** A sentence for a screen reader and a tooltip. */
  description: string
}

/** How the servers stand together, most pressing first: a failure, a sign-in needed, one connecting, one connected. */
export function mcpSummary(servers: readonly ChatMcpServer[]): McpSummary {
  const count = (status: ChatMcpServer['status']) => servers.filter((server) => server.status === status).length
  const connected = count('connected')
  const failed = count('failed')
  const needsAuth = count('needs-auth')
  const connecting = count('connecting')
  const total = servers.length
  const tone: McpTone = failed > 0 ? 'danger' : needsAuth > 0 ? 'warn' : connecting > 0 ? 'busy' : connected > 0 ? 'ok' : 'idle'
  const parts = [`${connected} connected`]
  if (connecting) parts.push(`${connecting} connecting`)
  if (failed) parts.push(`${failed} failed`)
  if (needsAuth) parts.push(`${needsAuth} need${needsAuth === 1 ? 's' : ''} a sign-in`)
  const disabled = count('disabled')
  if (disabled) parts.push(`${disabled} disabled`)
  return {
    total,
    connected,
    tone,
    label: connected === total ? String(total) : `${connected}/${total}`,
    description: `MCP servers: ${parts.join(', ')}`,
  }
}

export function mcpStatusLabel(status: ChatMcpServer['status']): string {
  switch (status) {
    case 'connected': return 'Connected'
    case 'connecting': return 'Connecting…'
    case 'disabled': return 'Disabled'
    case 'failed': return 'Failed'
    case 'needs-auth': return 'Sign-in needed'
    default: return 'Unknown'
  }
}

/** The command that signs a server in, quoted for a shell when the name needs it. It is shown, never run. */
export function mcpAuthCommand(name: string): string {
  const quoted = /^[A-Za-z0-9_.-]+$/.test(name) ? name : `'${name.replace(/'/g, "'\\''")}'`
  return `opencode mcp auth ${quoted}`
}

/** "3 calls", or "3+ calls" when older messages that are not loaded may hold more. */
export function callCountLabel(calls: number, complete: boolean): string {
  return `${calls}${complete ? '' : '+'} ${calls === 1 && complete ? 'call' : 'calls'}`
}

/** How long a script ran: `11 ms`, `1.2 s`, then as the rest of the app writes durations. */
export function scriptDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`
  return formatDuration(ms)
}
