import type { ChatDraftRequest, ChatDraftKey } from '@shared/types'
import type { InboxDraftStore } from './drafts'
import { readSessionAttachment } from '../files/tree'
import { randomUUID } from 'node:crypto'
import type {
  ChatAgent,
  ChatCreateRequest,
  ChatDiscardPendingRequest,
  ChatEvent,
  ChatForkRequest,
  ChatForkResult,
  ChatFormReplyRequest,
  ChatMcpRequest,
  ChatMcpServer,
  ChatMcpSetRequest,
  ChatMcpState,
  ChatMessagesPage,
  ChatMessagesRequest,
  ChatOptions,
  ChatOptionsRequest,
  ChatPendingMessage,
  ChatPermissionReplyRequest,
  ChatRequests,
  ChatSetDeliveryRequest,
  ChatRevert,
  ChatRevertRequest,
  ChatSendRequest,
  ChatSkill,
  InboxComposerState,
  InboxFolder,
  InboxFoldersState,
  InboxGitInfo,
  InboxGitInfoRequest,
  InboxThread,
  OpenCodeModelRef,
  OpenCodePluginTarget,
  Session,
} from '@shared/types'
import { OpenCodeServiceError, type OpenCodeServiceClient } from '../opencode/service/client'
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
  parseMcpServers,
  parseMessagesPage,
  parseModels,
  parsePendingMessages,
  parsePermissions,
  parsePromptAnswer,
  parseProviderNames,
  parseSessionInfo,
  parseSessionRevert,
  parseStagedRevert,
  parseSessionUsage,
  parseSkills,
  parseTurnMarkers,
  unfinishedTurnStart,
  type TurnMarker,
} from '../opencode/service/parse'
import { skillMentions } from '@shared/skills'
import type { InboxRecorder } from './recorder'
import { isChatAgentId, type InboxStore } from './store'
import type { CreatedWorktree, InboxWorktrees } from './worktree'

export const CHAT_PAGE_SIZE = 50
export const CHAT_TEXT_MAX_LENGTH = 100_000
const OPTIONS_TTL_MS = 60_000
/**
 * OpenCode answers the first agent request for a folder it has not loaded yet with an empty list
 * (the models are fine), and the next request is complete. Ask a few more times before giving up.
 */
const AGENT_ATTEMPTS = 6
const AGENT_RETRY_MS = 250
/**
 * The same goes for skills: OpenCode's built-in ones are always there, so an empty list only means the
 * folder has not loaded yet. Unlike agents, an empty list at the end is not an error; skills are optional.
 */
const SKILL_ATTEMPTS = 4
/**
 * MCP servers behave the same way, but slower: a folder OpenCode has not loaded yet lists none, and the real list
 * took about three seconds to appear. A folder with no servers also lists none, so the wait is only paid for the
 * first answer of a place; after that an empty list is believed.
 */
const MCP_ATTEMPTS = 6
const MCP_RETRY_MS = 750
/**
 * OpenCode refuses to revert a conversation that is running, and an interrupt takes a moment to
 * land, so staging is tried again for a while: this many tries, this far apart (about ten seconds).
 */
const REVERT_ATTEMPTS = 40
const REVERT_RETRY_MS = 250
/** Pages of messages read to find where the agent's current turn began, at most. */
const TURN_SCAN_PAGES = 10

export interface InboxChatDependencies {
  drafts?: InboxDraftStore
  /** Git worktrees for threads; without it, worktree mode is unavailable. */
  worktrees?: Pick<InboxWorktrees, 'info' | 'create' | 'remove' | 'discard'>
  thumbnail?(bytes: Buffer): string | undefined
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
  // A message the agent has not taken up yet is shown apart from the conversation, so it changes too
  // when one is held, changes its way of delivery, is taken back, or is delivered.
  'session.inbox.enqueued',
  'session.inbox.delivery.changed',
  'session.inbox.cancelled',
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
  'session.skill.activated',
  'session.compaction.started',
  'session.compaction.ended',
  'session.compaction.failed',
  'session.shell.started',
  'session.shell.ended',
  'session.retry.scheduled',
  'session.execution.succeeded',
  'session.execution.failed',
  'session.execution.interrupted',
  // A staged revert hides messages without changing them, so the page has to be read again.
  'session.revert.staged',
  'session.revert.cleared',
  'session.revert.committed',
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
  /** Places (service + directory) whose MCP list has been answered once, so an empty one is believed. */
  private readonly mcpSettled = new Set<string>()
  private readonly mcpListing = new Map<string, Promise<ChatMcpState>>()
  private configuredExecutable = 'opencode'
  private readonly titleRegenerations = new Map<string, Promise<void>>()
  private readonly titleReads = new Map<string, { renamed: boolean }>()

  constructor(private readonly dependencies: InboxChatDependencies) {
    this.streams = new ServiceEventStreams(dependencies.client, {
      onEvent: (target, event) => this.onEvent(event, target),
      onConnected: (target, reconnected) => {
        if (!reconnected) return
        // Servers may have changed while the stream was down, whether or not a thread is open.
        this.dependencies.send({ type: 'mcp', target })
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
    this.mcpSettled.clear()
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
    const place = this.place(request)
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

  /**
   * The MCP servers OpenCode has for a folder or thread, and how each stands. Not cached: a server connects,
   * fails and is switched while the app is open. Asks at once are shared, because opening a thread, the window
   * gaining focus and an event can arrive together.
   */
  async mcpList(request: ChatMcpRequest): Promise<ChatMcpState> {
    this.assertEnabled()
    const place = this.place(request)
    const key = `${serviceTargetKey(place.target)}\n${place.directory}`
    const running = this.mcpListing.get(key)
    if (running) return running
    const listing: Promise<ChatMcpState> = this.loadMcp(place, key).finally(() => {
      if (this.mcpListing.get(key) === listing) this.mcpListing.delete(key)
    })
    this.mcpListing.set(key, listing)
    return listing
  }

  private async loadMcp(place: { target: OpenCodePluginTarget; directory: string }, key: string): Promise<ChatMcpState> {
    // MCP changes carry no session, so the stream that tells the app about them must run even with no thread open.
    this.streams.ensure(place.target)
    for (let attempt = 1; ; attempt += 1) {
      let servers: ChatMcpServer[]
      try {
        servers = parseMcpServers(await this.dependencies.client.request(place.target, 'mcp.list', {
          query: { 'location[directory]': place.directory },
        }))
      } catch (error) {
        // An OpenCode older than the MCP routes answers 404 without one of its own error types.
        if (error instanceof OpenCodeServiceError && error.status === 404 && !error.tag) return { servers: [], supported: false }
        throw error
      }
      if (servers.length > 0 || this.mcpSettled.has(key) || attempt >= MCP_ATTEMPTS) {
        this.mcpSettled.add(key)
        return { servers, supported: true }
      }
      await this.pause(MCP_RETRY_MS)
    }
  }

  /**
   * Connects or disconnects one MCP server for the running OpenCode, like the OpenCode TUI's list. OpenCode keeps
   * neither across a restart and MDE changes no configuration. Only a server OpenCode lists can be named, and one
   * waiting for a sign-in is left alone: connecting it could start a browser login on the OpenCode host.
   */
  async mcpSetEnabled(request: ChatMcpSetRequest): Promise<void> {
    this.assertEnabled()
    const place = this.place(request)
    const state = await this.mcpList(request)
    if (!state.supported) throw new Error('This OpenCode cannot turn MCP servers on or off. Update OpenCode.')
    const server = state.servers.find((entry) => entry.name === request.server)
    if (!server) throw new Error('That MCP server is not configured any more.')
    if (server.status === 'needs-auth') throw new Error('This MCP server needs a sign-in. Run `opencode mcp auth` for it in a terminal.')
    if (server.status === 'unknown') throw new Error('MDE does not know this MCP server’s state, so it leaves it alone.')
    const already = request.enabled ? server.status === 'connected' || server.status === 'connecting' : server.status === 'disabled'
    if (already) return
    try {
      await this.dependencies.client.request(place.target, request.enabled ? 'mcp.connect' : 'mcp.disconnect', {
        params: { server: server.name },
        query: { 'location[directory]': place.directory },
      })
    } catch (error) {
      if (error instanceof OpenCodeServiceError && error.status === 404) {
        throw new Error(error.tag === 'McpServerNotFoundError'
          ? 'That MCP server is not configured any more.'
          : 'This OpenCode cannot turn MCP servers on or off. Update OpenCode.')
      }
      throw error
    }
  }

  async draft(request: ChatDraftRequest, sourceSession?: Session) {
    this.assertEnabled()
    const [kind, id = ''] = request.key.split(':')
    if (kind === 'thread') this.thread(id)
    else this.folder(id)
    const store = this.dependencies.drafts
    if (!store) throw new Error('Draft storage is unavailable.')
    if (request.action === 'text') await store.text(request.key, request.text)
    if (request.action === 'prepend') await store.prepend(request.key, request.text)
    if (request.action === 'add') await store.add(request.key, request.name, request.mime, request.data)
    if (request.action === 'tree') {
      const source = sourceSession ?? this.fileRoot(request.sessionId)
      if (!source) throw new Error('Source folder no longer exists.')
      await store.add(request.key, request.path.split('/').at(-1)!, 'application/octet-stream', await readSessionAttachment(source, request.path))
    }
    if (request.action === 'remove') await store.remove(request.key, request.attachmentId)
    if (request.action === 'clear') await store.remove(request.key)
    return store.get(request.key)
  }

  async removeDraft(key: ChatDraftKey): Promise<void> { await this.dependencies.drafts?.remove(key) }

  async create(request: ChatCreateRequest): Promise<InboxThread> {
    this.assertEnabled()
    const folder = this.folder(request.folderId)
    // A worktree folder already is one: threads started in it run in it, and a new worktree is cut from the real folder.
    if (request.worktree && folder.worktree) throw new Error('This folder is already a worktree. Start the thread in it, or start a new worktree from the folder it came from.')
    const text = this.promptText(request.text, request.attachmentIds)
    if (!isChatAgentId(request.agent)) throw new Error('Choose an agent.')
    const files = request.attachmentIds?.length ? await this.dependencies.drafts?.files(`folder:${folder.id}`, request.attachmentIds, request.draftRevision) : undefined
    let place: CreatedWorktree | undefined
    if (request.worktree) {
      if (!this.dependencies.worktrees) throw new Error('Git worktrees are unavailable.')
      place = await this.dependencies.worktrees.create(folder, request.worktree.base, request.worktree.branch)
    }
    this.streams.ensure(folder.target)
    let created: ReturnType<typeof parseCreatedSession>
    let thread: InboxThread
    try {
      created = parseCreatedSession(await this.dependencies.client.request(folder.target, 'session.create', {
        body: { agent: request.agent, model: modelBody(request.model), location: { directory: place?.directory ?? folder.directory } },
      }))
      thread = this.dependencies.recorder.recordChatThread({
        id: created.id,
        title: created.title,
        folder,
        model: request.model,
        // A thread started in a worktree folder runs in it, and carries the folder's worktree record.
        ...(place ? { directory: place.directory, worktree: place.worktree } : folder.worktree ? { worktree: folder.worktree } : {}),
      })
    } catch (error) {
      // Nothing has run in the worktree, so it goes too rather than being left behind unused.
      if (place) await this.dependencies.worktrees?.discard(folder.target, place.worktree)
      throw error
    }
    this.dependencies.store.putFolder({ ...folder, lastUsedAt: this.dependencies.now() })
    if (place) this.addWorktreeFolder(folder, place)
    this.dependencies.store.setComposer({ folderId: folder.id, agent: request.agent, model: request.model })
    await this.dependencies.drafts?.move(`folder:${folder.id}`, `thread:${thread.id}`)
    try {
      await this.dependencies.client.request(folder.target, 'session.prompt', {
        params: { sessionID: created.id },
        body: await this.promptBody({ target: folder.target, directory: place?.directory ?? folder.directory }, text, files),
      })
    } catch (error) {
      this.dependencies.recorder.markStatus(thread.id, 'idle')
      if (this.dependencies.drafts) return { ...(this.dependencies.store.get(thread.id) ?? thread), sendError: 'Could not send the first message. Your draft has been kept; try sending again.' }
      throw error
    }
    await this.dependencies.drafts?.remove(`thread:${thread.id}`, undefined, request.draftRevision)
    return this.dependencies.store.get(thread.id) ?? thread
  }

  /** Whether a folder is a Git repository, its current branch, and the branches a worktree can start from. */
  async gitInfo(request: InboxGitInfoRequest): Promise<InboxGitInfo> {
    this.assertEnabled()
    const folder = this.folder(request.folderId)
    if (!this.dependencies.worktrees) return { repository: false, branch: null, branches: [] }
    return this.dependencies.worktrees.info(folder)
  }

  /**
   * Removes the worktree a thread runs in, unless another thread uses it or Git refuses. Once it is
   * gone, so is its entry in the folder chooser, whose directory no longer exists.
   */
  async removeThreadWorktree(id: string): Promise<void> {
    this.assertEnabled()
    const thread = this.thread(id)
    if (!this.dependencies.worktrees) throw new Error('Git worktrees are unavailable.')
    await this.dependencies.worktrees.remove(thread, this.dependencies.store.list())
    const root = thread.worktree?.root
    for (const folder of this.dependencies.store.folders()) {
      if (folder.worktree?.root !== root || serviceTargetKey(folder.target) !== serviceTargetKey(thread.target)) continue
      this.dependencies.store.removeFolder(folder.id)
      await this.removeDraft(`folder:${folder.id}`).catch(() => undefined)
    }
  }

  /** Lists a worktree that was just created in the folder chooser, so more threads can be started in it. */
  private addWorktreeFolder(source: InboxFolder, place: CreatedWorktree): void {
    const now = this.dependencies.now()
    this.dependencies.store.putFolder({
      id: `fld_${(this.dependencies.createId ?? randomUUID)()}`,
      name: `${source.name.slice(0, 200)} · ${place.worktree.branch}`,
      directory: place.directory,
      target: source.target,
      createdAt: now,
      lastUsedAt: now,
      worktree: place.worktree,
    })
  }

  async messages(request: ChatMessagesRequest): Promise<ChatMessagesPage> {
    const thread = this.thread(request.threadId)
    this.streams.ensure(thread.target)
    const query: Record<string, string> = { limit: String(CHAT_PAGE_SIZE) }
    if (request.cursor) query.cursor = request.cursor
    else query.order = 'desc'
    let pageSize = CHAT_PAGE_SIZE
    const loadPage = async (): Promise<unknown> => {
      try { return await this.dependencies.client.request(thread.target, 'session.message.list', { params: { sessionID: thread.id }, query: { ...query, limit: String(pageSize) } }) }
      catch (error) {
        if (!(error instanceof Error) || error.message !== 'The OpenCode service sent more data than MDE accepts.' || pageSize === 1) throw error
        pageSize = Math.max(1, Math.floor(pageSize / 2))
        return loadPage()
      }
    }
    // Read before the conversation: a message delivered in between is then in both, which the reader
    // sorts out by ID, and not in neither. The newest page only; and a service that cannot say leaves it unknown.
    const pending = request.cursor
      ? undefined
      : await this.dependencies.client.request(thread.target, 'session.inbox.list', { params: { sessionID: thread.id } })
        .then((answer) => parsePendingMessages(answer, this.dependencies.thumbnail))
        .catch(() => undefined)
    const [page, active, session] = await Promise.all([
      loadPage(),
      this.dependencies.client.request(thread.target, 'session.active'),
      // The thread's totals are only wanted with the newest page, and the conversation shows without them.
      request.cursor
        ? null
        : this.dependencies.client.request(thread.target, 'session.get', { params: { sessionID: thread.id } }).catch(() => null),
    ])
    const result = parseMessagesPage(page, parseActiveSessions(active).has(thread.id), pageSize, this.dependencies.thumbnail)
    const usage = session ? parseSessionUsage(session) : null
    // Only an answer from the service says whether a revert is staged; without one it stays unknown.
    const revert = session ? parseSessionRevert(session) : undefined
    return { ...result, ...(usage ? { usage } : {}), ...(revert !== undefined ? { revert } : {}), ...(pending ? { pending } : {}) }
  }

  /**
   * Sends a message to a thread. Returns the message as OpenCode took it, which is how the reader learns,
   * when the agent was busy, that it is being held; null when OpenCode's answer cannot be read.
   */
  async send(request: ChatSendRequest): Promise<ChatPendingMessage | null> {
    this.assertEnabled()
    const thread = this.thread(request.threadId)
    const text = this.promptText(request.text, request.attachmentIds)
    const files = request.attachmentIds?.length ? await this.dependencies.drafts?.files(`thread:${thread.id}`, request.attachmentIds, request.draftRevision) : undefined
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
    const answer = await this.dependencies.client.request(thread.target, 'session.prompt', {
      params: { sessionID: thread.id },
      body: { ...await this.promptBody(thread, text, files), ...(request.delivery ? { delivery: request.delivery } : {}) },
    })
    await this.dependencies.drafts?.remove(`thread:${thread.id}`, undefined, request.draftRevision)
    this.dependencies.recorder.markStatus(thread.id, 'working')
    return parsePromptAnswer(answer, this.dependencies.thumbnail)
  }

  /**
   * Takes back a message OpenCode holds for the agent. A message it delivered in the meantime is part of
   * the conversation by then, and the service leaves it be and says nothing.
   */
  async discardPending(request: ChatDiscardPendingRequest): Promise<void> {
    this.assertEnabled()
    const thread = this.thread(request.threadId)
    await this.dependencies.client.request(thread.target, 'session.inbox.cancel', {
      params: { sessionID: thread.id, inboxID: request.messageId },
    })
  }

  /**
   * Changes how a held message is delivered: steering (the agent reads it at its next step) or queued
   * (it waits until the agent is done). The service refuses with a conflict when the message is no longer
   * held, because the agent took it up, or already has that delivery, and that is told plainly.
   */
  async setDelivery(request: ChatSetDeliveryRequest): Promise<void> {
    this.assertEnabled()
    const thread = this.thread(request.threadId)
    try {
      await this.dependencies.client.request(thread.target, 'session.inbox.update', {
        params: { sessionID: thread.id, inboxID: request.messageId },
        body: { delivery: request.delivery },
      })
    } catch (error) {
      if (error instanceof OpenCodeServiceError && error.status === 409) {
        // The reason only: the reader's notice says that the switch failed.
        throw new Error('the agent may already have taken it up.')
      }
      throw error
    }
  }

  async interrupt(threadId: string): Promise<void> {
    const thread = this.thread(threadId)
    await this.dependencies.client.request(thread.target, 'session.interrupt', { params: { sessionID: thread.id } })
  }

  /**
   * Brings back what a staged revert hid: OpenCode shows the messages again and puts the files back
   * as they were when the revert was staged. With no revert staged it does nothing.
   */
  async redo(threadId: string): Promise<void> {
    this.assertEnabled()
    const thread = this.thread(threadId)
    this.streams.ensure(thread.target)
    try {
      await this.dependencies.client.request(thread.target, 'session.revert.clear', { params: { sessionID: thread.id } })
    } catch (error) {
      if (error instanceof OpenCodeServiceError) {
        if (error.status === 409) throw new Error('OpenCode is still working on this thread. Stop it, then redo.')
        // A route the service does not know answers 404 with no body; a missing session says so by name.
        if (error.status === 404 && error.tag === undefined) {
          throw new Error('This OpenCode service does not support redo. Update OpenCode and try again.')
        }
      }
      throw error
    }
  }

  /**
   * Reverts a thread to just before one of the user's messages: the agent is stopped if it is
   * working, then OpenCode hides that message and everything after it and, unless asked not to,
   * puts back the files the agent changed from there on. Nothing is deleted until the next message
   * is sent, so a redo undoes it. Returns the revert OpenCode staged.
   */
  async revert(request: ChatRevertRequest): Promise<ChatRevert> {
    this.assertEnabled()
    const thread = this.thread(request.threadId)
    this.streams.ensure(thread.target)
    // Interrupting a thread that is idle does nothing.
    await this.dependencies.client.request(thread.target, 'session.interrupt', { params: { sessionID: thread.id } })
    for (let attempt = 1; ; attempt += 1) {
      try {
        const answer = await this.dependencies.client.request(thread.target, 'session.revert.stage', {
          params: { sessionID: thread.id },
          body: { messageID: request.messageId, ...(request.files === false ? { files: false } : {}) },
        })
        // The revert is staged; an answer MDE cannot read still leaves the next read to say what it holds.
        return parseStagedRevert(answer) ?? { messageId: request.messageId, files: [] }
      } catch (error) {
        if (error instanceof OpenCodeServiceError) {
          if (error.status === 409 && attempt < REVERT_ATTEMPTS) {
            await this.pause(REVERT_RETRY_MS)
            continue
          }
          if (error.status === 409) throw new Error('OpenCode is still stopping this thread. Try again in a moment.')
          if (error.status === 404 && error.tag === 'MessageNotFoundError') throw new Error('That message is no longer in the conversation.')
          // A route the service does not know answers 404 with no body; a missing session says so by name.
          if (error.status === 404 && error.tag === undefined) {
            throw new Error('This OpenCode service does not support reverting. Update OpenCode and try again.')
          }
        }
        throw error
      }
    }
  }

  /**
   * Forks a thread into a new one that starts with a copy of the conversation. OpenCode copies the
   * messages under new IDs inside the service, and the new session works in the same directory.
   * Nothing is stopped or changed in the original.
   */
  async fork(request: ChatForkRequest): Promise<ChatForkResult> {
    this.assertEnabled()
    const source = this.thread(request.threadId)
    this.streams.ensure(source.target)
    const { before, text } = request.messageId ? { before: request.messageId, text: undefined } : await this.forkBoundary(source)
    let answer: unknown
    try {
      answer = await this.dependencies.client.request(source.target, 'session.fork', {
        params: { sessionID: source.id },
        body: { before },
      })
    } catch (error) {
      if (error instanceof OpenCodeServiceError && error.status === 404) {
        if (error.tag === 'MessageNotFoundError') throw new Error('That message is no longer in the conversation.')
        // A route the service does not know answers 404 with no body; a missing session says so by name.
        if (error.tag === undefined) throw new Error('This OpenCode service does not support forking. Update OpenCode and try again.')
      }
      throw error
    }
    const created = parseCreatedSession(answer)
    const model = parseSessionInfo(answer).model
    const thread = this.dependencies.recorder.recordForkedThread({
      id: created.id,
      title: created.title,
      source,
      ...(model ? { model } : {}),
    })
    return { thread, ...(text ? { text } : {}) }
  }

  /**
   * Where a fork of the whole conversation is cut. OpenCode copies every message, so two things it
   * would copy are left out here: what a staged revert hides, which the copy would bring back, and the
   * turn the agent is working on, which would arrive as a message with no reply. Null copies it all.
   */
  private async forkBoundary(thread: InboxThread): Promise<{ before: string | null; text?: string }> {
    const [session, active] = await Promise.all([
      this.dependencies.client.request(thread.target, 'session.get', { params: { sessionID: thread.id } }),
      this.dependencies.client.request(thread.target, 'session.active'),
    ])
    const revert = parseSessionRevert(session)
    if (revert) return { before: revert.messageId }
    if (!parseActiveSessions(active).has(thread.id)) return { before: null }
    const markers: TurnMarker[] = []
    let cursor: string | null = null
    for (let page = 0; page < TURN_SCAN_PAGES; page += 1) {
      const answer = parseTurnMarkers(await this.dependencies.client.request(thread.target, 'session.message.list', {
        params: { sessionID: thread.id },
        query: { limit: String(CHAT_PAGE_SIZE), ...(cursor ? { cursor } : { order: 'desc' }) },
      }))
      markers.push(...answer.markers)
      cursor = answer.count >= CHAT_PAGE_SIZE ? answer.next : null
      // The turn began after the newest `idle` found so far, or there is nothing older to read.
      if (!cursor || markers.some((marker) => marker.kind === 'idle')) break
    }
    const start = unfinishedTurnStart(markers)
    return start ? { before: start.id, ...(start.text?.trim() ? { text: start.text } : {}) } : { before: null }
  }

  async regenerateTitle(threadId: string): Promise<void> {
    this.assertEnabled()
    const thread = this.thread(threadId)
    const pending = this.titleRegenerations.get(threadId)
    if (pending) return pending
    const run = (async () => {
      this.streams.ensure(thread.target)
      try {
        await this.dependencies.client.request(thread.target, 'session.update', {
          params: { sessionID: threadId }, body: { title: '' },
        })
      } catch (error) {
        if (error instanceof OpenCodeServiceError && (error.status === 405 || error.status === 501)) {
          throw new Error('This OpenCode service does not support native title regeneration. Update OpenCode and try again.')
        }
        throw error
      }
      // The update returns no content. Read it back in case the event stream missed the rename.
      // A rename received during this read is newer than its snapshot and must win.
      const read = { renamed: false }
      this.titleReads.set(threadId, read)
      try {
        const session = parseSessionInfo(await this.dependencies.client.request(thread.target, 'session.get', {
          params: { sessionID: threadId },
        }))
        if (!session.title) throw new Error('OpenCode returned an invalid session title.')
        if (!read.renamed) this.dependencies.recorder.updateTitle(threadId, session.title)
      } finally {
        this.titleReads.delete(threadId)
      }
    })()
    this.titleRegenerations.set(threadId, run)
    try {
      await run
    } finally {
      this.titleRegenerations.delete(threadId)
    }
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

  private onEvent(event: ServiceEvent, target: OpenCodePluginTarget): void {
    this.dependencies.recorder.applyServiceEvent(event)
    // An MCP server changed. It belongs to no session, so it is passed on before the thread checks below.
    if (event.type === 'mcp.status.changed' || event.type === 'mcp.tools.changed') {
      this.dependencies.send({ type: 'mcp', target })
      return
    }
    const threadId = serviceEventSessionId(event)
    if (threadId && event.type === 'session.renamed') {
      const read = this.titleReads.get(threadId)
      if (read) read.renamed = true
    }
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
    // After the agents, which wait for the folder to finish loading. Skills are optional: an OpenCode
    // that cannot list them still gets working pickers.
    const skills = await this.loadSkills(folder).catch((): ChatSkill[] => [])
    return {
      agents: agentList,
      models: parseModels(models, parseProviderNames(providers)),
      defaultModel: parseDefaultModel(defaultModel),
      defaultAgent: agentList.find((agent) => agent.id === 'build')?.id ?? agentList[0]?.id ?? null,
      skills,
    }
  }

  private async loadSkills(place: { target: OpenCodePluginTarget; directory: string }): Promise<ChatSkill[]> {
    for (let attempt = 1; ; attempt += 1) {
      const skills = parseSkills(await this.dependencies.client.request(place.target, 'skill.list', {
        query: { 'location[directory]': place.directory },
      }))
      if (skills.length > 0 || attempt >= SKILL_ATTEMPTS) return skills
      await this.pause(AGENT_RETRY_MS)
    }
  }

  /**
   * The body of a prompt. A `$id` that names a skill becomes a real skill invocation, so OpenCode gives
   * the model the skill's text; the message text itself is sent unchanged. The skills are listed for the
   * directory the session runs in, because that is what OpenCode checks them against: a skill that
   * exists only in the main checkout is not one in a worktree. Text without a `$` costs no request, and a
   * listing that fails sends the message as plain text rather than losing it.
   */
  private async promptBody(
    place: { target: OpenCodePluginTarget; directory: string },
    text: string,
    files: unknown[] | undefined,
  ): Promise<Record<string, unknown>> {
    let mentions: ReturnType<typeof skillMentions> = []
    if (text.includes('$')) {
      try {
        mentions = skillMentions(text, (await this.loadSkills(place)).map((skill) => skill.id))
      } catch { /* The skills are an extra; the message goes without them. */ }
    }
    return {
      text,
      ...(files?.length ? { files } : {}),
      ...(mentions.length ? { skills: mentions.map(({ id, start, end, text: written }) => ({ id, mention: { start, end, text: written } })) } : {}),
    }
  }

  private async loadAgents(
    folder: { target: OpenCodePluginTarget },
    query: Record<string, string>,
  ): Promise<ChatAgent[]> {
    for (let attempt = 1; ; attempt += 1) {
      const agents = parseAgents(await this.dependencies.client.request(folder.target, 'agent.list', { query }))
      if (agents.length > 0) return agents
      if (attempt >= AGENT_ATTEMPTS) throw new Error('OpenCode has not finished loading this folder yet. Try again in a moment.')
      await this.pause(AGENT_RETRY_MS)
    }
  }

  /** Waits between attempts; tests replace the wait. */
  private pause(ms: number): Promise<void> {
    return (this.dependencies.sleep ?? ((wait: number) => new Promise<void>((resolve) => setTimeout(resolve, wait))))(ms)
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

  /** The service and directory a folder (new thread) or an existing thread works in; the request names one. */
  private place(request: ChatOptionsRequest): { target: OpenCodePluginTarget; directory: string } {
    return request.threadId ? this.thread(request.threadId) : this.folder(request.folderId ?? '')
  }

  private thread(id: string): InboxThread {
    const thread = this.dependencies.store.get(id)
    if (!thread) throw new Error('This thread is no longer in the Inbox.')
    return thread
  }

  private promptText(text: string, attachments?: string[]): string {
    if (!text.trim() && !attachments?.length) throw new Error('Type a message first.')
    if (text.length > CHAT_TEXT_MAX_LENGTH) throw new Error('The message is too long.')
    return text
  }

  private assertEnabled(): void {
    if (!this.dependencies.enabled()) throw new Error('The Inbox is only available on macOS and on Windows with WSL.')
  }
}
