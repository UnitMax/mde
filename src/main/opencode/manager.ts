import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { posix } from 'node:path'
import type {
  OpenCodeChatItem,
  OpenCodePermissionReply,
  OpenCodeReasoningMessage,
  OpenCodeStreamChunk,
  OpenCodeStreamItem,
  OpenCodeToolMessage,
  OpenCodeConversationResponse,
  OpenCodeContextUsage,
  OpenCodeGenerationStats,
  SendOpenCodeMessageResponse,
  OpenCodeSessionSummary,
  OpenCodeModelOption,
  OpenCodeModelSelection,
  OpenCodeSlashCommand,
  OpenCodeSubagent,
  OpenCodeSubagentStatus,
  OpenCodeRevertState,
  ListOpenCodeModelsResponse,
  ListOpenCodeSessionsResponse,
  Session
} from '@shared/types'
import { resolveWslHostAddress } from '../wsl/distros'
type OpenCodeSubagentStreamItem = Extract<OpenCodeStreamItem, { kind: 'subagent' }>
const SERVER_START_TIMEOUT_MS = 10_000
const REQUEST_TIMEOUT_MS = 120_000
const HISTORY_REQUEST_TIMEOUT_MS = 10_000
const MAX_DIAGNOSTIC_LENGTH = 1_000
const MAX_TOOL_OUTPUT_LENGTH = 4_000
const MAX_REASONING_LENGTH = 20_000

interface OpenCodeRuntime {
  child: ChildProcessWithoutNullStreams
  url: string
  openCodeSessionId: string | null
  models?: OpenCodeModelOption[]
  tracker?: OpenCodeStreamTracker
}

export interface OpenCodeEvents {
  onStream(chunk: OpenCodeStreamChunk): void
}

export function createOpenCodeLaunch(
  session: Session,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  wslHost?: string
): {
  file: string
  args: string[]
  options: { cwd?: string; env: NodeJS.ProcessEnv; windowsHide: true }
} {
  if (session.kind === 'wsl') {
    if (platform !== 'win32') {
      throw new Error('WSL OpenCode sessions can only be launched on Windows.')
    }
    if (!session.distro) {
      throw new Error(`WSL session "${session.name}" has no distro.`)
    }
    if (!wslHost) {
      throw new Error(`Could not determine the WSL network address for "${session.distro}".`)
    }

    // Run through a login Bash shell so OpenCode installations managed by
    // nvm/mise/bun/asdf are available on PATH inside the distro.
    return {
      file: 'wsl.exe',
      args: [
        '-d',
        session.distro,
        '--cd',
        session.path,
        '--',
        'bash',
        '-lic',
        `exec opencode serve --pure --hostname=${wslHost} --port=0`
      ],
      options: {
        env: { ...environment, WSL_UTF8: '1' },
        windowsHide: true
      }
    }
  }

  return {
    file: 'opencode',
    args: ['serve', '--pure', '--hostname=127.0.0.1', '--port=0'],
    options: { cwd: session.path, env: { ...environment }, windowsHide: true }
  }
}

/**
 * Splits an SSE byte buffer into complete frames, returning the trailing
 * partial frame so the caller can prepend it to the next chunk.
 */
export function parseSseFrames(buffer: string): { events: string[]; rest: string } {
  const frames = buffer.split(/\r?\n\r?\n/)
  const rest = frames.pop() ?? ''
  const events: string[] = []

  for (const frame of frames) {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (data) events.push(data)
  }

  return { events, rest }
}

/**
 * Turns OpenCode's part lifecycle events into renderer-safe live updates.
 *
 * Current OpenCode versions send `message.part.updated` with a cumulative
 * part snapshot and optional delta. Older versions also expose
 * `message.part.delta`; accepting both keeps the stream compatible while the
 * per-part snapshots prevent the same text from being appended twice.
 */
export class OpenCodeStreamTracker {
  private readonly partTypes = new Map<string, string>()
  private readonly partTexts = new Map<string, string>()
  private readonly messageRoles = new Map<string, string>()
  private readonly childSessions = new Set<string>()
  private readonly subagents = new Map<string, OpenCodeSubagent>()
  private readonly taskToSubagent = new Map<string, string>()
  private lastTextPartId: string | null = null
  private compactionActive = false
  private compactionAutomatic = true
  private localRequestActive = false

  constructor(private sessionId: string | null) {}

  setLocalRequestActive(active: boolean): void {
    this.localRequestActive = active
  }

  setSessionId(sessionId: string | null): void {
    if (this.sessionId === sessionId) return
    this.sessionId = sessionId
    this.partTypes.clear()
    this.partTexts.clear()
    this.messageRoles.clear()
    this.childSessions.clear()
    this.subagents.clear()
    this.taskToSubagent.clear()
    this.lastTextPartId = null
    this.compactionActive = false
    this.compactionAutomatic = true
  }

  /** Returns a normalized update for this event, or null if it is irrelevant. */
  accept(event: unknown): OpenCodeStreamItem | null {
    const payload = unwrapEvent(event)
    if (!isRecord(payload) || !isRecord(payload.properties)) return null
    const properties = payload.properties

    if (payload.type === 'session.compacted') {
      const sessionId = stringValue(properties.sessionID)
      if (sessionId !== this.sessionId) return null
      const automatic = this.compactionAutomatic
      this.compactionActive = false
      return { kind: 'compaction', status: 'completed', automatic }
    }

    if (payload.type === 'permission.replied') {
      const sessionId = stringValue(properties.sessionID)
      const requestId = stringValue(properties.permissionID) ?? stringValue(properties.requestID)
      if (!sessionId || !requestId || !this.childSessions.has(sessionId)) return null
      return this.updateSubagent(sessionId, 'working', { permissionResolved: requestId })
    }

    if (payload.type === 'permission.asked' || payload.type === 'permission.updated') {
      const requestId =
        typeof properties.requestID === 'string'
          ? properties.requestID
          : typeof properties.id === 'string'
            ? properties.id
            : undefined
      const permission =
        typeof properties.permission === 'string'
          ? properties.permission
          : typeof properties.type === 'string'
            ? properties.type
            : undefined
      const sessionId = properties.sessionID
      if (requestId === undefined || permission === undefined || typeof sessionId !== 'string') return null

      const patterns = Array.isArray(properties.patterns)
        ? properties.patterns.filter((pattern): pattern is string => typeof pattern === 'string')
        : typeof properties.pattern === 'string'
          ? [properties.pattern]
          : Array.isArray(properties.pattern)
            ? properties.pattern.filter((pattern): pattern is string => typeof pattern === 'string')
            : []
      const title = typeof properties.title === 'string' ? properties.title : undefined
      if (sessionId !== this.sessionId) {
        if (!this.childSessions.has(sessionId)) return null
        const subagent = this.updateSubagent(sessionId, 'waiting')
        if (!subagent || subagent.kind !== 'subagent') return null
        return {
          ...subagent,
          permission: { requestId, permission, patterns, ...(title ? { title } : {}) }
        }
      }
      return {
        kind: 'permission',
        requestId,
        permission,
        patterns,
        ...(title ? { title } : {})
      }
    }

    if (payload.type === 'message.updated' && isRecord(properties.info)) {
      const info = properties.info
      if (typeof info.id === 'string' && typeof info.role === 'string') {
        const messageSessionId = typeof info.sessionID === 'string' ? info.sessionID : this.sessionId
        if (messageSessionId) {
          this.messageRoles.set(`${messageSessionId}:${info.id}`, info.role)
        }
      }
      return null
    }

    if (payload.type === 'session.status' || payload.type === 'session.idle') {
      const sessionId = stringValue(properties.sessionID)
      if (!sessionId) return null
      const status =
        payload.type === 'session.idle'
          ? 'idle'
          : isRecord(properties.status) && typeof properties.status.type === 'string'
            ? properties.status.type
            : undefined
      if (sessionId === this.sessionId) {
        if (this.compactionActive && status === 'idle') {
          const automatic = this.compactionAutomatic
          this.compactionActive = false
          return { kind: 'compaction', status: 'completed', automatic }
        }
        if (this.localRequestActive) return null
        if (status === 'busy' || status === 'retry') return { kind: 'status', status: 'busy' }
        if (status === 'idle') return { kind: 'status', status: 'idle' }
        return null
      }
      if (!this.childSessions.has(sessionId)) return null
      if (status === 'idle') return this.updateSubagent(sessionId, 'completed')
      if (status === 'busy' || status === 'retry') return this.updateSubagent(sessionId, 'working')
      return null
    }

    if (payload.type === 'session.error') {
      const sessionId = stringValue(properties.sessionID)
      if (sessionId === this.sessionId && this.compactionActive) {
        const automatic = this.compactionAutomatic
        this.compactionActive = false
        return { kind: 'compaction', status: 'error', automatic }
      }
      if (!sessionId || !this.childSessions.has(sessionId)) return null
      return this.updateSubagent(sessionId, 'error')
    }

    if (payload.type === 'message.part.updated' && isRecord(properties.part)) {
      const part = properties.part
      if (typeof part.id !== 'string' || typeof part.type !== 'string') return null
      const partSessionId = typeof part.sessionID === 'string' ? part.sessionID : properties.sessionID
      if (typeof partSessionId !== 'string') return null
      const subagent = this.acceptTaskPart(part, partSessionId)
      if (subagent) return subagent
      if (partSessionId !== this.sessionId) return null
      if (part.type === 'compaction') {
        this.compactionActive = true
        this.compactionAutomatic = part.auto !== false
        return {
          kind: 'compaction',
          status: 'started',
          automatic: this.compactionAutomatic
        }
      }
      if (this.isUserMessage(partSessionId, part.messageID)) return null
      this.partTypes.set(part.id, part.type)

      if (part.type === 'text' || part.type === 'reasoning') {
        const firstSnapshot = !this.partTexts.has(part.id)
        const delta = this.textDelta(part.id, part.text, properties.delta)
        if (part.type === 'text') {
          if (!delta) return null
          const separator = this.lastTextPartId !== null && this.lastTextPartId !== part.id ? '\n\n' : ''
          this.lastTextPartId = part.id
          return { kind: 'text', partId: part.id, delta: `${separator}${delta}` }
        }

        const durationMs = partDuration(part)
        if (!delta && !firstSnapshot && durationMs === undefined) return null
        return {
          kind: 'reasoning',
          partId: part.id,
          delta,
          done: durationMs !== undefined,
          ...(durationMs === undefined ? {} : { durationMs })
        }
      }

      if (part.type === 'tool') return toStreamToolItem(part)
      return null
    }

    if (payload.type !== 'message.part.delta') return null
    if (properties.sessionID !== this.sessionId) return null
    if (typeof properties.sessionID !== 'string' || properties.sessionID !== this.sessionId) return null
    if (this.isUserMessage(properties.sessionID, properties.messageID)) return null
    if (properties.field !== 'text' || typeof properties.delta !== 'string') return null
    if (typeof properties.partID !== 'string') return null

    const partType = this.partTypes.get(properties.partID)
    if (partType !== 'text' && partType !== 'reasoning') return null
    const delta = this.textDelta(properties.partID, undefined, properties.delta)
    if (!delta) return null

    if (partType === 'text') {
      const separator = this.lastTextPartId !== null && this.lastTextPartId !== properties.partID ? '\n\n' : ''
      this.lastTextPartId = properties.partID
      return { kind: 'text', partId: properties.partID, delta: `${separator}${delta}` }
    }

    return { kind: 'reasoning', partId: properties.partID, delta, done: false }
  }

  private acceptTaskPart(part: Record<string, unknown>, partSessionId: string): OpenCodeStreamItem | null {
    if (part.type !== 'tool' || part.tool !== 'task' || typeof part.id !== 'string') return null

    const state = isRecord(part.state) ? part.state : {}
    const metadata = isRecord(state.metadata) ? state.metadata : {}
    const input = isRecord(state.input) ? state.input : {}
    const childSessionId = stringValue(metadata.sessionId) ?? stringValue(metadata.sessionID)
    const previousId = this.taskToSubagent.get(part.id)
    const subagentId = childSessionId ?? previousId ?? `task:${part.id}`
    const previous = previousId ? this.subagents.get(previousId) : undefined

    if (previousId && childSessionId && previousId !== childSessionId) {
      this.subagents.delete(previousId)
    }
    if (childSessionId) this.childSessions.add(childSessionId)
    this.taskToSubagent.set(part.id, subagentId)

    const description =
      stringValue(input.description) ??
      stringValue(metadata.description) ??
      stringValue(state.title) ??
      previous?.description ??
      'Subagent task'
    const agent = stringValue(input.subagent_type) ?? stringValue(metadata.subagent_type) ?? previous?.agent
    const background = metadata.background === true || previous?.background === true
    const rawStatus = stringValue(state.status)
    let status: OpenCodeSubagentStatus =
      rawStatus === 'error'
        ? 'error'
        : rawStatus === 'completed'
          ? background && childSessionId
            ? 'working'
            : 'completed'
          : 'working'

    if (previous?.status === 'waiting' && status === 'working') status = 'waiting'
    const updated = this.upsertSubagent(subagentId, {
      taskId: part.id,
      parentSubagentId:
        partSessionId !== this.sessionId && this.childSessions.has(partSessionId) ? partSessionId : undefined,
      description,
      ...(agent ? { agent } : {}),
      status,
      ...(background ? { background: true } : {})
    })
    return previousId && previousId !== subagentId ? { ...updated, replacesId: previousId } : updated
  }

  private upsertSubagent(
    id: string,
    update: Omit<Partial<OpenCodeSubagent>, 'id' | 'startedAt'> & Pick<OpenCodeSubagent, 'taskId' | 'description' | 'status'>
  ): OpenCodeSubagentStreamItem {
    const previous = this.subagents.get(id)
    const terminal = update.status === 'completed' || update.status === 'error' || update.status === 'cancelled'
    const subagent: OpenCodeSubagent = {
      id,
      taskId: update.taskId,
      description: update.description,
      status: update.status,
      startedAt: previous?.startedAt ?? Date.now(),
      ...(previous?.parentSubagentId === undefined && update.parentSubagentId === undefined
        ? {}
        : { parentSubagentId: update.parentSubagentId ?? previous?.parentSubagentId }),
      ...(update.agent ?? previous?.agent ? { agent: update.agent ?? previous?.agent } : {}),
      ...(update.background || previous?.background ? { background: true } : {}),
      ...(terminal ? { finishedAt: previous?.finishedAt ?? Date.now() } : {})
    }
    this.subagents.set(id, subagent)
    return { kind: 'subagent', subagent }
  }

  private updateSubagent(
    sessionId: string,
    status: OpenCodeSubagentStatus,
    extra: { permissionResolved?: string } = {}
  ): OpenCodeSubagentStreamItem | null {
    const current = this.subagents.get(sessionId)
    if (!current) return null
    if (current.status === 'error' || current.status === 'cancelled') return null
    if (current.status === 'completed' && status !== 'error') return null
    const next = this.upsertSubagent(sessionId, { ...current, status })
    return { ...next, ...extra }
  }

  private textDelta(partId: string, snapshot: unknown, delta: unknown): string {
    const previous = this.partTexts.get(partId) ?? ''
    if (typeof snapshot === 'string') {
      this.partTexts.set(partId, snapshot)
      if (snapshot.startsWith(previous)) return snapshot.slice(previous.length)
    }

    if (typeof delta !== 'string') return ''
    const next = `${previous}${delta}`
    this.partTexts.set(partId, next)
    return delta
  }

  private isUserMessage(sessionId: string, messageId: unknown): boolean {
    return typeof messageId === 'string' && this.messageRoles.get(`${sessionId}:${messageId}`) === 'user'
  }
}

interface OpenCodeSessionResponse {
  id: string
  title?: unknown
  directory?: unknown
  time?: unknown
  revert?: unknown
}

interface OpenCodeVcsResponse {
  branch?: unknown
}

interface OpenCodeProviderResponse {
  providers?: unknown
}

interface OpenCodePromptResponse {
  info: {
    id: string
    parentID?: string
    providerID?: string
    modelID?: string
    tokens?: unknown
    time?: unknown
    error?: unknown
  }
  parts: unknown
}

interface OpenCodeHistoryMessage {
  info: {
    id: string
    parentID?: string
    role?: string
    providerID?: string
    modelID?: string
    tokens?: unknown
    time?: unknown
  }
  parts: unknown
}

export function normalizeOpenCodeDirectory(value: string, caseInsensitive?: boolean): string {
  const normalized = posix.normalize(value.trim().replaceAll('\\', '/'))
  const withoutTrailingSlash = normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized
  const shouldFoldCase =
    caseInsensitive ?? (process.platform === 'win32' || /^[A-Za-z]:\//.test(withoutTrailingSlash))
  return shouldFoldCase
    ? withoutTrailingSlash.toLowerCase()
    : withoutTrailingSlash
}

function assertOpenCodeSessionSupported(session: Session): void {
  if (session.kind === 'native') return
  if (session.kind !== 'wsl') {
    throw new Error('OpenCode GUI integration does not support this session type.')
  }
  if (process.platform !== 'win32') {
    throw new Error('WSL OpenCode sessions can only be launched on Windows.')
  }
  if (!session.distro) {
    throw new Error(`WSL session "${session.name}" has no distro.`)
  }
}

function timestamp(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value).toISOString()
    : new Date(0).toISOString()
}

function toSessionSummary(value: OpenCodeSessionResponse): OpenCodeSessionSummary | null {
  if (typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.directory !== 'string') {
    return null
  }
  const time = isRecord(value.time) ? value.time : {}
  return {
    id: value.id,
    title: value.title,
    directory: value.directory,
    createdAt: timestamp(time.created),
    updatedAt: timestamp(time.updated)
  }
}

function toRevertState(value: unknown): OpenCodeRevertState | null {
  if (!isRecord(value) || typeof value.messageID !== 'string' || !value.messageID.trim()) return null
  return {
    messageID: value.messageID,
    ...(typeof value.partID === 'string' && value.partID.trim() ? { partID: value.partID } : {})
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** OpenCode returns VCS information only when the current project is Git-backed. */
export function isGitVcsResponse(value: unknown): boolean {
  return isRecord(value) && typeof value.branch === 'string'
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function unwrapEvent(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.payload)) return value
  return value.payload
}

function clip(value: string, maxLength = MAX_DIAGNOSTIC_LENGTH): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message
  return String(value)
}

/** Extracts the only content this prototype renders from an OpenCode response. */
export function extractTextParts(parts: unknown): string {
  if (!Array.isArray(parts)) return ''

  return parts
    .filter(
      (part): part is Record<string, unknown> =>
        isRecord(part) && part.type === 'text' && part.ignored !== true && typeof part.text === 'string'
    )
    .map((part) => part.text as string)
    .join('\n')
    .trim()
}

export function describeResponseParts(parts: unknown): string {
  if (!Array.isArray(parts) || parts.length === 0) return 'none'

  const types = new Set(
    parts.map((part) => (isRecord(part) && typeof part.type === 'string' ? part.type : 'unknown'))
  )
  return [...types].join(', ')
}

function toolStatus(value: unknown): OpenCodeToolMessage['status'] {
  if (value === 'pending' || value === 'running' || value === 'completed' || value === 'error') {
    return value
  }
  return 'error'
}

function partDuration(part: Record<string, unknown>): number | undefined {
  const time = isRecord(part.time) ? part.time : {}
  const start = typeof time.start === 'number' ? time.start : undefined
  const end = typeof time.end === 'number' ? time.end : undefined
  return start !== undefined && end !== undefined && end >= start ? end - start : undefined
}

function toStreamToolItem(part: Record<string, unknown>): OpenCodeStreamItem | null {
  if (typeof part.id !== 'string' || typeof part.tool !== 'string') return null

  const state = isRecord(part.state) ? part.state : {}
  const input = isRecord(state.input) ? state.input : {}
  const rawInput = typeof state.raw === 'string' && state.raw ? clip(state.raw, MAX_TOOL_OUTPUT_LENGTH) : undefined
  const title = typeof state.title === 'string' && state.title ? state.title : undefined
  const output = typeof state.output === 'string' ? clip(state.output, MAX_TOOL_OUTPUT_LENGTH) : undefined
  const error = typeof state.error === 'string' ? clip(state.error, MAX_TOOL_OUTPUT_LENGTH) : undefined
  const durationMs = partDuration(state)

  return {
    kind: 'tool',
    partId: part.id,
    tool: part.tool,
    status: toolStatus(state.status),
    input,
    ...(rawInput ? { rawInput } : {}),
    ...(title ? { title } : {}),
    ...(output ? { output } : {}),
    ...(error ? { error } : {}),
    ...(durationMs === undefined ? {} : { durationMs })
  }
}

function toToolMessage(part: Record<string, unknown>): OpenCodeToolMessage | null {
  if (typeof part.id !== 'string' || typeof part.tool !== 'string') return null

  const state = isRecord(part.state) ? part.state : {}
  const input = isRecord(state.input) ? state.input : {}
  const title = typeof state.title === 'string' && state.title ? state.title : undefined
  const output = typeof state.output === 'string' ? clip(state.output, MAX_TOOL_OUTPUT_LENGTH) : undefined
  const error = typeof state.error === 'string' ? clip(state.error, MAX_TOOL_OUTPUT_LENGTH) : undefined

  return {
    id: part.id,
    role: 'tool',
    tool: part.tool,
    status: toolStatus(state.status),
    input,
    ...(title ? { title } : {}),
    ...(output ? { output } : {}),
    ...(error ? { error } : {})
  }
}

function toReasoningMessage(part: Record<string, unknown>): OpenCodeReasoningMessage | null {
  if (typeof part.id !== 'string' || typeof part.text !== 'string') return null
  const text = part.text.trim()
  if (!text) return null

  // OpenCode only fills in `end` once the block is closed, so an in-flight
  // reasoning block simply carries no duration.
  const time = isRecord(part.time) ? part.time : {}
  const start = typeof time.start === 'number' ? time.start : undefined
  const end = typeof time.end === 'number' ? time.end : undefined
  const durationMs = start !== undefined && end !== undefined && end >= start ? end - start : undefined

  return {
    id: part.id,
    role: 'reasoning',
    text: clip(text, MAX_REASONING_LENGTH),
    ...(durationMs === undefined ? {} : { durationMs })
  }
}

/** Converts reasoning parts of a single message into renderer-safe chat items. */
export function extractReasoningMessages(parts: unknown): OpenCodeReasoningMessage[] {
  if (!Array.isArray(parts)) return []

  const messages: OpenCodeReasoningMessage[] = []
  for (const part of parts) {
    if (!isRecord(part) || part.type !== 'reasoning') continue
    const message = toReasoningMessage(part)
    if (message) messages.push(message)
  }
  return messages
}

/**
 * Converts reasoning and tool parts from the current OpenCode turn into
 * renderer-safe chat items, preserving the order the model produced them in.
 */
export function extractTurnItems(
  history: unknown,
  parentId: string,
  finalMessageId: string
): Array<OpenCodeToolMessage | OpenCodeReasoningMessage> {
  if (!Array.isArray(history)) return []

  const messages: Array<OpenCodeToolMessage | OpenCodeReasoningMessage> = []
  for (const entry of history) {
    if (!isRecord(entry) || !isRecord(entry.info)) continue
    if (
      entry.info.id === finalMessageId ||
      entry.info.parentID !== parentId ||
      entry.info.role !== 'assistant' ||
      !Array.isArray(entry.parts)
    ) {
      continue
    }

    for (const part of entry.parts) {
      if (!isRecord(part)) continue
      const message =
        part.type === 'tool'
          ? toToolMessage(part)
          : part.type === 'reasoning'
            ? toReasoningMessage(part)
            : null
      if (message) messages.push(message)
    }
  }

  return messages
}

/** Converts a complete OpenCode message history into GUI chat items. */
export function extractHistoryMessages(
  history: unknown,
  revert?: OpenCodeRevertState | null
): OpenCodeChatItem[] {
  if (!Array.isArray(history)) return []

  const messages: OpenCodeChatItem[] = []
  let reverted = false
  for (const entry of history) {
    if (!isRecord(entry) || !isRecord(entry.info) || !Array.isArray(entry.parts)) continue
    const info = entry.info
    if (typeof info.id !== 'string' || (info.role !== 'user' && info.role !== 'assistant')) continue

    if (reverted) break
    const isRevertTarget = revert?.messageID === info.id
    if (isRevertTarget && !revert?.partID) break

    if (info.role === 'user') {
      const text = extractTextParts(entry.parts)
      if (text && !isRevertTarget) messages.push({ id: info.id, role: 'user', text })
      if (isRevertTarget) reverted = true
      continue
    }

    for (const part of entry.parts) {
      if (!isRecord(part)) continue
      if (isRevertTarget && part.id === revert?.partID) {
        reverted = true
        break
      }
      if (part.type === 'text' && typeof part.id === 'string' && typeof part.text === 'string') {
        const text = part.text.trim()
        if (text && part.ignored !== true) messages.push({ id: part.id, role: 'assistant', text })
        continue
      }

      const item =
        part.type === 'tool'
          ? toToolMessage(part)
          : part.type === 'reasoning'
            ? toReasoningMessage(part)
            : null
      if (item) messages.push(item)
    }
  }

  return messages
}

export function createPromptBody(text: string, model: OpenCodeModelSelection): {
  model: OpenCodeModelSelection
  parts: Array<{ type: 'text'; text: string }>
} {
  return {
    model: {
      providerID: model.providerID,
      modelID: model.modelID,
      ...(model.variant ? { variant: model.variant } : {})
    },
    parts: [{ type: 'text', text }]
  }
}

export function createOpenCodeSessionOperationBody(model: OpenCodeModelSelection): {
  providerID: string
  modelID: string
} {
  return { providerID: model.providerID, modelID: model.modelID }
}

function modelKey(model: OpenCodeModelSelection): string {
  return `${model.providerID}/${model.modelID}${model.variant ? `#${model.variant}` : ''}`
}

function optionalBoolean(record: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    if (typeof record[key] === 'boolean') return record[key]
  }
  return undefined
}

interface ParsedTokenUsage {
  input: number
  cacheRead: number
  cacheWrite: number
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function parseTokenUsage(value: unknown): ParsedTokenUsage | null {
  if (!isRecord(value)) return null
  const input = finiteNumber(value.input)
  if (input === undefined) return null
  const cache = isRecord(value.cache) ? value.cache : {}
  return {
    input,
    cacheRead: finiteNumber(cache.read) ?? 0,
    cacheWrite: finiteNumber(cache.write) ?? 0
  }
}

interface ParsedGenerationUsage {
  output: number
  reasoning: number
}

function parseGenerationUsage(value: unknown): ParsedGenerationUsage | null {
  if (!isRecord(value)) return null
  const output = finiteNumber(value.output)
  const reasoning = finiteNumber(value.reasoning)
  if (output === undefined || reasoning === undefined) return null
  return { output, reasoning }
}

function generationDuration(value: unknown): number | null {
  if (!isRecord(value)) return null
  const time = value.time
  if (!isRecord(time)) return null
  const created = finiteNumber(time.created)
  const completed = finiteNumber(time.completed)
  if (created === undefined || completed === undefined || completed < created) return null
  return completed - created
}

/** Extracts exact output/reasoning usage and whole-turn timing for one assistant response. */
export function extractGenerationStats(
  history: unknown,
  finalMessageId?: string,
  fallbackInfo?: unknown
): OpenCodeGenerationStats | null {
  const entries = Array.isArray(history) ? history : []
  let selected: Record<string, unknown> | null = null

  for (const entry of entries) {
    if (!isRecord(entry) || !isRecord(entry.info) || entry.info.role !== 'assistant') continue
    if (finalMessageId) {
      if (entry.info.id === finalMessageId) {
        selected = entry
        break
      }
      continue
    }
    selected = entry
  }

  const info = selected && isRecord(selected.info) ? selected.info : isRecord(fallbackInfo) ? fallbackInfo : null
  if (!info) return null

  let usage: ParsedGenerationUsage | null = null
  if (selected && Array.isArray(selected.parts)) {
    let output = 0
    let reasoning = 0
    let foundStepUsage = false
    for (const part of selected.parts) {
      if (!isRecord(part) || part.type !== 'step-finish') continue
      const step = parseGenerationUsage(part.tokens)
      if (!step) continue
      foundStepUsage = true
      output += step.output
      reasoning += step.reasoning
    }
    if (foundStepUsage) usage = { output, reasoning }
  }
  usage ??= parseGenerationUsage(info.tokens)
  if (!usage) return null

  const durationMs = generationDuration(info)
  const totalTokens = usage.output + usage.reasoning
  return {
    outputTokens: usage.output,
    reasoningTokens: usage.reasoning,
    totalTokens,
    durationMs,
    tokensPerSecond:
      durationMs !== null && durationMs > 0 ? totalTokens / (durationMs / 1000) : null,
    timeToFirstTokenMs: null
  }
}

/**
 * Finds the latest assistant request reported by OpenCode and converts its
 * input usage into the context-window metric shown by the GUI.
 *
 * Cache read/write tokens are part of the model input, but are deliberately
 * taken from one latest assistant message rather than summed across the
 * session. OpenCode also stores cumulative session counters for statistics.
 */
export function extractContextUsage(history: unknown, models: OpenCodeModelOption[]): OpenCodeContextUsage | null {
  if (!Array.isArray(history)) return null

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]
    if (!isRecord(entry) || !isRecord(entry.info) || entry.info.role !== 'assistant') continue
    const providerID = stringValue(entry.info.providerID)
    const modelID = stringValue(entry.info.modelID)
    const tokens = parseTokenUsage(entry.info.tokens)
    if (!providerID || !modelID || !tokens) return null

    const model = models.find((option) => option.providerID === providerID && option.modelID === modelID)
    if (!model?.contextWindow || model.contextWindow <= 0) return null

    const usedTokens = tokens.input + tokens.cacheRead + tokens.cacheWrite
    return {
      usedTokens,
      contextWindow: model.contextWindow,
      percentage: (usedTokens / model.contextWindow) * 100,
      model: { providerID, modelID }
    }
  }

  return null
}

/** Normalizes the provider catalog returned by OpenCode into picker options. */
export function normalizeOpenCodeModels(payload: unknown): OpenCodeModelOption[] {
  const providers =
    isRecord(payload) && Array.isArray(payload.providers) ? payload.providers : Array.isArray(payload) ? payload : []
  const options: OpenCodeModelOption[] = []
  const seen = new Set<string>()

  for (const providerValue of providers) {
    if (!isRecord(providerValue) || !isRecord(providerValue.models)) continue
    const providerID = typeof providerValue.id === 'string' ? providerValue.id.trim() : ''
    if (!providerID) continue
    const providerName =
      typeof providerValue.name === 'string' && providerValue.name.trim()
        ? providerValue.name.trim()
        : providerID

    for (const [modelID, modelValue] of Object.entries(providerValue.models)) {
      if (!isRecord(modelValue) || !modelID.trim()) continue
      const modelName =
        typeof modelValue.name === 'string' && modelValue.name.trim() ? modelValue.name.trim() : modelID
      const limit = isRecord(modelValue.limit) ? modelValue.limit : {}
      const common = {
        providerID,
        providerName,
        modelID,
        modelName,
        ...(finiteNumber(limit.context) === undefined ? {} : { contextWindow: finiteNumber(limit.context) }),
        ...(optionalBoolean(modelValue, 'reasoning') === undefined
          ? {}
          : { reasoning: optionalBoolean(modelValue, 'reasoning') }),
        ...(optionalBoolean(modelValue, 'tool_call', 'toolCall') === undefined
          ? {}
          : { toolCall: optionalBoolean(modelValue, 'tool_call', 'toolCall') })
      }
      const add = (variant?: string): void => {
        const normalizedVariant = variant?.trim() || undefined
        const selection = { providerID, modelID, ...(normalizedVariant ? { variant: normalizedVariant } : {}) }
        const key = modelKey(selection)
        if (seen.has(key)) return
        seen.add(key)
        options.push({
          key,
          ...common,
          ...(normalizedVariant ? { variant: normalizedVariant, modelName: `${modelName} · ${normalizedVariant}` } : {})
        })
      }

      add()
      if (isRecord(modelValue.variants)) {
        for (const variant of Object.keys(modelValue.variants)) add(variant)
      }
    }
  }

  return options.sort((a, b) =>
    `${a.providerName}/${a.modelName}`.localeCompare(`${b.providerName}/${b.modelName}`)
  )
}

function modelSelectionMatches(option: OpenCodeModelOption, selection: OpenCodeModelSelection): boolean {
  return (
    option.providerID === selection.providerID &&
    option.modelID === selection.modelID &&
    option.variant === selection.variant
  )
}

/** The OpenCode SDK uses this same startup marker for `opencode serve`. */
export function parseServerUrl(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^opencode server listening on\s+(https?:\/\/\S+)/i)
    if (match?.[1]) return match[1]
  }
  return null
}

/** Replaces a WSL server's announced host with the address reachable from Windows. */
export function serverUrlForHost(url: string, host: string): string {
  const parsed = new URL(url)
  parsed.hostname = host
  return parsed.origin
}

function terminationError(error: unknown): Error {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined
  if (code === 'ENOENT') {
    return new Error('OpenCode CLI was not found on PATH. Install OpenCode and restart mde.')
  }
  return new Error(`Could not start OpenCode: ${errorMessage(error)}`)
}

async function requestJson<T>(
  url: string,
  path: string,
  body: unknown,
  timeoutMs: number,
  method: 'GET' | 'POST' = 'POST'
): Promise<T> {
  let response: Response
  try {
    const serializedBody = body === undefined ? undefined : JSON.stringify(body)
    response = await fetch(`${url}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(serializedBody === undefined ? {} : { body: serializedBody }),
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (error) {
    const message = errorMessage(error)
    if (message.includes('timeout') || message.includes('aborted')) {
      throw new Error('OpenCode did not respond within two minutes.')
    }
    throw new Error(`OpenCode request failed (${url}${path}): ${message}`)
  }

  const text = await response.text()
  if (!response.ok) {
    if (response.status === 409) throw new Error('OpenCode is busy. Wait until the current operation is idle and try again.')
    throw new Error(`OpenCode request failed (${response.status}): ${clip(text)}`)
  }

  if (!text.trim()) return undefined as T

  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('OpenCode returned an invalid response.')
  }
}

function providerError(error: unknown): string {
  if (isRecord(error) && isRecord(error.data) && typeof error.data.message === 'string') {
    return error.data.message
  }
  return 'OpenCode could not generate a response. Confirm OpenCode Zen is logged in with `opencode providers login`.'
}

/**
 * Runs one local OpenCode server for each MDE session. The server and
 * OpenCode session live only for this MDE process; no credentials cross the
 * Electron boundary.
 */
export class OpenCodeManager {
  private readonly runtimes = new Map<string, OpenCodeRuntime>()
  private readonly starting = new Map<string, Promise<OpenCodeRuntime>>()
  private readonly children = new Map<string, ChildProcessWithoutNullStreams>()
  private readonly pending = new Set<string>()
  private readonly streams = new Map<string, AbortController>()

  constructor(private readonly events?: OpenCodeEvents) {}

  async listSessions(session: Session): Promise<ListOpenCodeSessionsResponse> {
    assertOpenCodeSessionSupported(session)

    const runtime = await this.ensureRuntime(session)
    const undoSupported = await this.isUndoSupported(runtime)
    const response = await requestJson<OpenCodeSessionResponse[]>(
      runtime.url,
      `/session?roots=true&directory=${encodeURIComponent(session.path)}&limit=100`,
      undefined,
      HISTORY_REQUEST_TIMEOUT_MS,
      'GET'
    )
    const caseInsensitive = process.platform === 'win32' && session.kind === 'native'
    const directory = normalizeOpenCodeDirectory(session.path, caseInsensitive)
    const sessions = response
      .map(toSessionSummary)
      .filter((item): item is OpenCodeSessionSummary => item !== null)
      .filter((item) => normalizeOpenCodeDirectory(item.directory, caseInsensitive) === directory)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

    const selectedSessionId =
      runtime.openCodeSessionId && sessions.some((item) => item.id === runtime.openCodeSessionId)
        ? runtime.openCodeSessionId
        : sessions[0]?.id ?? null
    this.setActiveSession(runtime, selectedSessionId)

    return { sessions, selectedSessionId, undoSupported }
  }

  async listModels(session: Session): Promise<ListOpenCodeModelsResponse> {
    assertOpenCodeSessionSupported(session)

    const runtime = await this.ensureRuntime(session)
    const response = await requestJson<OpenCodeProviderResponse>(
      runtime.url,
      '/config/providers',
      undefined,
      HISTORY_REQUEST_TIMEOUT_MS,
      'GET'
    )
    const models = normalizeOpenCodeModels(response)
    runtime.models = models
    return { models }
  }

  async selectSession(session: Session, openCodeSessionId: string): Promise<OpenCodeConversationResponse> {
    assertOpenCodeSessionSupported(session)
    if (!openCodeSessionId.trim()) throw new Error('OpenCode session ID cannot be empty.')

    const runtime = await this.ensureRuntime(session)
    const available = await this.listSessions(session)
    const summary = available.sessions.find((item) => item.id === openCodeSessionId)
    if (!summary) throw new Error('That OpenCode conversation is not available for this folder.')
    if (!runtime.models) await this.listModels(session)

    this.setActiveSession(runtime, openCodeSessionId)
    return this.loadConversation(runtime, openCodeSessionId, summary)
  }

  async createSession(session: Session): Promise<OpenCodeConversationResponse> {
    assertOpenCodeSessionSupported(session)

    const runtime = await this.ensureRuntime(session)
    const created = await requestJson<OpenCodeSessionResponse>(
      runtime.url,
      '/session',
      { title: session.name },
      SERVER_START_TIMEOUT_MS
    )
    if (!created.id) throw new Error('OpenCode did not create a session.')

    const summary = toSessionSummary(created)
    this.setActiveSession(runtime, created.id)
    const undoSupported = await this.isUndoSupported(runtime)
    return {
      sessionId: created.id,
      ...(summary ? { session: summary } : {}),
      messages: [],
      revert: null,
      undoSupported,
      contextUsage: null
    }
  }

  async send(
    session: Session,
    text: string,
    model: OpenCodeModelSelection
  ): Promise<SendOpenCodeMessageResponse> {
    const prompt = text.trim()
    if (!prompt) throw new Error('Message cannot be empty.')
    assertOpenCodeSessionSupported(session)
    if (this.pending.has(session.id)) throw new Error('A message is already being sent for this session.')

    this.pending.add(session.id)
    let runtime: OpenCodeRuntime | undefined
    try {
      runtime = await this.ensureRuntime(session)
      if (!runtime.models) await this.listModels(session)
      if (!runtime.models?.some((option) => modelSelectionMatches(option, model))) {
        throw new Error('That model is no longer available. Refresh the model list and select another model.')
      }
      if (!runtime.openCodeSessionId) {
        await this.createSession(session)
      }
      const openCodeSessionId = runtime.openCodeSessionId
      if (!openCodeSessionId) throw new Error('OpenCode conversation is not selected.')
      runtime.tracker?.setLocalRequestActive(true)
      const response = await requestJson<OpenCodePromptResponse>(
        runtime.url,
        `/session/${encodeURIComponent(openCodeSessionId)}/message`,
        createPromptBody(prompt, model),
        REQUEST_TIMEOUT_MS
      )

      if (response.info.error) throw new Error(providerError(response.info.error))
      const reply = extractTextParts(response.parts)
      if (!reply) {
        throw new Error(`OpenCode returned no visible text (response parts: ${describeResponseParts(response.parts)}).`)
      }

      let turnItems: Array<OpenCodeToolMessage | OpenCodeReasoningMessage> = []
      let history: OpenCodeHistoryMessage[] | null = null
      if (response.info.parentID) {
        try {
          history = await requestJson<OpenCodeHistoryMessage[]>(
            runtime.url,
            `/session/${encodeURIComponent(openCodeSessionId)}/message`,
            undefined,
            HISTORY_REQUEST_TIMEOUT_MS,
            'GET'
          )
          turnItems = extractTurnItems(history, response.info.parentID, response.info.id)
        } catch {
          // The successful final response is still useful if history inspection fails.
        }
      }

      const generationStats = extractGenerationStats(
        history ?? [{ info: { ...response.info, role: 'assistant' }, parts: response.parts }],
        response.info.id,
        response.info
      )

      return {
        sessionId: openCodeSessionId,
        userMessageId: response.info.parentID ?? null,
        contextUsage: extractContextUsage(
          history ?? [{ info: { ...response.info, role: 'assistant' }, parts: response.parts }],
          runtime.models ?? []
        ),
        generationStats,
        messages: [
          ...turnItems,
          // Reasoning that belongs to the final message precedes its text.
          ...extractReasoningMessages(response.parts),
          { id: response.info.id, role: 'assistant', text: reply }
        ]
      }
    } finally {
      runtime?.tracker?.setLocalRequestActive(false)
      this.pending.delete(session.id)
    }
  }

  async executeCommand(
    session: Session,
    command: OpenCodeSlashCommand,
    model: OpenCodeModelSelection
  ): Promise<OpenCodeConversationResponse> {
    assertOpenCodeSessionSupported(session)

    if (this.pending.has(session.id)) {
      throw new Error('A message is already being sent for this session.')
    }

    this.pending.add(session.id)
    let runtime: OpenCodeRuntime | undefined
    try {
      runtime = await this.ensureRuntime(session)
      if (!runtime.models) await this.listModels(session)
      if (!runtime.models?.some((option) => modelSelectionMatches(option, model))) {
        throw new Error('That model is no longer available. Refresh the model list and select another model.')
      }
      if (!runtime.openCodeSessionId) {
        await this.createSession(session)
      }
      const openCodeSessionId = runtime.openCodeSessionId
      if (!openCodeSessionId) throw new Error('OpenCode conversation is not selected.')
      runtime.tracker?.setLocalRequestActive(true)

      if (command === 'init') {
        await requestJson<boolean>(
          runtime.url,
          `/session/${encodeURIComponent(openCodeSessionId)}/init`,
          createOpenCodeSessionOperationBody(model),
          REQUEST_TIMEOUT_MS
        )
      } else {
        await requestJson<boolean>(
          runtime.url,
          `/session/${encodeURIComponent(openCodeSessionId)}/summarize`,
          createOpenCodeSessionOperationBody(model),
          REQUEST_TIMEOUT_MS
        )
      }

      return this.loadConversation(runtime, openCodeSessionId, undefined, true)
    } finally {
      runtime?.tracker?.setLocalRequestActive(false)
      this.pending.delete(session.id)
    }
  }

  async revert(session: Session, messageId: string): Promise<OpenCodeConversationResponse> {
    assertOpenCodeSessionSupported(session)
    if (!messageId.trim()) throw new Error('OpenCode message ID cannot be empty.')

    const runtime = await this.ensureRuntime(session)
    const openCodeSessionId = runtime.openCodeSessionId
    if (!openCodeSessionId) throw new Error('OpenCode conversation is not selected.')
    if (!runtime.models) await this.listModels(session)
    if (!(await this.isUndoSupported(runtime))) {
      throw new Error('Undo is unavailable because this project is not a Git repository.')
    }

    await requestJson<unknown>(
      runtime.url,
      `/session/${encodeURIComponent(openCodeSessionId)}/revert`,
      { messageID: messageId },
      REQUEST_TIMEOUT_MS
    )
    const result = await this.loadConversation(runtime, openCodeSessionId)
    if (!result.revert) throw new Error('OpenCode did not create a rollback for that turn.')
    return result
  }

  async unrevert(session: Session): Promise<OpenCodeConversationResponse> {
    assertOpenCodeSessionSupported(session)

    const runtime = await this.ensureRuntime(session)
    const openCodeSessionId = runtime.openCodeSessionId
    if (!openCodeSessionId) throw new Error('OpenCode conversation is not selected.')
    if (!runtime.models) await this.listModels(session)
    if (!(await this.isUndoSupported(runtime))) {
      throw new Error('Redo is unavailable because this project is not a Git repository.')
    }

    await requestJson<unknown>(
      runtime.url,
      `/session/${encodeURIComponent(openCodeSessionId)}/unrevert`,
      undefined,
      REQUEST_TIMEOUT_MS
    )
    const result = await this.loadConversation(runtime, openCodeSessionId)
    if (result.revert) throw new Error('OpenCode did not restore the reverted turn.')
    return result
  }

  private async loadHistory(runtime: OpenCodeRuntime, openCodeSessionId: string): Promise<OpenCodeHistoryMessage[]> {
    return requestJson<OpenCodeHistoryMessage[]>(
      runtime.url,
      `/session/${encodeURIComponent(openCodeSessionId)}/message`,
      undefined,
      HISTORY_REQUEST_TIMEOUT_MS,
      'GET'
    )
  }

  private async loadConversation(
    runtime: OpenCodeRuntime,
    openCodeSessionId: string,
    summary?: OpenCodeSessionSummary,
    includeGenerationStats = false
  ): Promise<OpenCodeConversationResponse> {
    const [state, history, undoSupported] = await Promise.all([
      requestJson<OpenCodeSessionResponse>(
        runtime.url,
        `/session/${encodeURIComponent(openCodeSessionId)}`,
        undefined,
        HISTORY_REQUEST_TIMEOUT_MS,
        'GET'
      ),
      this.loadHistory(runtime, openCodeSessionId),
      this.isUndoSupported(runtime)
    ])
    const revert = toRevertState(state.revert)
    return {
      sessionId: openCodeSessionId,
      session: summary ?? toSessionSummary(state) ?? undefined,
      messages: extractHistoryMessages(history, revert),
      revert,
      undoSupported,
      contextUsage: extractContextUsage(history, runtime.models ?? []),
      ...(includeGenerationStats ? { generationStats: extractGenerationStats(history) } : {})
    }
  }

  private async isUndoSupported(runtime: OpenCodeRuntime): Promise<boolean> {
    try {
      const vcs = await requestJson<OpenCodeVcsResponse>(
        runtime.url,
        '/vcs',
        undefined,
        HISTORY_REQUEST_TIMEOUT_MS,
        'GET'
      )
      return isGitVcsResponse(vcs)
    } catch {
      return false
    }
  }

  private setActiveSession(runtime: OpenCodeRuntime, openCodeSessionId: string | null): void {
    runtime.openCodeSessionId = openCodeSessionId
    runtime.tracker?.setSessionId(openCodeSessionId)
  }

  async replyPermission(sessionId: string, requestId: string, reply: OpenCodePermissionReply): Promise<void> {
    const runtime = this.runtimes.get(sessionId)
    if (!runtime) throw new Error('OpenCode is not running for this session.')

    await requestJson<boolean>(
      runtime.url,
      `/permission/${encodeURIComponent(requestId)}/reply`,
      { reply },
      REQUEST_TIMEOUT_MS
    )
  }

  dispose(sessionId: string): void {
    this.streams.get(sessionId)?.abort()
    this.streams.delete(sessionId)
    this.runtimes.delete(sessionId)
    const child = this.children.get(sessionId)
    this.children.delete(sessionId)
    if (child && child.exitCode === null && child.signalCode === null) child.kill()
  }

  disposeAll(): void {
    for (const sessionId of [...this.children.keys()]) this.dispose(sessionId)
  }

  private async ensureRuntime(session: Session): Promise<OpenCodeRuntime> {
    const existing = this.runtimes.get(session.id)
    if (existing) return existing

    const starting = this.starting.get(session.id)
    if (starting) return starting

    const next = this.startRuntime(session)
    this.starting.set(session.id, next)
    try {
      const runtime = await next
      this.runtimes.set(session.id, runtime)
      return runtime
    } finally {
      this.starting.delete(session.id)
    }
  }

  private async startRuntime(session: Session): Promise<OpenCodeRuntime> {
    const wslHost =
      session.kind === 'wsl' && session.distro ? await resolveWslHostAddress(session.distro) : undefined
    const launch = createOpenCodeLaunch(session, process.env, process.platform, wslHost)
    const child = spawn(
      launch.file,
      launch.args,
      launch.options
    )
    this.children.set(session.id, child)

    try {
      const announcedUrl = await this.waitForServerUrl(child)
      const url = wslHost ? serverUrlForHost(announcedUrl, wslHost) : announcedUrl

      child.once('exit', () => {
        if (this.children.get(session.id) === child) this.children.delete(session.id)
        const runtime = this.runtimes.get(session.id)
        if (runtime?.child === child) this.runtimes.delete(session.id)
      })

      const runtime: OpenCodeRuntime = {
        child,
        url,
        openCodeSessionId: session.opencodeSessionId ?? null
      }
      // Awaited: the first prompt follows immediately, and its early deltas are
      // lost if the subscription is not live yet.
      if (this.events) await this.openEventStream(session.id, runtime)
      return runtime
    } catch (error) {
      this.dispose(session.id)
      throw error
    }
  }

  /**
   * Subscribes to the server's event bus. Resolves once the subscription is
   * live, because a prompt sent before then would generate its first deltas
   * with nobody listening. Streaming is a preview only: `send` still returns
   * the authoritative transcript, so any failure here is silent rather than
   * fatal.
   */
  private async openEventStream(sessionId: string, runtime: OpenCodeRuntime): Promise<void> {
    const controller = new AbortController()
    this.streams.get(sessionId)?.abort()
    this.streams.set(sessionId, controller)

    let response: Response
    try {
      response = await fetch(`${runtime.url}/event`, {
        headers: { accept: 'text/event-stream' },
        signal: controller.signal
      })
    } catch {
      this.streams.delete(sessionId)
      return
    }

    if (!response.ok || !response.body) {
      this.streams.delete(sessionId)
      return
    }

    void this.pumpEvents(sessionId, runtime, response, controller)
  }

  /** Drains the subscribed stream in the background for the runtime's lifetime. */
  private async pumpEvents(
    sessionId: string,
    runtime: OpenCodeRuntime,
    response: Response,
    controller: AbortController
  ): Promise<void> {
    const tracker = new OpenCodeStreamTracker(runtime.openCodeSessionId)
    runtime.tracker = tracker
    try {
      const decoder = new TextDecoder()
      let buffer = ''
      for await (const bytes of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(bytes, { stream: true })
        const { events, rest } = parseSseFrames(buffer)
        buffer = rest

        for (const raw of events) {
          let event: unknown
          try {
            event = JSON.parse(raw)
          } catch {
            continue
          }
          const item = tracker.accept(event)
          if (item) this.events?.onStream({ sessionId, item })
        }
      }
    } catch {
      // Aborted on dispose, or the server went away; the transcript still arrives.
    } finally {
      if (runtime.tracker === tracker) delete runtime.tracker
      if (this.streams.get(sessionId) === controller) this.streams.delete(sessionId)
    }
  }

  private waitForServerUrl(child: ChildProcessWithoutNullStreams): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = ''
      let settled = false
      const settle = (callback: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        child.stdout.off('data', onOutput)
        child.stderr.off('data', onOutput)
        callback()
      }
      const onOutput = (chunk: Buffer): void => {
        output = clip(`${output}${chunk.toString()}`)
        const url = parseServerUrl(output)
        if (url) settle(() => resolve(url))
      }
      const timeout = setTimeout(() => {
        settle(() => reject(new Error(`Timed out waiting for OpenCode to start. ${clip(output)}`)))
      }, SERVER_START_TIMEOUT_MS)

      child.stdout.on('data', onOutput)
      child.stderr.on('data', onOutput)
      child.once('error', (error) => settle(() => reject(terminationError(error))))
      child.once('exit', (code) => {
        settle(() => reject(new Error(`OpenCode exited before starting (code ${code ?? 'unknown'}). ${clip(output)}`)))
      })
    })
  }
}
