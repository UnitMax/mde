import { randomUUID } from 'node:crypto'
import type {
  ChatAgent,
  ChatCreateRequest,
  ChatEvent,
  ChatFormReplyRequest,
  ChatMessagesPage,
  ChatMessagesRequest,
  ChatOptions,
  ChatOptionsRequest,
  ChatPermissionReplyRequest,
  ChatRequests,
  ChatSendRequest,
  InboxComposerState,
  InboxFolder,
  InboxFoldersState,
  InboxThread,
  OpenCodeModelRef,
  OpenCodePluginTarget,
  Session,
} from '@shared/types'
import type { OpenCodeServiceClient } from '../opencode/service/client'
import { serviceTargetKey } from '../opencode/service/discovery'
import {
  ServiceEventStreams,
  serviceEventSessionId,
  type ServiceEvent,
} from '../opencode/service/events'
import {
  parseActiveSessions,
  parseAgents,
  parseCreatedSession,
  parseDefaultModel,
  parseForms,
  parseMessagesPage,
  parseModels,
  parsePermissions,
  parseProviderNames,
  parseSessionInfo,
  parseSessionUsage,
} from '../opencode/service/parse'
import type { InboxRecorder } from './recorder'
import { isChatAgentId, type InboxStore } from './store'

export const CHAT_PAGE_SIZE = 50
export const CHAT_TEXT_MAX_LENGTH = 100_000
const OPTIONS_TTL_MS = 60_000
/**
 * OpenCode answers the first agent request for a folder it has not loaded yet with an empty list
 * (the models are fine), and the next request is complete. Ask a few more times before giving up.
 */
const AGENT_ATTEMPTS = 6
const AGENT_RETRY_MS = 250

export interface InboxChatDependencies {
  client: Pick<OpenCodeServiceClient, 'request' | 'openEvents' | 'reset'>
  store: InboxStore
  recorder: InboxRecorder
  /** Pushes a live change to the renderer. */
  send(event: ChatEvent): void
  /** Whether the Inbox can be used on this platform (macOS, or Windows with WSL). */
  enabled(): boolean
  now(): number
  createId?(): string
  /** Waits between agent list attempts; tests replace it. */
  sleep?(ms: number): Promise<void>
}

function folderName(directory: string): string {
  const parts = directory.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? directory
}

function modelBody(model: OpenCodeModelRef): { id: string; providerID: string; variant?: string } {
  return { id: model.id, providerID: model.providerId, ...(model.variant ? { variant: model.variant } : {}) }
}

function sameModel(a: OpenCodeModelRef | null, b: OpenCodeModelRef): boolean {
  return a?.id === b.id && a.providerId === b.providerId
}

/** Event types that change what the conversation shows. */
const MESSAGE_EVENTS = new Set([
  'session.inbox.delivered',
  'session.step.started',
  'session.step.ended',
  'session.text.started',
  'session.text.ended',
  'session.reasoning.started',
  'session.reasoning.ended',
  'session.tool.input.started',
  'session.tool.input.ended',
  'session.tool.called',
  'session.tool.progress',
  'session.tool.success',
  'session.tool.failed',
  'session.agent.selected',
  'session.model.selected',
  'session.compaction.started',
  'session.compaction.ended',
  'session.compaction.failed',
  'session.shell.started',
  'session.shell.ended',
  'session.retry.scheduled',
  'session.execution.succeeded',
  'session.execution.failed',
  'session.execution.interrupted',
])
const REQUEST_EVENTS = new Set(['permission.asked', 'permission.replied', 'form.created', 'form.replied', 'form.cancelled'])

/**
 * The Inbox chat GUI's main-process half. It owns the Inbox folders, talks to
 * the OpenCode background service of each folder's target, and keeps the
 * inbox record of chat threads current from the service's events. It never
 * reads or changes workspace projects or sessions.
 */
export class InboxChatService {
  private readonly streams: ServiceEventStreams
  private readonly subscribed = new Map<string, number>()
  private readonly options = new Map<string, { at: number; value: Promise<ChatOptions> }>()
  private configuredExecutable = 'opencode'

  constructor(private readonly dependencies: InboxChatDependencies) {
    this.streams = new ServiceEventStreams(dependencies.client, {
      onEvent: (_target, event) => this.onEvent(event),
      onConnected: (target, reconnected) => {
        if (!reconnected) return
        for (const threadId of this.subscribed.keys()) {
          const thread = this.dependencies.store.get(threadId)
          if (thread && serviceTargetKey(thread.target) === serviceTargetKey(target)) {
            this.dependencies.send({ type: 'reconnected', threadId })
          }
        }
      },
    })
  }

  /** Starts event streams for targets that have working threads, once the Inbox is usable. */
  start(): void {
    if (!this.dependencies.enabled()) return
    const targets = new Map<string, OpenCodePluginTarget>()
    for (const thread of this.dependencies.store.list()) {
      if (thread.status === 'working' || thread.status === 'attention') {
        targets.set(serviceTargetKey(thread.target), thread.target)
      }
    }
    for (const target of targets.values()) this.streams.ensure(target)
  }

  stop(): void {
    this.streams.stopAll()
  }

  /** The OpenCode executable from Settings; discovery runs it to find each service. */
  executable(): string {
    return this.configuredExecutable
  }

  /** A changed executable makes the next request rediscover each service. */
  configure(executable: string): void {
    if (executable === this.configuredExecutable) return
    this.configuredExecutable = executable
    this.dependencies.client.reset()
    this.options.clear()
  }

  folders(): InboxFoldersState {
    return { folders: this.dependencies.store.folders(), composer: this.dependencies.store.composer() }
  }

  /** Adds a folder the IPC layer already resolved and checked, or reuses the same one. */
  addFolder({ directory, target }: { directory: string; target: OpenCodePluginTarget }): InboxFolder {
    const now = this.dependencies.now()
    const existing = this.dependencies.store.folders().find((folder) =>
      folder.directory === directory && serviceTargetKey(folder.target) === serviceTargetKey(target))
    const folder: InboxFolder = existing
      ? { ...existing, lastUsedAt: now }
      : {
          id: `fld_${(this.dependencies.createId ?? randomUUID)()}`,
          name: folderName(directory),
          directory,
          target,
          createdAt: now,
          lastUsedAt: now,
        }
    this.dependencies.store.putFolder(folder)
    this.dependencies.store.setComposer({ ...this.dependencies.store.composer(), folderId: folder.id })
    return folder
  }

  removeFolder(id: string): void {
    this.dependencies.store.removeFolder(id)
  }

  setComposer(composer: InboxComposerState): InboxComposerState {
    const next: InboxComposerState = {
      ...(composer.folderId && this.dependencies.store.folder(composer.folderId) ? { folderId: composer.folderId } : {}),
      ...(composer.agent && isChatAgentId(composer.agent) ? { agent: composer.agent } : {}),
      ...(composer.model ? { model: composer.model } : {}),
    }
    this.dependencies.store.setComposer(next)
    return next
  }

  /** Agents and models where a folder or thread lives; cached for a minute per place. */
  async chatOptions(request: ChatOptionsRequest): Promise<ChatOptions> {
    const place = request.threadId ? this.thread(request.threadId) : this.folder(request.folderId ?? '')
    const key = `${serviceTargetKey(place.target)}\n${place.directory}`
    const cached = this.options.get(key)
    const now = this.dependencies.now()
    if (cached && now - cached.at < OPTIONS_TTL_MS) return cached.value
    const value = this.loadOptions(place)
    this.options.set(key, { at: now, value })
    value.catch(() => {
      if (this.options.get(key)?.value === value) this.options.delete(key)
    })
    return value
  }

  async create(request: ChatCreateRequest): Promise<InboxThread> {
    this.assertEnabled()
    const folder = this.folder(request.folderId)
    const text = this.promptText(request.text)
    if (!isChatAgentId(request.agent)) throw new Error('Choose an agent.')
    this.streams.ensure(folder.target)
    const created = parseCreatedSession(await this.dependencies.client.request(folder.target, 'session.create', {
      body: { agent: request.agent, model: modelBody(request.model), location: { directory: folder.directory } },
    }))
    const thread = this.dependencies.recorder.recordChatThread({
      id: created.id,
      title: created.title,
      folder,
      model: request.model,
    })
    this.dependencies.store.putFolder({ ...folder, lastUsedAt: this.dependencies.now() })
    this.dependencies.store.setComposer({ folderId: folder.id, agent: request.agent, model: request.model })
    try {
      await this.dependencies.client.request(folder.target, 'session.prompt', {
        params: { sessionID: created.id },
        body: { text },
      })
    } catch (error) {
      this.dependencies.recorder.markStatus(thread.id, 'idle')
      throw error
    }
    return this.dependencies.store.get(thread.id) ?? thread
  }

  async messages(request: ChatMessagesRequest): Promise<ChatMessagesPage> {
    const thread = this.thread(request.threadId)
    this.streams.ensure(thread.target)
    const query: Record<string, string> = { limit: String(CHAT_PAGE_SIZE) }
    if (request.cursor) query.cursor = request.cursor
    else query.order = 'desc'
    const [page, active, session] = await Promise.all([
      this.dependencies.client.request(thread.target, 'session.message.list', { params: { sessionID: thread.id }, query }),
      this.dependencies.client.request(thread.target, 'session.active'),
      // The thread's totals are only wanted with the newest page, and the conversation shows without them.
      request.cursor
        ? null
        : this.dependencies.client.request(thread.target, 'session.get', { params: { sessionID: thread.id } }).catch(() => null),
    ])
    const result = parseMessagesPage(page, parseActiveSessions(active).has(thread.id), CHAT_PAGE_SIZE)
    const usage = session ? parseSessionUsage(session) : null
    return usage ? { ...result, usage } : result
  }

  async send(request: ChatSendRequest): Promise<void> {
    this.assertEnabled()
    const thread = this.thread(request.threadId)
    const text = this.promptText(request.text)
    this.streams.ensure(thread.target)
    if (request.agent !== undefined || request.model !== undefined) {
      const session = parseSessionInfo(await this.dependencies.client.request(thread.target, 'session.get', {
        params: { sessionID: thread.id },
      }))
      if (request.agent !== undefined && request.agent !== session.agent) {
        if (!isChatAgentId(request.agent)) throw new Error('Choose an agent.')
        await this.dependencies.client.request(thread.target, 'session.switchAgent', {
          params: { sessionID: thread.id }, body: { agent: request.agent },
        })
      }
      if (request.model !== undefined && !sameModel(session.model, request.model)) {
        await this.dependencies.client.request(thread.target, 'session.switchModel', {
          params: { sessionID: thread.id }, body: { model: modelBody(request.model) },
        })
      }
      this.dependencies.store.setComposer({
        ...this.dependencies.store.composer(),
        ...(request.agent !== undefined ? { agent: request.agent } : {}),
        ...(request.model !== undefined ? { model: request.model } : {}),
      })
    }
    await this.dependencies.client.request(thread.target, 'session.prompt', {
      params: { sessionID: thread.id },
      body: { text },
    })
    this.dependencies.recorder.markStatus(thread.id, 'working')
  }

  async interrupt(threadId: string): Promise<void> {
    const thread = this.thread(threadId)
    await this.dependencies.client.request(thread.target, 'session.interrupt', { params: { sessionID: thread.id } })
  }

  async requests(threadId: string): Promise<ChatRequests> {
    const thread = this.thread(threadId)
    const [permissions, forms] = await Promise.all([
      this.dependencies.client.request(thread.target, 'session.permission.list', { params: { sessionID: thread.id } }),
      this.dependencies.client.request(thread.target, 'session.form.list', { params: { sessionID: thread.id } }),
    ])
    return { permissions: parsePermissions(permissions), forms: parseForms(forms) }
  }

  async replyPermission(request: ChatPermissionReplyRequest): Promise<void> {
    const thread = this.thread(request.threadId)
    await this.dependencies.client.request(thread.target, 'session.permission.reply', {
      params: { sessionID: thread.id, requestID: request.requestId },
      body: { decision: request.decision },
    })
  }

  async replyForm(request: ChatFormReplyRequest): Promise<void> {
    const thread = this.thread(request.threadId)
    await this.dependencies.client.request(thread.target, 'session.form.reply', {
      params: { sessionID: thread.id, formID: request.formId },
      body: { answer: request.answer },
    })
  }

  subscribe(threadId: string): void {
    const thread = this.thread(threadId)
    this.subscribed.set(threadId, (this.subscribed.get(threadId) ?? 0) + 1)
    this.streams.ensure(thread.target)
  }

  unsubscribe(threadId: string): void {
    const count = (this.subscribed.get(threadId) ?? 0) - 1
    if (count > 0) this.subscribed.set(threadId, count)
    else this.subscribed.delete(threadId)
  }

  private onEvent(event: ServiceEvent): void {
    this.dependencies.recorder.applyServiceEvent(event)
    const threadId = serviceEventSessionId(event)
    if (!threadId || !this.subscribed.has(threadId)) return
    if ((event.type === 'session.text.delta' || event.type === 'session.reasoning.delta')) {
      const { assistantMessageID: messageId, ordinal, delta } = event.data
      if (typeof messageId === 'string' && /^msg_[A-Za-z0-9_-]{1,200}$/.test(messageId) &&
        typeof ordinal === 'number' && Number.isInteger(ordinal) && ordinal >= 0 && ordinal < 10_000 &&
        typeof delta === 'string' && delta.length <= 1024 * 1024) {
        this.dependencies.send({
          type: 'delta',
          threadId,
          messageId,
          part: event.type === 'session.text.delta' ? 'text' : 'reasoning',
          ordinal,
          delta,
        })
      }
      return
    }
    if (event.type === 'session.execution.started') {
      this.dependencies.send({ type: 'running', threadId, running: true })
    }
    if (event.type === 'session.execution.succeeded' || event.type === 'session.execution.failed' ||
      event.type === 'session.execution.interrupted') {
      this.dependencies.send({ type: 'running', threadId, running: false })
    }
    if (MESSAGE_EVENTS.has(event.type)) this.dependencies.send({ type: 'messages', threadId })
    if (REQUEST_EVENTS.has(event.type)) this.dependencies.send({ type: 'requests', threadId })
  }

  private async loadOptions(folder: { target: OpenCodePluginTarget; directory: string }): Promise<ChatOptions> {
    const query = { 'location[directory]': folder.directory }
    const [providers, models, defaultModel] = await Promise.all([
      this.dependencies.client.request(folder.target, 'provider.list', { query }).catch(() => ({ data: [] })),
      this.dependencies.client.request(folder.target, 'model.list', { query }),
      this.dependencies.client.request(folder.target, 'model.default', { query }).catch(() => ({ data: null })),
    ])
    const agentList = await this.loadAgents(folder, query)
    return {
      agents: agentList,
      models: parseModels(models, parseProviderNames(providers)),
      defaultModel: parseDefaultModel(defaultModel),
      defaultAgent: agentList.find((agent) => agent.id === 'build')?.id ?? agentList[0]?.id ?? null,
    }
  }

  private async loadAgents(
    folder: { target: OpenCodePluginTarget },
    query: Record<string, string>,
  ): Promise<ChatAgent[]> {
    const sleep = this.dependencies.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    for (let attempt = 1; ; attempt += 1) {
      const agents = parseAgents(await this.dependencies.client.request(folder.target, 'agent.list', { query }))
      if (agents.length > 0) return agents
      if (attempt >= AGENT_ATTEMPTS) throw new Error('OpenCode has not finished loading this folder yet. Try again in a moment.')
      await sleep(AGENT_RETRY_MS)
    }
  }

  /**
   * The directory behind a folder or thread ID, shaped like a session so the file tree and viewer
   * can list and read it. Only the directory fields are meaningful; null for anything else.
   */
  fileRoot(id: string): Session | null {
    const source = id.startsWith('fld_')
      ? this.dependencies.store.folder(id)
      : id.startsWith('ses_') ? this.dependencies.store.get(id) : null
    if (!source) return null
    const target = source.target
    return {
      id,
      projectId: '',
      name: 'name' in source ? source.name : folderName(source.directory),
      kind: target.kind,
      ...(target.kind === 'wsl' ? { distro: target.distro } : {}),
      path: source.directory,
      createdAt: '',
    }
  }

  private folder(id: string): InboxFolder {
    const folder = this.dependencies.store.folder(id)
    if (!folder) throw new Error('This folder is no longer in the Inbox.')
    return folder
  }

  private thread(id: string): InboxThread {
    const thread = this.dependencies.store.get(id)
    if (!thread) throw new Error('This thread is no longer in the Inbox.')
    return thread
  }

  private promptText(text: string): string {
    if (!text.trim()) throw new Error('Type a message first.')
    if (text.length > CHAT_TEXT_MAX_LENGTH) throw new Error('The message is too long.')
    return text
  }

  private assertEnabled(): void {
    if (!this.dependencies.enabled()) throw new Error('The Inbox is only available on macOS and on Windows with WSL.')
  }
}
