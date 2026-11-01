import type {
  ChatAgent,
  ChatForm,
  ChatFormField,
  ChatFormValue,
  ChatMessage,
  ChatModel,
  ChatPart,
  ChatTokens,
  ChatUsage,
  OpenCodeModelRef,
} from '@shared/types'

/** Build first, then Plan, then any other agents alphabetically. */
export function orderAgents(agents: readonly ChatAgent[]): ChatAgent[] {
  const rank = (agent: ChatAgent): number => (agent.id === 'build' ? 0 : agent.id === 'plan' ? 1 : 2)
  return [...agents].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

export function modelKey(model: Pick<OpenCodeModelRef, 'id' | 'providerId'>): string {
  return `${model.providerId}/${model.id}`
}

export function sameModelRef(a: OpenCodeModelRef | null | undefined, b: OpenCodeModelRef | null | undefined): boolean {
  return Boolean(a && b && a.id === b.id && a.providerId === b.providerId)
}

export function findModel(models: readonly ChatModel[], ref: OpenCodeModelRef | null | undefined): ChatModel | undefined {
  return ref ? models.find((model) => model.id === ref.id && model.providerId === ref.providerId) : undefined
}

/** A readable name for a model, also when it is not in the current list. */
export function modelName(models: readonly ChatModel[], ref: OpenCodeModelRef | null | undefined): string {
  if (!ref) return 'Choose a model'
  return findModel(models, ref)?.name ?? ref.id
}

export interface ModelGroup {
  providerId: string
  providerName: string
  models: ChatModel[]
}

/**
 * Models grouped by provider for the picker. A query matches the model name,
 * its ID, or the provider name, word by word.
 */
export function groupModels(models: readonly ChatModel[], query: string): ModelGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const groups = new Map<string, ModelGroup>()
  for (const model of models) {
    const haystack = `${model.name} ${model.id} ${model.providerName} ${model.providerId}`.toLowerCase()
    if (!words.every((word) => haystack.includes(word))) continue
    let group = groups.get(model.providerId)
    if (!group) {
      group = { providerId: model.providerId, providerName: model.providerName, models: [] }
      groups.set(model.providerId, group)
    }
    group.models.push(model)
  }
  return [...groups.values()]
    .map((group) => ({ ...group, models: [...group.models].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.providerName.localeCompare(b.providerName))
}

/** The model and agent the composer starts with: the last choice if it still exists, else the defaults. */
export function initialChoice(
  options: { agents: ChatAgent[]; models: ChatModel[]; defaultModel: OpenCodeModelRef | null; defaultAgent: string | null },
  remembered: { agent?: string; model?: OpenCodeModelRef },
): { agent: string | null; model: OpenCodeModelRef | null } {
  const agent = remembered.agent && options.agents.some((item) => item.id === remembered.agent)
    ? remembered.agent
    : options.defaultAgent ?? orderAgents(options.agents)[0]?.id ?? null
  const rememberedModel = findModel(options.models, remembered.model)
  const model = rememberedModel
    ? { id: rememberedModel.id, providerId: rememberedModel.providerId }
    : options.defaultModel ?? (options.models[0] ? { id: options.models[0].id, providerId: options.models[0].providerId } : null)
  return { agent, model }
}

/** How full the context window is before the display turns amber and then red. */
export const CONTEXT_WARN_RATIO = 0.7
export const CONTEXT_DANGER_RATIO = 0.9

export type ContextTone = 'normal' | 'warn' | 'danger'

/** The gauge in the composer is this many segments, each worth an equal share of the window. */
export const CONTEXT_SEGMENTS = 5

/** How much of one gauge segment is lit, from 0 (dark) to 1 (full). */
export function segmentFill(ratio: number | null, index: number): number {
  if (ratio === null) return 0
  return Math.min(1, Math.max(0, ratio * CONTEXT_SEGMENTS - index))
}

export interface ContextUsage {
  /** Tokens the conversation held after the latest model step. */
  used: number
  /** That step's tokens by kind; they add up to `used`. */
  step: ChatTokens
  /** The model's context window, or null when OpenCode does not report one. */
  limit: number | null
  /** `used / limit`, which can pass 1; null without a limit. */
  ratio: number | null
  tone: ContextTone
  /** The most tokens one reply can have, when known. */
  outputLimit: number | null
  modelName: string | null
  /** The thread's totals, when OpenCode reported them. */
  thread: ChatUsage | null
}

/** What one step added up to: its whole prompt (cached or not) plus what the model wrote. */
export function stepContext(tokens: ChatTokens): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite
}

/** The newest finished step that reports tokens; a step still streaming has no count yet. */
export function latestStepTokens(messages: readonly ChatMessage[]): ChatTokens | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    if (message.kind === 'assistant' && message.completed && message.tokens && stepContext(message.tokens) > 0) {
      return message.tokens
    }
  }
  return null
}

export function contextTone(ratio: number | null): ContextTone {
  if (ratio === null) return 'normal'
  return ratio >= CONTEXT_DANGER_RATIO ? 'danger' : ratio >= CONTEXT_WARN_RATIO ? 'warn' : 'normal'
}

/**
 * How much of the context window the conversation fills, measured at its latest step. The window
 * is the chosen model's, so switching models in the composer shows the effect before sending.
 * Null until a step has finished: there is nothing to measure yet.
 */
export function contextUsage(input: {
  messages: readonly ChatMessage[]
  usage?: ChatUsage | null
  model?: ChatModel
}): ContextUsage | null {
  const step = latestStepTokens(input.messages)
  if (!step) return null
  const used = stepContext(step)
  const limit = input.model?.contextLimit ?? null
  const ratio = limit ? used / limit : null
  return {
    used,
    step,
    limit,
    ratio,
    tone: contextTone(ratio),
    outputLimit: input.model?.outputLimit ?? null,
    modelName: input.model?.name ?? null,
    thread: input.usage ?? null,
  }
}

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}

/** A short token count: 842, 4.2K, 42.3K, 412K, 1.05M. */
export function formatTokens(value: number): string {
  const tokens = Math.max(0, value)
  if (tokens < 1000) return String(Math.round(tokens))
  if (tokens < 999_500) {
    const thousands = tokens / 1000
    return `${thousands < 100 ? trimZeros(thousands.toFixed(1)) : Math.round(thousands)}K`
  }
  const millions = tokens / 1_000_000
  return `${trimZeros(millions.toFixed(millions < 10 ? 2 : 1))}M`
}

/** The exact count with thousands separators. */
export function formatExactTokens(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

/** "21%", "<1%" for a sliver, and "0%" for none. */
export function formatPercent(ratio: number): string {
  if (ratio <= 0) return '0%'
  if (ratio < 0.01) return '<1%'
  return `${Math.round(ratio * 100)}%`
}

/** US dollars: cents normally, four decimals for a fraction of a cent. */
export function formatCost(cost: number): string {
  const digits = cost > 0 && cost < 0.01 ? { minimumFractionDigits: 2, maximumFractionDigits: 4 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }
  return `$${cost.toLocaleString('en-US', digits)}`
}

export interface TurnDurations {
  /** How long each finished turn took in milliseconds, by the ID of the message it is shown under. */
  finished: Map<string, number>
  /**
   * When the turn still in progress began, on the service's clock; null when that turn is not in the
   * loaded messages or when nothing is in progress.
   */
  openSince: number | null
}

/**
 * How long each turn of the conversation took. A turn is a user message and everything after it up
 * to the next user message: the user's request, then the steps the agent took to answer it. It
 * began when the user sent the message and ended when its last step finished, so both times come
 * from the service's clock and the difference is right whatever this computer's clock says.
 *
 * The duration belongs under the turn's last step, ahead of any note about how the run ended. A turn
 * is left out when its start is not loaded, or when it has no finished step; one with a step still
 * running is the turn in progress.
 */
export function turnDurations(messages: readonly ChatMessage[]): TurnDurations {
  const finished = new Map<string, number>()
  let startedAt: number | null = null
  let endedAt: number | null = null
  let anchor: string | null = null
  let open = false

  const close = (): void => {
    if (startedAt !== null && anchor !== null && endedAt !== null && !open) finished.set(anchor, Math.max(0, endedAt - startedAt))
  }

  for (const message of messages) {
    if (message.kind === 'user') {
      close()
      // A message without a time (0) says nothing about when the turn began.
      startedAt = message.time > 0 ? message.time : null
      endedAt = null
      anchor = message.id
      open = false
    } else if (message.kind === 'assistant') {
      anchor = message.id
      if (message.completedAt === undefined) open = true
      else endedAt = Math.max(endedAt ?? 0, message.completedAt)
    }
  }
  close()
  return { finished, openSince: startedAt !== null && (open || endedAt === null) ? startedAt : null }
}

/** Text streamed for one part of a message that may not be fetched yet. */
export interface LivePart {
  messageId: string
  part: 'text' | 'reasoning'
  ordinal: number
  text: string
}

export function appendLive(
  live: readonly LivePart[],
  delta: { messageId: string; part: 'text' | 'reasoning'; ordinal: number; delta: string },
): LivePart[] {
  const index = live.findIndex((item) =>
    item.messageId === delta.messageId && item.part === delta.part && item.ordinal === delta.ordinal)
  if (index < 0) return [...live, { messageId: delta.messageId, part: delta.part, ordinal: delta.ordinal, text: delta.delta }]
  const next = [...live]
  next[index] = { ...live[index]!, text: live[index]!.text + delta.delta }
  return next
}

function nthPartIndex(parts: readonly ChatPart[], kind: 'text' | 'reasoning', ordinal: number): number {
  let seen = -1
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index]!.kind === kind && ++seen === ordinal) return index
  }
  return -1
}

/**
 * Lays streamed text over the fetched messages: a part already fetched shows
 * whichever text is longer, a part not fetched yet is appended, and a message
 * not fetched yet appears at the end.
 */
export function mergeLive(messages: readonly ChatMessage[], live: readonly LivePart[], fallback?: { agent: string; model: OpenCodeModelRef }): ChatMessage[] {
  if (live.length === 0) return messages as ChatMessage[]
  const result = [...messages]
  for (const item of live) {
    let index = result.findIndex((message) => message.id === item.messageId)
    if (index < 0) {
      if (!fallback) continue
      result.push({ kind: 'assistant', id: item.messageId, time: Date.now(), agent: fallback.agent, model: fallback.model, parts: [], completed: false })
      index = result.length - 1
    }
    const message = result[index]!
    if (message.kind !== 'assistant') continue
    const parts = [...message.parts]
    const at = nthPartIndex(parts, item.part, item.ordinal)
    if (at < 0) parts.push({ kind: item.part, text: item.text })
    else if ((parts[at] as { text: string }).text.length < item.text.length) parts[at] = { kind: item.part, text: item.text }
    result[index] = { ...message, parts }
  }
  return result
}

/** Drops streamed text the fetched messages have caught up with. */
export function pruneLive(messages: readonly ChatMessage[], live: readonly LivePart[]): LivePart[] {
  return live.filter((item) => {
    const message = messages.find((entry) => entry.id === item.messageId)
    if (!message || message.kind !== 'assistant') return true
    const at = nthPartIndex(message.parts, item.part, item.ordinal)
    return at < 0 || (message.parts[at] as { text: string }).text.length < item.text.length
  })
}

function parseInput(input: string): Record<string, unknown> {
  try {
    const value = JSON.parse(input) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** A path shown relative to the thread's folder when it lies inside it. */
export function displayPath(path: string, directory: string): string {
  const base = directory.replace(/[\\/]+$/, '')
  if (base && (path.startsWith(`${base}/`) || path.startsWith(`${base}\\`))) return path.slice(base.length + 1)
  return path
}

function firstLine(text: string, max = 80): string {
  const line = text.split('\n')[0] ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** One line describing a tool call, e.g. "Edited src/app.ts" or "Ran npm test". */
export function toolSummary(part: Extract<ChatPart, { kind: 'tool' }>, directory: string): string {
  const input = parseInput(part.input)
  const text = (key: string): string | null => (typeof input[key] === 'string' && input[key] ? input[key] as string : null)
  const path = text('path') ?? text('filePath') ?? text('file_path')
  const shown = path ? displayPath(path, directory) : null
  const done = part.status === 'completed' || part.status === 'error'
  switch (part.name) {
    case 'read':
      return shown ? `${done ? 'Read' : 'Reading'} ${shown}` : 'Read a file'
    case 'write':
      return shown ? `${done ? 'Wrote' : 'Writing'} ${shown}` : 'Wrote a file'
    case 'edit':
    case 'patch':
    case 'multiedit':
      return shown ? `${done ? 'Edited' : 'Editing'} ${shown}` : 'Edited files'
    case 'shell':
    case 'bash': {
      const command = text('command')
      return command ? `${done ? 'Ran' : 'Running'} ${firstLine(command)}` : 'Ran a command'
    }
    case 'glob':
    case 'grep':
    case 'search': {
      const pattern = text('pattern') ?? text('query')
      return pattern ? `Searched for ${firstLine(pattern, 60)}` : 'Searched files'
    }
    case 'list':
      return shown ? `Listed ${shown}` : 'Listed files'
    case 'webfetch':
    case 'fetch': {
      const url = text('url')
      return url ? `Fetched ${firstLine(url, 80)}` : 'Fetched a page'
    }
    case 'question':
      return 'Asked a question'
    case 'todowrite':
    case 'todo':
      return 'Updated the to-do list'
    case 'subagent':
      return text('description') ? `Subagent: ${firstLine(text('description')!, 70)}` : 'Ran a subagent'
    default:
      return part.name
  }
}

type ToolPart = Extract<ChatPart, { kind: 'tool' }>

/** OpenCode runs a subagent through its `subagent` tool. */
export function isSubagentCall(part: ChatPart): part is ToolPart {
  return part.kind === 'tool' && part.name === 'subagent'
}

export interface SubagentInfo {
  /** The kind of subagent, such as "explore" or "general". */
  agent: string | null
  /** The short title the agent gave the work. */
  title: string | null
  /** What the subagent was asked to do. */
  task: string | null
  state: 'starting' | 'running' | 'done' | 'interrupted' | 'failed'
  /** The reason it did not finish, with OpenCode's internal session ID removed. */
  problem: string | null
}

/** What a subagent call shows: who, what, and how it went. */
export function subagentInfo(part: ToolPart): SubagentInfo {
  const input = parseInput(part.input)
  const text = (key: string): string | null => (typeof input[key] === 'string' && input[key].trim() ? (input[key] as string).trim() : null)
  const problem = part.error?.replace(/\s*\(sessionID: [^)]*\)/g, '').trim() || null
  const state: SubagentInfo['state'] = part.status === 'completed'
    ? 'done'
    : part.status === 'error'
      ? /interrupt|abort|cancel/i.test(part.error ?? '') ? 'interrupted' : 'failed'
      : part.status === 'running' ? 'running' : 'starting'
  return { agent: text('agent'), title: text('description'), task: text('prompt'), state, problem }
}

/** OpenCode wraps a subagent's answer in a `<subagent …>` tag carrying its internal session ID; only the answer is shown. */
export function subagentResult(output: string): string {
  return output
    .replace(/^\s*<subagent\b[^>]*>\s*/i, '')
    .replace(/\s*<\/subagent>\s*$/i, '')
    .trim()
}

export type MessageBlock =
  | { kind: 'part'; part: ChatPart; index: number }
  | { kind: 'subagents'; parts: ToolPart[]; index: number }

/** Groups consecutive subagent calls so parallel work reads as one block. */
export function messageBlocks(parts: readonly ChatPart[]): MessageBlock[] {
  const blocks: MessageBlock[] = []
  parts.forEach((part, index) => {
    const last = blocks[blocks.length - 1]
    if (isSubagentCall(part)) {
      if (last?.kind === 'subagents') last.parts.push(part)
      else blocks.push({ kind: 'subagents', parts: [part], index })
    } else {
      blocks.push({ kind: 'part', part, index })
    }
  })
  return blocks
}

export type FormDraft = Record<string, ChatFormValue | undefined>

export function initialFormDraft(form: ChatForm): FormDraft {
  const draft: FormDraft = {}
  for (const field of form.fields) {
    if (field.type === 'multiselect') draft[field.key] = []
    else if (field.type === 'boolean') draft[field.key] = false
  }
  return draft
}

function fieldLabel(field: ChatFormField): string {
  return field.title ?? field.description ?? field.key
}

/** Turns a draft into an answer, or explains what is still missing. */
export function formAnswer(form: ChatForm, draft: FormDraft): { answer: Record<string, ChatFormValue> } | { error: string } {
  const answer: Record<string, ChatFormValue> = {}
  for (const field of form.fields) {
    const value = draft[field.key]
    if (field.type === 'number' || field.type === 'integer') {
      const text = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
      if (!text) {
        if (field.required) return { error: `Answer “${fieldLabel(field)}”.` }
        continue
      }
      const number = Number(text)
      if (!Number.isFinite(number) || (field.type === 'integer' && !Number.isInteger(number))) {
        return { error: `“${fieldLabel(field)}” needs ${field.type === 'integer' ? 'a whole number' : 'a number'}.` }
      }
      answer[field.key] = number
      continue
    }
    if (field.type === 'multiselect') {
      const values = Array.isArray(value) ? value : []
      if (values.length === 0 && field.required) return { error: `Choose at least one option for “${fieldLabel(field)}”.` }
      answer[field.key] = values
      continue
    }
    if (field.type === 'boolean') {
      answer[field.key] = value === true
      continue
    }
    const text = typeof value === 'string' ? value.trim() : ''
    if (!text) {
      // A question asked with options has to be answered even when OpenCode does not mark it required.
      if (field.required || field.options.length > 0) return { error: `Answer “${fieldLabel(field)}”.` }
      continue
    }
    answer[field.key] = text
  }
  return { answer }
}

/** Short label for a permission action, e.g. "read" → "Read". */
export function permissionTitle(action: string): string {
  const labels: Record<string, string> = {
    read: 'Read a file',
    edit: 'Edit files',
    write: 'Write a file',
    bash: 'Run a command',
    shell: 'Run a command',
    webfetch: 'Fetch a web page',
    external_directory: 'Work outside the folder',
  }
  return labels[action] ?? `Use ${action}`
}
