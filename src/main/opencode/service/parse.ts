import type {
  ChatAgent,
  ChatForm,
  ChatFormField,
  ChatFormOption,
  ChatMessage,
  ChatMessagesPage,
  ChatModel,
  ChatPart,
  ChatPermission,
  ChatTokens,
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
  return {
    kind: 'tool',
    id,
    name,
    status,
    input: input.text,
    ...(output.text ? { output: output.text } : {}),
    ...(error ? { error } : {}),
    ...(input.truncated || output.truncated ? { truncated: true } : {}),
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
export function parseMessage(value: unknown): ChatMessage | null {
  const message = record(value)
  const id = short(message?.id)
  if (!message || !id) return null
  const at = time(message.time)
  switch (message.type) {
    case 'user':
      return { kind: 'user', id, time: at, text: body(message.text, CHAT_TEXT_LIMIT).text }
    case 'assistant': {
      const model = parseModelRef(message.model)
      if (!model) return null
      const parts = list(message.content).map(parsePart).filter((part): part is ChatPart => part !== null)
      const completed = typeof record(message.time)?.completed === 'number'
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
    case 'compaction':
      return { kind: 'note', id, time: at, tone: 'info', text: 'Conversation compacted' }
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
      const name = short(message.name)
      return { kind: 'note', id, time: at, tone: 'info', text: name ? `Loaded the ${name} skill` : 'Loaded a skill' }
    }
    case 'synthetic':
    case 'system': {
      const text = body(message.text, CHAT_TOOL_TEXT_LIMIT).text
      const description = short(message.description, 500)
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
export function parseMessagesPage(value: unknown, running: boolean, limit: number): ChatMessagesPage {
  const response = record(value)
  if (!response || !Array.isArray(response.data)) throw new ServiceShapeError('a message list')
  const messages = response.data.map(parseMessage).filter((item): item is ChatMessage => item !== null).reverse()
  const next = record(response.cursor)?.next
  const older = typeof next === 'string' && /^[A-Za-z0-9_=.-]{1,2048}$/.test(next) && response.data.length >= limit ? next : null
  return { messages, older, running }
}

/** The session's running totals from a `session.get` answer; null when it has none. */
export function parseSessionUsage(value: unknown): ChatUsage | null {
  const session = record(record(value)?.data)
  const tokens = parseTokens(session?.tokens)
  if (!tokens) return null
  return { tokens, cost: typeof session?.cost === 'number' && Number.isFinite(session.cost) && session.cost >= 0 ? session.cost : 0 }
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
