import { GOAL_OBJECTIVE_LIMIT } from '@shared/goal'
import { MCP_SERVER_NAME } from '@shared/mcp'
import type {
  ChatAgent,
  ChatGoal,
  ChatGoalNote,
  ChatForm,
  ChatFormField,
  ChatFormOption,
  ChatMessage,
  ChatFilePatch,
  ChatMcpServer,
  ChatMcpStatus,
  ChatMessagesPage,
  ChatModel,
  ChatPart,
  ChatPendingMessage,
  ChatPermission,
  ChatRevert,
  ChatRevertFile,
  ChatSkill,
  ChatSkillUse,
  ChatTokens,
  ChatToolCall,
  ChatToolStatus,
  ChatUsage,
  OpenCodeModelRef,
} from '@shared/types'

/** Each tool input or output is cut to this many characters. */
export const CHAT_TOOL_TEXT_LIMIT = 64 * 1024
/** Assistant text and reasoning are cut far later; they are what the user reads. */
const CHAT_TEXT_LIMIT = 1024 * 1024
const SHORT = 512
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

type Json = Record<string, unknown>

export class ServiceShapeError extends Error {
  constructor(what: string) {
    super(`OpenCode sent ${what} MDE does not understand.`)
    this.name = 'ServiceShapeError'
  }
}

function record(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : null
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** A short single-line identifier or label; null when missing or malformed. */
function short(value: unknown, max = SHORT): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max || /[\u0000-\u001f\u007f-\u009f]/.test(trimmed)) return null
  return trimmed
}

/** Free text (messages, tool output): keeps newlines and tabs, drops other controls. */
function body(value: unknown, limit: number): { text: string; truncated: boolean } {
  const text = typeof value === 'string' ? value.replace(CONTROLS, '') : ''
  return text.length > limit
    ? { text: text.slice(0, limit), truncated: true }
    : { text, truncated: false }
}

/** Token counts and limits are whole numbers; anything else is treated as missing. */
const MAX_COUNT = 1e12

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_COUNT ? Math.floor(value) : undefined
}

function time(value: unknown): number {
  const created = record(value)?.created
  return typeof created === 'number' && Number.isFinite(created) && created >= 0 ? created : 0
}

export function parseModelRef(value: unknown): OpenCodeModelRef | null {
  const model = record(value)
  const id = short(model?.id)
  const providerId = short(model?.providerID)
  if (!id || !providerId) return null
  const variant = short(model?.variant)
  return { id, providerId, ...(variant && variant !== 'default' ? { variant } : {}) }
}

function data(value: unknown, what: string): unknown {
  const response = record(value)
  if (!response || !('data' in response)) throw new ServiceShapeError(what)
  return response.data
}

/** Primary agents that are not hidden: what the user can switch between. */
export function parseAgents(value: unknown): ChatAgent[] {
  const agents: ChatAgent[] = []
  const seen = new Set<string>()
  for (const item of list(data(value, 'an agent list'))) {
    const agent = record(item)
    const id = short(agent?.id)
    if (!agent || !id || seen.has(id) || agent.hidden === true) continue
    if (agent.mode !== 'primary' && agent.mode !== 'all') continue
    seen.add(id)
    const description = short(agent.description, 2000)
    const color = short(agent.color, 64)
    agents.push({
      id,
      name: short(agent.name) ?? id,
      ...(description ? { description } : {}),
      ...(color ? { color } : {}),
    })
  }
  return agents
}

/** One line of free text: runs of whitespace and control characters become a space, and long text is cut. */
function line(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ').trim()
  return text ? text.slice(0, max) : null
}

/** More skills than this are not offered; nobody scrolls that far. */
const SKILL_LIMIT = 500

/**
 * The skills a message can invoke. OpenCode also sends each skill's full text and file path; the picker
 * needs neither, so they stop here.
 */
export function parseSkills(value: unknown): ChatSkill[] {
  const skills: ChatSkill[] = []
  const seen = new Set<string>()
  for (const item of list(data(value, 'a skill list'))) {
    const skill = record(item)
    const id = short(skill?.id, 200)
    // `$id` ends at whitespace, so a name with a space or a `$` could never be written.
    if (!skill || !id || seen.has(id) || /[\s$]/.test(id)) continue
    seen.add(id)
    const description = line(skill.description, 400)
    skills.push({ id, name: line(skill.name, 200) ?? id, ...(description ? { description } : {}) })
    if (skills.length >= SKILL_LIMIT) break
  }
  return skills
}

const MCP_STATUSES: Record<string, ChatMcpStatus> = {
  connected: 'connected',
  pending: 'connecting',
  disabled: 'disabled',
  failed: 'failed',
  needs_auth: 'needs-auth',
}

/** More MCP servers than this are not listed. */
const MCP_LIMIT = 100

/**
 * A server's own error text, made fit to show: one line, with what could identify the user or let someone
 * in (credentials in a URL or header, long opaque tokens, the home directory) taken out. Cut to 300 characters.
 */
export function redactMcpError(value: unknown): string | undefined {
  const text = line(value, 2000)
  if (!text) return undefined
  return text
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, '$1')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#]*)[?#]\S*/gi, '$1')
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|token|secret|passwd|password|authorization)(\s*[=:]\s*)(?:Bearer\s+)?\S+/gi, '$1$2…')
    .replace(/\bBearer\s+\S+/gi, 'Bearer …')
    .replace(/(?:\/home|\/Users)\/[^/\s]+/g, '~')
    .replace(/\b[A-Za-z]:\\Users\\[^\\\s]+/gi, '~')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '…')
    .slice(0, 300)
}

/**
 * The MCP servers OpenCode has for a folder. Only the name, the display title and how it stands are kept:
 * the answer holds nothing else of use, and a server's command, URL, headers and environment are never asked for.
 * A name the OpenCode client would refuse to put in a URL is skipped, so every listed server can be switched.
 */
export function parseMcpServers(value: unknown): ChatMcpServer[] {
  const servers: ChatMcpServer[] = []
  const seen = new Set<string>()
  for (const item of list(data(value, 'an MCP server list'))) {
    const server = record(item)
    const name = server?.name
    if (!server || typeof name !== 'string' || !MCP_SERVER_NAME.test(name) || seen.has(name)) continue
    seen.add(name)
    const state = record(server.status)
    const status = (typeof state?.status === 'string' ? MCP_STATUSES[state.status] : undefined) ?? 'unknown'
    const error = status === 'failed' || status === 'needs-auth' ? redactMcpError(state?.error) : undefined
    const title = line(server.title, 200)
    servers.push({ name, ...(title && title !== name ? { title } : {}), status, ...(error ? { error } : {}) })
    if (servers.length >= MCP_LIMIT) break
  }
  return servers.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || (a.name < b.name ? -1 : 1))
}

/** The skills a user message invoked, by id and display name. */
function parseSkillUses(value: unknown): ChatSkillUse[] {
  const uses: ChatSkillUse[] = []
  const seen = new Set<string>()
  for (const item of list(value)) {
    const skill = record(item)
    const id = short(skill?.id, 200)
    if (!skill || !id || seen.has(id)) continue
    seen.add(id)
    uses.push({ id, name: short(skill.name, 200) ?? id })
    if (uses.length >= 20) break
  }
  return uses
}

export function parseProviderNames(value: unknown): Map<string, string> {
  const names = new Map<string, string>()
  for (const item of list(data(value, 'a provider list'))) {
    const provider = record(item)
    const id = short(provider?.id)
    if (id) names.set(id, short(provider?.name) ?? id)
  }
  return names
}

/** Enabled, non-deprecated models with only what the picker needs. */
export function parseModels(value: unknown, providers: Map<string, string>): ChatModel[] {
  const models: ChatModel[] = []
  const seen = new Set<string>()
  for (const item of list(data(value, 'a model list'))) {
    const model = record(item)
    const id = short(model?.id)
    const providerId = short(model?.providerID)
    if (!model || !id || !providerId || model.enabled === false || model.status === 'deprecated') continue
    const key = `${providerId}/${id}`
    if (seen.has(key)) continue
    seen.add(key)
    const limit = record(model.limit)
    const contextLimit = count(limit?.context)
    const outputLimit = count(limit?.output)
    models.push({
      id,
      providerId,
      providerName: providers.get(providerId) ?? providerId,
      name: short(model.name) ?? id,
      ...(contextLimit ? { contextLimit } : {}),
      ...(outputLimit ? { outputLimit } : {}),
    })
  }
  return models
}

export function parseDefaultModel(value: unknown): OpenCodeModelRef | null {
  const model = record(data(value, 'a default model'))
  if (!model) return null
  return parseModelRef({ id: model.id, providerID: model.providerID })
}

function errorText(value: unknown): string | undefined {
  const error = record(value)
  if (!error) return undefined
  const message = body(error.message, 4000).text.trim()
  return message || short(error.type) || 'Unknown error'
}

/** Tool input is shown as JSON; a still-streaming input arrives as a raw string. */
function toolInput(value: unknown): { text: string; truncated: boolean } {
  if (typeof value === 'string') return body(value, CHAT_TOOL_TEXT_LIMIT)
  if (value === undefined) return { text: '', truncated: false }
  let text: string
  try {
    text = JSON.stringify(value, null, 2) ?? ''
  } catch {
    text = ''
  }
  return body(text, CHAT_TOOL_TEXT_LIMIT)
}

function toolOutput(content: unknown): { text: string; truncated: boolean } {
  const texts: string[] = []
  for (const item of list(content)) {
    const entry = record(item)
    if (entry?.type === 'text' && typeof entry.text === 'string') texts.push(entry.text)
    else if (entry?.type === 'file') texts.push(`[file${short(entry.name) ? ` ${short(entry.name)}` : ''}]`)
  }
  return body(texts.join('\n'), CHAT_TOOL_TEXT_LIMIT)
}

/** A tool call shows at most this many changed files, and this much diff text in all. */
const MAX_PATCH_FILES = 20
const MAX_PATCH_TOTAL = 256 * 1024

/**
 * The diffs an edit tool reports in its metadata. OpenCode has sent them as `filediff` (one file)
 * and as `files` (a list); both hold the file's path and a unified diff.
 */
function parsePatches(metadata: Json | null): { patches: ChatFilePatch[]; truncated: boolean } {
  const entries = Array.isArray(metadata?.files) ? metadata.files : metadata?.filediff ? [metadata.filediff] : []
  const patches: ChatFilePatch[] = []
  let budget = MAX_PATCH_TOTAL
  let truncated = entries.length > MAX_PATCH_FILES
  for (const entry of entries.slice(0, MAX_PATCH_FILES)) {
    const file = record(entry)
    const path = short(file?.file, 4096)
    const patch = body(file?.patch, Math.min(CHAT_TOOL_TEXT_LIMIT, budget))
    if (!path || !patch.text.trim()) continue
    patches.push({ path, patch: patch.text })
    budget -= patch.text.length
    if (patch.truncated || budget <= 0) {
      truncated = true
      if (budget <= 0) break
    }
  }
  return { patches, truncated }
}

/** A Code Mode script makes at most 20 tool calls; each call's arguments and all of them together are cut. */
const MAX_TOOL_CALLS = 20
const MAX_CALL_INPUT = 4 * 1024
const MAX_CALLS_INPUT = 32 * 1024
const CALL_STATUSES: Record<string, ChatToolStatus> = {
  pending: 'pending',
  streaming: 'pending',
  running: 'running',
  completed: 'completed',
  success: 'completed',
  error: 'error',
  failed: 'error',
}

/**
 * The tools a Code Mode script called, from the tool part's metadata (`{ tool: 'server.name', status, input }`).
 * OpenCode reports no result or time per call. A call without a usable status takes the script's own.
 */
function parseToolCalls(metadata: Json | null, fallback: ChatToolStatus): ChatToolCall[] | undefined {
  const calls: ChatToolCall[] = []
  let budget = MAX_CALLS_INPUT
  for (const entry of list(metadata?.toolCalls).slice(0, MAX_TOOL_CALLS)) {
    const call = record(entry)
    const tool = short(call?.tool, 200)
    if (!call || !tool) continue
    let input = ''
    try {
      input = call.input === undefined ? '' : JSON.stringify(call.input) ?? ''
    } catch {
      input = ''
    }
    input = input.slice(0, Math.max(0, Math.min(MAX_CALL_INPUT, budget)))
    budget -= input.length
    const status = typeof call.status === 'string' ? CALL_STATUSES[call.status] : undefined
    calls.push({ tool, status: status ?? fallback, input })
  }
  return calls.length > 0 ? calls : undefined
}

/** How long a tool ran: from when it started running to when it finished. */
function toolDuration(value: unknown): number | undefined {
  const times = record(value)
  const ran = times?.ran
  const completed = times?.completed
  if (typeof ran !== 'number' || typeof completed !== 'number' || !Number.isFinite(ran) || !Number.isFinite(completed)) return undefined
  const duration = completed - ran
  return duration >= 0 && duration <= 7 * 24 * 60 * 60 * 1000 ? Math.round(duration) : undefined
}

function parsePart(value: unknown): ChatPart | null {
  const part = record(value)
  if (!part) return null
  if (part.type === 'text' || part.type === 'reasoning') {
    return { kind: part.type, text: body(part.text, CHAT_TEXT_LIMIT).text }
  }
  if (part.type !== 'tool') return null
  const id = short(part.id)
  const name = short(part.name, 200)
  const state = record(part.state)
  if (!id || !name || !state) return null
  const statuses: Record<string, ChatToolStatus> = {
    streaming: 'pending',
    running: 'running',
    completed: 'completed',
    error: 'error',
  }
  const status = typeof state.status === 'string' ? statuses[state.status] : undefined
  if (!status) return null
  const input = toolInput(state.input)
  const output = toolOutput(state.content)
  const error = status === 'error' ? errorText(state.error) : undefined
  const metadata = record(state.metadata)
  const childId = name === 'subagent'
    ? short(metadata?.sessionID) ?? /^\s*<subagent\b[^>]*\bsessionID="([^"]+)"/i.exec(output.text)?.[1]
      ?? /\(sessionID: ([^)]+)\)/.exec(error ?? '')?.[1]
    : undefined
  const sessionId = childId && /^ses_[A-Za-z0-9_-]{1,200}$/.test(childId) ? childId : undefined
  const changes = status === 'completed' ? parsePatches(metadata) : { patches: [], truncated: false }
  const calls = parseToolCalls(metadata, status)
  const durationMs = status === 'completed' || status === 'error' ? toolDuration(part.time) : undefined
  // OpenCode cuts a script's output itself and says so in the metadata.
  const cutByOpenCode = calls !== undefined && metadata?.truncated === true
  return {
    kind: 'tool',
    id,
    name,
    status,
    input: input.text,
    ...(output.text ? { output: output.text } : {}),
    ...(error ? { error } : {}),
    ...(input.truncated || output.truncated || changes.truncated || cutByOpenCode ? { truncated: true } : {}),
    ...(calls ? { calls } : {}),
    ...(sessionId ? { subagent: { sessionId } } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(changes.patches.length > 0 ? { patches: changes.patches } : {}),
    ...(status === 'completed' && typeof metadata?.exists === 'boolean' ? { existed: metadata.exists } : {}),
  }
}

/** OpenCode's `{ input, output, reasoning, cache: { read, write } }`; missing counts are 0. */
export function parseTokens(value: unknown): ChatTokens | undefined {
  const tokens = record(value)
  if (!tokens) return undefined
  const cache = record(tokens.cache)
  return {
    input: count(tokens.input) ?? 0,
    output: count(tokens.output) ?? 0,
    reasoning: count(tokens.reasoning) ?? 0,
    cacheRead: count(cache?.read) ?? 0,
    cacheWrite: count(cache?.write) ?? 0,
  }
}

function modelLabel(model: OpenCodeModelRef): string {
  return `${model.providerId}/${model.id}`
}

/** Maps one OpenCode message; types MDE does not show return null. */
export function parseMessage(value: unknown, thumbnail?: (bytes: Buffer) => string | undefined): ChatMessage | null {
  const message = record(value)
  const id = short(message?.id)
  if (!message || !id) return null
  const at = time(message.time)
  switch (message.type) {
    case 'user': {
      const skills = parseSkillUses(message.skills)
      return { kind: 'user', id, time: at, text: body(message.text, CHAT_TEXT_LIMIT).text, ...(skills.length ? { skills } : {}), ...(Array.isArray(message.files) && message.files.length ? { attachments: message.files.slice(0, 10).flatMap((raw, index) => {
        const file = record(raw)
        const mime = short(file?.mime, 200)
        if (!file || !mime || typeof file.data !== 'string' || file.data.length > 28 * 1024 * 1024) return []
        const bytes = Buffer.from(file.data, 'base64')
        let preview: string | undefined
        try { if (mime.startsWith('image/')) preview = thumbnail?.(bytes) } catch { /* A broken preview still shows its filename. */ }
        return [{ id: `${id}-${index}`, name: short(file.name) ?? 'Attachment', mime, size: bytes.length, ...(preview ? { thumbnail: preview } : {}) }]
      }) } : {}) }
    }
    case 'assistant': {
      const model = parseModelRef(message.model)
      if (!model) return null
      const parts = list(message.content).map(parsePart).filter((part): part is ChatPart => part !== null)
      const finished = record(message.time)?.completed
      const streamed = record(message.time)?.streamed
      const completed = typeof finished === 'number'
      const error = errorText(message.error)
      const tokens = parseTokens(message.tokens)
      return {
        kind: 'assistant',
        id,
        time: at,
        agent: short(message.agent) ?? 'agent',
        model,
        parts,
        completed,
        ...(completed && Number.isFinite(finished) && finished >= 0 ? { completedAt: finished } : {}),
        ...(typeof streamed === 'number' && Number.isFinite(streamed) && streamed >= 0 ? { streamedAt: streamed } : {}),
        ...(error ? { error } : {}),
        ...(tokens ? { tokens } : {}),
      }
    }
    case 'agent-switched': {
      const agent = short(message.agent)
      return agent ? { kind: 'note', id, time: at, tone: 'info', text: `Switched to the ${agent} agent` } : null
    }
    case 'model-switched': {
      const model = parseModelRef(message.model)
      return model ? { kind: 'note', id, time: at, tone: 'info', text: `Switched to ${modelLabel(model)}` } : null
    }
    case 'compaction': {
      const reason = message.reason === 'auto' ? 'auto' : 'manual'
      const automatic = reason === 'auto'
      if (message.status === 'running') {
        return {
          kind: 'note', id, time: at, tone: 'info', compaction: { status: 'running', reason },
          text: automatic ? 'Compacting the conversation automatically…' : 'Compacting the conversation…',
        }
      }
      if (message.status === 'failed') {
        const error = errorText(message.error)
        return {
          kind: 'note', id, time: at, tone: 'error', compaction: { status: 'failed', reason },
          text: error ? `Could not compact the conversation: ${error}` : 'Could not compact the conversation',
        }
      }
      const summary = body(message.summary, CHAT_TOOL_TEXT_LIMIT).text.trim()
      const written = message.status === 'completed' ? count(record(message.tokens)?.output) : undefined
      return {
        kind: 'note', id, time: at, tone: 'info',
        text: automatic ? 'Conversation compacted automatically' : 'Conversation compacted',
        ...(summary ? { detail: summary } : {}),
        // A status MDE does not know still shows the note, without the parts that depend on it.
        ...(message.status === 'completed' ? { compaction: { status: 'completed' as const, reason, ...(written ? { summaryTokens: written } : {}) } } : {}),
      }
    }
    case 'shell': {
      const command = body(message.command, 2000).text.trim()
      const output = body(record(message.output)?.output, CHAT_TOOL_TEXT_LIMIT).text
      return {
        kind: 'note', id, time: at, tone: 'info',
        text: command ? `Ran \`${command.split('\n')[0]}\`` : 'Ran a shell command',
        ...(output ? { detail: output } : {}),
      }
    }
    case 'skill': {
      const name = short(message.name) ?? short(message.skill)
      const text = body(message.text, CHAT_TOOL_TEXT_LIMIT).text.trim()
      return {
        kind: 'note', id, time: at, tone: 'info',
        text: name ? `Loaded the ${name} skill` : 'Loaded a skill',
        ...(text ? { detail: text } : {}),
      }
    }
    case 'synthetic':
    case 'system': {
      const text = body(message.text, CHAT_TOOL_TEXT_LIMIT).text
      const description = short(message.description, 500)
      // What a goal writes into the conversation reads as its own thing, not as "Added context".
      const goal = message.type === 'synthetic' && record(message.metadata)?.source === 'goal' ? goalNote(text) : null
      if (goal) return { kind: 'note', id, time: at, tone: 'info', ...goal }
      return text || description
        ? {
            kind: 'note', id, time: at, tone: 'info',
            text: description ?? (message.type === 'system' ? 'System note' : 'Added context'),
            ...(text ? { detail: text } : {}),
          }
        : null
    }
    case 'idle':
      if (message.outcome === 'failed') {
        return { kind: 'note', id, time: at, tone: 'error', text: errorText(message.error) ?? 'The run failed' }
      }
      if (message.outcome === 'interrupted') return { kind: 'note', id, time: at, tone: 'info', text: 'Stopped' }
      return null
    default:
      return null
  }
}

/**
 * The newest page arrives newest first; the GUI wants oldest first. OpenCode
 * returns a next cursor even on the last page, so a page shorter than `limit`
 * means there is nothing older.
 */
export function parseMessagesPage(value: unknown, running: boolean, limit: number, thumbnail?: (bytes: Buffer) => string | undefined): ChatMessagesPage {
  const response = record(value)
  if (!response || !Array.isArray(response.data)) throw new ServiceShapeError('a message list')
  const messages = response.data.map((message) => parseMessage(message, thumbnail)).filter((item): item is ChatMessage => item !== null).reverse()
  const next = record(response.cursor)?.next
  const older = typeof next === 'string' && /^[A-Za-z0-9_=.-]{1,2048}$/.test(next) && response.data.length >= limit ? next : null
  return { messages, older, running }
}

/** The most messages held for the agent that are shown; there is no sensible number past a handful. */
const MAX_PENDING = 50

/**
 * One item of the session inbox, which is what the service gives for a message it accepted: the answer
 * to a prompt, and each entry of the inbox list. Only the user's own messages are returned; the inbox
 * also holds work the agent queued for itself, which is not the reader's to see. The message keeps the
 * item's ID once it is delivered, so the two can be matched.
 */
export function parseInboxItem(value: unknown, thumbnail?: (bytes: Buffer) => string | undefined): ChatPendingMessage | null {
  const item = record(value)
  const payload = record(item?.payload)
  const delivery = item?.delivery
  // The ID is what a message is taken back by, so one that could not be sent back is not worth showing.
  if (!item || item.type !== 'user' || !payload || (delivery !== 'steer' && delivery !== 'queue')) return null
  if (typeof item.id !== 'string' || !/^msg_[A-Za-z0-9_-]{1,200}$/.test(item.id)) return null
  const message = parseMessage({ ...payload, id: item.id, time: item.time, type: 'user' }, thumbnail)
  return message?.kind === 'user' ? { id: message.id, delivery, message } : null
}

/** The answer to a prompt: the message as the service took it, or null when the answer is not one. */
export function parsePromptAnswer(value: unknown, thumbnail?: (bytes: Buffer) => string | undefined): ChatPendingMessage | null {
  return parseInboxItem(record(value)?.data, thumbnail)
}

/**
 * The text `session.generate` wrote: the answer to a side question. It is trimmed and, like any text from
 * the service, stripped of control characters and cut at the chat text limit. An answer with no `text` is
 * not one, and an empty text is returned empty so that the caller can say so.
 */
export function parseGeneratedText(value: unknown): string {
  const generated = record(data(value, 'an answer'))
  if (!generated || typeof generated.text !== 'string') throw new ServiceShapeError('an answer')
  return body(generated.text, CHAT_TEXT_LIMIT).text.trim()
}

/**
 * Whether the session inbox holds a compaction, which is asked for while the agent is busy and runs when it is
 * done. It is not one of the user's messages, so the list above leaves it out.
 */
export function holdsCompaction(value: unknown): boolean {
  const response = record(value)
  return Array.isArray(response?.data) && response.data.some((item) => record(item)?.type === 'compaction')
}

/** The session inbox: what the service holds for the agent, oldest first. */
export function parsePendingMessages(value: unknown, thumbnail?: (bytes: Buffer) => string | undefined): ChatPendingMessage[] {
  const response = record(value)
  if (!response || !Array.isArray(response.data)) throw new ServiceShapeError('an inbox list')
  return response.data.flatMap((item) => parseInboxItem(item, thumbnail) ?? []).slice(0, MAX_PENDING)
}

/** What a message list says about where turns begin and end, newest first. */
export interface TurnMarker {
  id: string
  kind: 'user' | 'idle' | 'other'
  /** The text of a user message. */
  text?: string
}

/**
 * One page of the message list reduced to turn markers, newest first as the list is read. A user
 * message starts a turn and an `idle` message, which OpenCode writes when the agent stops, ends one;
 * everything else is `other`. Messages without a usable ID are skipped.
 */
export function parseTurnMarkers(value: unknown): { markers: TurnMarker[]; next: string | null; count: number } {
  const response = record(value)
  if (!response || !Array.isArray(response.data)) throw new ServiceShapeError('a message list')
  const markers: TurnMarker[] = []
  for (const raw of response.data) {
    const message = record(raw)
    const id = short(message?.id)
    if (!message || !id || !MESSAGE_ID.test(id)) continue
    if (message.type === 'user') markers.push({ id, kind: 'user', text: body(message.text, CHAT_TEXT_LIMIT).text })
    else markers.push({ id, kind: message.type === 'idle' ? 'idle' : 'other' })
  }
  const next = record(response.cursor)?.next
  return {
    markers,
    next: typeof next === 'string' && /^[A-Za-z0-9_=.-]{1,2048}$/.test(next) ? next : null,
    count: response.data.length,
  }
}

/**
 * The user message the agent's current turn began with, from markers read newest first: the oldest
 * user message after the last `idle`, or after nothing at all when the turn is the first. Null when
 * no user message started it, as when the run was resumed by the service itself.
 */
export function unfinishedTurnStart(markers: readonly TurnMarker[]): TurnMarker | null {
  let start: TurnMarker | null = null
  for (const marker of markers) {
    if (marker.kind === 'idle') break
    if (marker.kind === 'user') start = marker
  }
  return start
}

/** The session's running totals from a `session.get` answer; null when it has none. */
export function parseSessionUsage(value: unknown): ChatUsage | null {
  const session = record(record(value)?.data)
  const tokens = parseTokens(session?.tokens)
  if (!tokens) return null
  return { tokens, cost: typeof session?.cost === 'number' && Number.isFinite(session.cost) && session.cost >= 0 ? session.cost : 0 }
}

const MESSAGE_ID = /^msg_[A-Za-z0-9_-]{1,200}$/
/** A staged revert lists at most this many files; the rest are counted out. */
const MAX_REVERT_FILES = 200

function parseRevertFile(value: unknown): ChatRevertFile | null {
  const file = record(value)
  const path = short(file?.file, 4096)
  const status = file?.status
  if (!file || !path || (status !== 'added' && status !== 'deleted' && status !== 'modified')) return null
  return { path, status, additions: count(file.additions) ?? 0, deletions: count(file.deletions) ?? 0 }
}

/**
 * One revert as OpenCode reports it; null when there is none. A revert whose message ID is not one
 * MDE recognizes counts as none, so a change in OpenCode never hides the conversation.
 */
function parseRevert(value: unknown): ChatRevert | null {
  const revert = record(value)
  const messageId = short(revert?.messageID)
  if (!revert || !messageId || !MESSAGE_ID.test(messageId)) return null
  const files = list(revert.files)
    .slice(0, MAX_REVERT_FILES)
    .map(parseRevertFile)
    .filter((file): file is ChatRevertFile => file !== null)
  return { messageId, files }
}

/** The revert a `session.get` answer says is staged. */
export function parseSessionRevert(value: unknown): ChatRevert | null {
  return parseRevert(record(record(value)?.data)?.revert)
}

/** The revert a stage answer reports, which has the shape of the session's `revert` itself. */
export function parseStagedRevert(value: unknown): ChatRevert | null {
  return parseRevert(record(value)?.data)
}

export function parseActiveSessions(value: unknown): Set<string> {
  const active = record(data(value, 'an active session list'))
  const ids = new Set<string>()
  for (const [id, state] of Object.entries(active ?? {})) {
    if (/^ses_[A-Za-z0-9_-]{1,200}$/.test(id) && record(state)?.type === 'running') ids.add(id)
  }
  return ids
}

export function parsePermissions(value: unknown): ChatPermission[] {
  const permissions: ChatPermission[] = []
  for (const item of list(data(value, 'a permission list'))) {
    const request = record(item)
    const id = short(request?.id)
    const action = short(request?.action, 200)
    if (!request || !id || !/^per_[A-Za-z0-9_-]{1,200}$/.test(id) || !action) continue
    const resources = list(request.resources)
      .map((resource) => body(resource, 4096).text.trim())
      .filter(Boolean)
      .slice(0, 50)
    const message = body(request.message, 4000).text.trim()
    permissions.push({ id, action, resources, ...(message ? { message } : {}) })
  }
  return permissions
}

function parseOptions(value: unknown): ChatFormOption[] {
  const options: ChatFormOption[] = []
  for (const item of list(value).slice(0, 100)) {
    const option = record(item)
    const optionValue = typeof option?.value === 'string' && option.value.length <= 2000 ? option.value : null
    const label = short(option?.label, 500)
    if (optionValue === null || !label) continue
    const description = short(option?.description, 2000)
    options.push({ value: optionValue, label, ...(description ? { description } : {}) })
  }
  return options
}

function parseFormField(value: unknown): ChatFormField | 'skip' | null {
  const field = record(value)
  const key = short(field?.key, 200)
  if (!field || !key) return null
  if (field.hidden === true) return 'skip'
  const type = field.type
  if (type !== 'string' && type !== 'number' && type !== 'integer' && type !== 'boolean' && type !== 'multiselect') {
    return null
  }
  // Conditional fields would need OpenCode's rule engine; MDE leaves them to the terminal.
  if (Array.isArray(field.when) && field.when.length > 0) return null
  const title = short(field.title, 500)
  const description = short(field.description, 4000)
  const placeholder = short(field.placeholder, 500)
  return {
    key,
    type,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    required: field.required === true,
    options: parseOptions(field.options),
    custom: field.custom === true || (type === 'string' && !Array.isArray(field.options)),
    ...(placeholder ? { placeholder } : {}),
  }
}

export function parseForms(value: unknown): ChatForm[] {
  const forms: ChatForm[] = []
  for (const item of list(data(value, 'a question list'))) {
    const form = record(item)
    const id = short(form?.id)
    if (!form || !id || !/^frm_[A-Za-z0-9_-]{1,200}$/.test(id)) continue
    const fields: ChatFormField[] = []
    let unsupported = false
    for (const raw of list(form.fields).slice(0, 50)) {
      const field = parseFormField(raw)
      if (field === 'skip') continue
      if (field === null) unsupported = true
      else fields.push(field)
    }
    forms.push({ id, title: short(form.title, 500) ?? 'Question', fields, unsupported: unsupported || fields.length === 0 })
  }
  return forms
}

/** The new session's ID from a `session.create` answer. */
export function parseCreatedSession(value: unknown): { id: string; title: string | null } {
  const session = record(data(value, 'a new session'))
  const id = short(session?.id)
  if (!id || !/^ses_[A-Za-z0-9_-]{1,200}$/.test(id)) throw new ServiceShapeError('a new session')
  return { id, title: short(session?.title, 512) }
}

export function parseSessionInfo(value: unknown): { agent: string | null; model: OpenCodeModelRef | null; title: string | null } {
  const session = record(data(value, 'a session'))
  return {
    agent: short(session?.agent),
    model: parseModelRef(session?.model),
    title: short(session?.title, 512),
  }
}

/** Only a confirmed child of the recorded thread may supply a subagent's model. */
export function parseSubagentModel(value: unknown, sessionId: string, parentId: string): OpenCodeModelRef | null {
  const session = record(data(value, 'a subagent session'))
  if (session?.id !== sessionId || session.parentID !== parentId) return null
  return parseModelRef(session.model)
}

const GOAL_STATUSES = new Set<ChatGoal['status']>(['active', 'paused', 'complete'])

/** Milliseconds since the epoch. Larger than any count, so it has its own bound (year 5138). */
function timestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e14 ? Math.floor(value) : undefined
}

/**
 * A goal as OpenCode's goal plugin keeps it. A value that is not one (no objective, a status MDE does not
 * know) is null, so a plugin that changes shape shows no goal instead of a wrong one.
 */
export function parseGoal(value: unknown): ChatGoal | null {
  const goal = record(value)
  if (!goal) return null
  const id = short(goal.id, 200)
  const objective = body(goal.objective, GOAL_OBJECTIVE_LIMIT * 2).text.trim()
  const status = goal.status
  if (!id || !objective || typeof status !== 'string' || !GOAL_STATUSES.has(status as ChatGoal['status'])) return null
  const rounds = count(goal.rounds)
  const maxRounds = count(goal.maxRounds)
  const stalls = count(goal.stalls)
  const updatedAt = timestamp(goal.updatedAt)
  const reason = body(goal.reason, 4000).text.trim()
  return {
    id,
    objective,
    status: status as ChatGoal['status'],
    ...(reason ? { reason } : {}),
    rounds: rounds ?? 0,
    maxRounds: maxRounds && maxRounds > 0 ? maxRounds : 50,
    ...(stalls ? { stalls } : {}),
    updatedAt: updatedAt ?? 0,
  }
}

/** The answer to the goal read: `{ output: goal | null }`. A shape that is neither is an error, not "no goal". */
export function parseGoalAnswer(value: unknown): ChatGoal | null {
  const answer = record(value)
  if (!answer || !('output' in answer)) throw new ServiceShapeError('a goal')
  return answer.output === null ? null : parseGoal(answer.output)
}

/** What a goal-change event says: the thread's new goal (null when it was cleared), or null when it is not one. */
export function parseGoalChange(event: { data: Record<string, unknown> }): { threadId: string; goal: ChatGoal | null } | null {
  const threadId = event.data.sessionID
  if (typeof threadId !== 'string' || !('goal' in event.data)) return null
  const goal = event.data.goal === null ? null : parseGoal(event.data.goal)
  // A goal MDE cannot read is not told as "cleared".
  return event.data.goal === null || goal ? { threadId, goal } : null
}

const OBJECTIVE_BLOCK = /<untrusted_objective>\n?([\s\S]*?)\n?<\/untrusted_objective>/

/** OpenCode escapes `&`, `<` and `>` in the objective it puts into its messages. */
function unescapeObjective(text: string): string {
  return text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
}

/**
 * The note for a message the goal plugin wrote. Its wording is OpenCode's, so what is read from it is
 * best effort: a message in a shape this does not know is `null` and shows as the generic note.
 * - the one that starts a goal carries the objective;
 * - the one that sends the agent back to work carries what the reviewer found missing, between the
 *   objective and "Take the next concrete step";
 * - a resumed goal sends that second kind with the user's resume as the finding.
 */
function goalNote(text: string): { text: string; detail?: string; goal: ChatGoalNote } | null {
  const objective = OBJECTIVE_BLOCK.exec(text)?.[1]
  const goalObjective = objective ? unescapeObjective(objective).trim() : ''
  if (text.startsWith('A goal is now active for this session')) {
    return { text: 'Goal set', ...(goalObjective ? { detail: goalObjective } : {}), goal: 'set' }
  }
  if (text.startsWith('Continue working toward the active goal')) {
    const after = text.slice(text.indexOf('</untrusted_objective>') + '</untrusted_objective>'.length)
    const found = after.slice(0, after.indexOf('Take the next concrete step') >= 0 ? after.indexOf('Take the next concrete step') : undefined).trim()
    const resumed = /\bThe user resumed the goal\.?/.test(found)
    if (resumed) return { text: 'Goal resumed', ...(goalObjective ? { detail: goalObjective } : {}), goal: 'resume' }
    return { text: 'Goal not met yet, working on it', ...(found ? { detail: found } : {}), goal: 'continue' }
  }
  return null
}
