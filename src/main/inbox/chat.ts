import type { ChatDraftList, ChatDraftRequest } from '@shared/types'
import type { InboxDraftStore } from './drafts'
import { readSessionAttachment } from '../files/tree'
import { randomUUID } from 'node:crypto'
import type {
  ChatAgent,
  ChatCreateRequest,
  ChatAsideAnswer,
  ChatAsideRequest,
  ChatDiscardPendingRequest,
  ChatEvent,
  ChatForkRequest,
  ChatForkResult,
  ChatFormReplyRequest,
  ChatGoal,
  ChatGoalRequest,
  ChatMcpRequest,
  ChatMcpServer,
  ChatMcpSetRequest,
  ChatMcpState,
  ChatMessagesPage,
  ChatMessagesRequest,
  ChatOptions,
  ChatFileEntry,
  ChatFilesCheckRequest,
  ChatFilesRequest,
  ChatOptionsRequest,
  ChatPart,
  ChatPendingMessage,
  ChatPermissionReplyRequest,
  ChatRequests,
  ChatSetDeliveryRequest,
  ChatRevert,
  ChatRevertRequest,
  ChatSearchRequest,
  ChatSearchResponse,
  ChatSendRequest,
  ChatSkill,
  InboxComposerState,
  InboxFolder,
  InboxFolderIcon,
  InboxFoldersState,
  InboxGitInfo,
  InboxGitInfoRequest,
  InboxThread,
  InboxUpdateFolderRequest,
  OpenCodeModelRef,
  OpenCodeTarget,
  DirectoryContext,
  Session,
} from '@shared/types'
import { OpenCodeServiceError, type OpenCodeServiceClient } from '../opencode/service/client'
import { listBackgroundTasks } from '../opencode/service/background'
import { serviceTargetKey } from '../opencode/service/discovery'
import { inboxThreadTerminalSession } from '@shared/inbox-thread-terminal'
import { normalizeInboxFolderIcon } from '@shared/inbox-folder-icons'
import { goalObjectiveProblem } from '@shared/goal'
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
  parseGeneratedText,
  parseGoalAnswer,
  parseGoalChange,
  parseMcpServers,
  parseMessagesPage,
  parseModels,
  holdsCompaction,
  parsePendingMessages,
  parsePermissions,
  parsePromptAnswer,
  parseProviderNames,
  parseSessionInfo,
  parseSubagentModel,
  parseSessionRevert,
  parseStagedRevert,
  parseSessionUsage,
  parseFileEntries,
  parseSkills,
  parseTurnMarkers,
  unfinishedTurnStart,
  type TurnMarker,
} from '../opencode/service/parse'
import { skillMentions } from '@shared/skills'
import { mentionAttachments, resolveFile } from './file-mentions'
import type { InboxRecorder } from './recorder'
import { InboxSearch } from './search'
import { isChatAgentId, type InboxStore } from './store'
import type { CreatedWorktree, InboxWorktrees } from './worktree'

export const CHAT_PAGE_SIZE = 50
export const CHAT_TEXT_MAX_LENGTH = 100_000
const OPTIONS_TTL_MS = 60_000
/** The `@` picker lists at most this many files and folders at once; typing narrows them down. */
const FILE_PICKER_LIMIT = 40
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
/**
 * What OpenCode's own `/btw` puts before the question: it keeps the answer short and keeps the model from
 * using tools, which a side question must never do while the agent is at work in the same folder.
 */
export const ASIDE_PREAMBLE = [
  'The user is asking a quick side question about the conversation so far.',
  'Answer directly and concisely in markdown from what you already know.',
  'Do not call any tools and do not take any actions.',
].join(' ')
/** A side question is a model call over the whole conversation, which takes longer than a read of the service. */
export const ASIDE_TIMEOUT_MS = 180_000

export interface InboxChatDependencies {
  drafts?: InboxDraftStore
  /** Git worktrees for threads; without it, worktree mode is unavailable. */
  worktrees?: Pick<InboxWorktrees, 'info' | 'create' | 'remove' | 'discard'>
  thumbnail?(bytes: Buffer): string | undefined
  client: Pick<OpenCodeServiceClient, 'request' | 'openEvents' | 'reset' | 'endpoint'>
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
  return a?.id === b.id && a.providerId === b.providerId && a.variant === b.variant
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
  // What a goal writes into the conversation: the start, and each time it sends the agent back to work.
  'session.synthetic',
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
 * reads or changes workspace sessions.
 */
export class InboxChatService {
  private readonly streams: ServiceEventStreams
  private readonly searcher: InboxSearch
  private readonly subscribed = new Map<string, number>()
  /** Child sessions whose model changes should refresh an open parent conversation. */
  private readonly subagentParents = new Map<string, string>()
  private readonly options = new Map<string, { at: number; value: Promise<ChatOptions> }>()
  /** Places (service + directory) whose MCP list has been answered once, so an empty one is believed. */
  private readonly mcpSettled = new Set<string>()
  private readonly mcpListing = new Map<string, Promise<ChatMcpState>>()
  private configuredExecutable = 'opencode'
  private readonly titleRegenerations = new Map<string, Promise<void>>()
  private readonly titleReads = new Map<string, { renamed: boolean }>()

  constructor(private readonly dependencies: InboxChatDependencies) {
    this.searcher = new InboxSearch(dependencies)
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
    const targets = new Map<string, OpenCodeTarget>()
    for (const thread of this.dependencies.store.list()) {
      if (thread.status === 'working' || thread.status === 'attention') {
        targets.set(serviceTargetKey(thread.target), thread.target)
      }
    }
    for (const target of targets.values()) this.streams.ensure(target)
  }

  stop(): void {
    this.streams.stopAll()
    this.subagentParents.clear()
  }

  /** The OpenCode executable from Settings; discovery runs it to find each service. */
  executable(): string {
    return this.configuredExecutable
  }

  /** Only Inbox terminal threads may launch their recorded conversation in a PTY. */
  terminalSession(threadId: string): Session {
    this.assertEnabled()
    const thread = this.thread(threadId)
    if (thread.mode !== 'terminal') throw new Error('This thread uses GUI chat.')
    this.streams.ensure(thread.target)
    return inboxThreadTerminalSession(thread)
  }

  /** Connect explicitly to Inbox's server even when the CLI defaults to a private server. */
  async terminalLaunch(threadId: string) {
    this.terminalSession(threadId)
    const thread = this.thread(threadId)
    const endpoint = await this.dependencies.client.endpoint(thread.target)
    return {
      agent: { executable: this.executable(), args: ['--server', endpoint.url, '--session', threadId] },
      // Main-process launch options only: never returned over IPC or placed in argv.
      environment: { OPENCODE_PASSWORD: endpoint.password },
    }
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

  /**
   * Adds a folder the IPC layer already resolved and checked, or reuses the same one. A name or an icon
   * that comes with it is applied either way: the person has just chosen it for this project.
   */
  addFolder({ directory, target, name, icon }: {
    directory: string
    target: OpenCodeTarget
    name?: string
    icon?: InboxFolderIcon
  }): InboxFolder {
    const now = this.dependencies.now()
    const existing = this.dependencies.store.folders().find((folder) =>
      folder.directory === directory && serviceTargetKey(folder.target) === serviceTargetKey(target))
    const base: InboxFolder = existing
      ? { ...existing, lastUsedAt: now }
      : {
          id: `fld_${(this.dependencies.createId ?? randomUUID)()}`,
          name: folderName(directory),
          directory,
          target,
          createdAt: now,
          lastUsedAt: now,
        }
    const label = name?.trim()
    const clean = icon ? normalizeInboxFolderIcon(icon) : undefined
    if (icon && !clean) throw new Error('That icon is not available.')
    const folder: InboxFolder = { ...base, ...(label ? { name: label } : {}), ...(clean ? { icon: clean } : {}) }
    this.dependencies.store.putFolder(folder)
    this.dependencies.store.setComposer({ ...this.dependencies.store.composer(), folderId: folder.id })
    return folder
  }

  /**
   * Renames a project or changes its icon. The folder, its target and when it was last used stay as
   * they are, so editing does not move it in the chooser or touch the threads started in it.
   */
  updateFolder({ id, name, icon }: InboxUpdateFolderRequest): InboxFolder {
    const folder = this.dependencies.store.folder(id)
    if (!folder) throw new Error('That project is no longer in the Inbox.')
    const label = name?.trim()
    if (name !== undefined && !label) throw new Error('Give the project a name.')
    const clean = icon ? normalizeInboxFolderIcon(icon) : undefined
    if (icon && !clean) throw new Error('That icon is not available.')
    const next: InboxFolder = { ...folder }
    if (label) next.name = label
    if (icon === null) delete next.icon
    else if (clean) next.icon = clean
    this.dependencies.store.putFolder(next)
    return next
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

  /** Forgets the cached agents and models, e.g. after OpenCode's configuration changed what it offers. */
  invalidateOptions(): void {
    this.options.clear()
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

  private async loadMcp(place: { target: OpenCodeTarget; directory: string }, key: string): Promise<ChatMcpState> {
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

  async draft(request: ChatDraftRequest, sourceSession?: DirectoryContext) {
    this.assertEnabled()
    const [kind, id = ''] = request.key.split(':')
    const store = this.dependencies.drafts
    if (!store) throw new Error('Draft storage is unavailable.')
    // A new thread's draft is listed under the folder it was written for, which every change to it names.
    // That folder may be gone by the time a draft is opened; the page then names the one it shows instead.
    if (kind === 'thread') this.thread(id)
    else if (request.folderId) this.folder(request.folderId)
    const meta = kind === 'draft' && request.folderId ? { folderId: request.folderId, ...(request.choice ? { choice: request.choice } : {}) } : undefined
    if ((request.action === 'text' || request.action === 'prepend' || request.action === 'add' || request.action === 'tree') && kind === 'draft' && !meta) {
      throw new Error('A new thread’s draft needs its folder.')
    }
    if (request.action === 'text') await store.text(request.key, request.text, meta)
    if (request.action === 'prepend') await store.prepend(request.key, request.text, meta)
    if (request.action === 'add') await store.add(request.key, request.name, request.mime, request.data, meta)
    if (request.action === 'tree') {
      const source = sourceSession ?? (request.sessionId ? this.fileRoot(request.sessionId) : null)
      if (!source) throw new Error('Source folder no longer exists.')
      await store.add(request.key, request.path.split('/').at(-1)!, 'application/octet-stream', await readSessionAttachment(source, request.path), meta)
    }
    if (request.action === 'remove') await store.remove(request.key, request.attachmentId)
    if (request.action === 'clear') await store.remove(request.key)
    // Reading or looking again at a draft is how the page says it now shows it for another folder, or with other choices.
    if ((request.action === 'load' || request.action === 'flush') && meta) await store.setMeta(request.key, meta)
    return store.get(request.key)
  }

  /** The new-thread drafts that have something in them, newest change first, and the threads with an unsent message. */
  async drafts(): Promise<ChatDraftList> {
    this.assertEnabled()
    const store = this.dependencies.drafts
    if (!store) return { drafts: [], threads: [] }
    const threads = (await store.threadIds()).filter((id) => this.dependencies.store.get(id))
    return { drafts: await store.list(), threads }
  }

  async removeDraft(key: `thread:${string}`): Promise<void> { await this.dependencies.drafts?.remove(key) }

  async create(request: ChatCreateRequest): Promise<InboxThread> {
    this.assertEnabled()
    const folder = this.folder(request.folderId)
    // A worktree folder already is one: threads started in it run in it, and a new worktree is cut from the real folder.
    if (request.worktree && folder.worktree) throw new Error('This folder is already a worktree. Start the thread in it, or start a new worktree from the folder it came from.')
    const text = this.promptText(request.text, request.attachmentIds)
    if (!isChatAgentId(request.agent)) throw new Error('Choose an agent.')
    // The files come from the draft this starts from, and that draft is spent once the thread has its message.
    if (request.attachmentIds?.length && !request.draftId) throw new Error('The attachments do not belong to a draft.')
    const draftKey = request.draftId ? `draft:${request.draftId}` as const : undefined
    const files = request.attachmentIds?.length && draftKey ? await this.dependencies.drafts?.files(draftKey, request.attachmentIds, request.draftRevision) : undefined
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
        mode: request.mode,
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
    if (draftKey) await this.dependencies.drafts?.move(draftKey, `thread:${thread.id}`)
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
    const inbox = request.cursor
      ? undefined
      : await this.dependencies.client.request(thread.target, 'session.inbox.list', { params: { sessionID: thread.id } })
        .then((answer) => ({ pending: parsePendingMessages(answer, this.dependencies.thumbnail), compactionHeld: holdsCompaction(answer) }))
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
    await this.loadSubagentModels(thread, result)
    const usage = session ? parseSessionUsage(session) : null
    // Only an answer from the service says whether a revert is staged; without one it stays unknown.
    const revert = session ? parseSessionRevert(session) : undefined
    return { ...result, ...(usage ? { usage } : {}), ...(revert !== undefined ? { revert } : {}), ...(inbox ?? {}) }
  }

  /** Looks for text in the messages of all threads; see `InboxSearch`. */
  search(request: ChatSearchRequest): ChatSearchResponse {
    return this.searcher.search(request)
  }

  /** Read only the child sessions named by these calls; a missing child must never hide the chat. */
  private async loadSubagentModels(thread: InboxThread, page: ChatMessagesPage): Promise<void> {
    const children = new Map<string, NonNullable<Extract<ChatPart, { kind: 'tool' }>['subagent']>[]>()
    for (const message of page.messages) {
      if (message.kind !== 'assistant') continue
      for (const part of message.parts) {
        if (part.kind !== 'tool' || !part.subagent) continue
        const calls = children.get(part.subagent.sessionId) ?? []
        calls.push(part.subagent)
        children.set(part.subagent.sessionId, calls)
      }
    }
    const pending = [...children.entries()]
    // Limit simultaneous requests even when a history page contains many subagents.
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
      for (let child = pending.shift(); child; child = pending.shift()) {
        const [sessionId, calls] = child
        try {
          const answer = await this.dependencies.client.request(thread.target, 'session.get', {
            params: { sessionID: sessionId },
            timeoutMs: 2_000,
          })
          const model = parseSubagentModel(answer, sessionId, thread.id)
          if (model) {
            for (const call of calls) call.model = model
            if (this.subscribed.has(thread.id)) {
              this.subagentParents.set(`${serviceTargetKey(thread.target)}\n${sessionId}`, thread.id)
            }
          }
        } catch { /* Model details are optional; the conversation still loads. */ }
      }
    }))
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
    await this.applyChoice(thread, request)
    const answer = await this.dependencies.client.request(thread.target, 'session.prompt', {
      params: { sessionID: thread.id },
      body: { ...await this.promptBody(thread, text, files), ...(request.delivery ? { delivery: request.delivery } : {}) },
    })
    await this.dependencies.drafts?.remove(`thread:${thread.id}`, undefined, request.draftRevision)
    this.dependencies.recorder.markStatus(thread.id, 'working')
    return parsePromptAnswer(answer, this.dependencies.thumbnail)
  }

  /** Switches the thread to the agent and model the composer shows, when it shows others, and remembers them for the next thread. */
  private async applyChoice(thread: InboxThread, choice: { agent?: string; model?: OpenCodeModelRef }): Promise<void> {
    if (choice.agent === undefined && choice.model === undefined) return
    const session = parseSessionInfo(await this.dependencies.client.request(thread.target, 'session.get', {
      params: { sessionID: thread.id },
    }))
    if (choice.agent !== undefined && choice.agent !== session.agent) {
      if (!isChatAgentId(choice.agent)) throw new Error('Choose an agent.')
      await this.dependencies.client.request(thread.target, 'session.switchAgent', {
        params: { sessionID: thread.id }, body: { agent: choice.agent },
      })
    }
    if (choice.model !== undefined && !sameModel(session.model, choice.model)) {
      await this.dependencies.client.request(thread.target, 'session.switchModel', {
        params: { sessionID: thread.id }, body: { model: modelBody(choice.model) },
      })
    }
    this.dependencies.store.setComposer({
      ...this.dependencies.store.composer(),
      ...(choice.agent !== undefined ? { agent: choice.agent } : {}),
      ...(choice.model !== undefined ? { model: choice.model } : {}),
    })
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

  /**
   * Answers a side question from the thread's conversation as it stands, without adding anything to it:
   * the service writes no message and does not wake or disturb the agent, so this also works while the
   * agent is busy. The answer is the thread's current model's, and it is Markdown.
   */
  async aside(request: ChatAsideRequest): Promise<ChatAsideAnswer> {
    this.assertEnabled()
    const thread = this.thread(request.threadId)
    const question = request.question.trim()
    if (!question) throw new Error('Ask a question.')
    let answer: unknown
    try {
      answer = await this.dependencies.client.request(thread.target, 'session.generate', {
        params: { sessionID: thread.id },
        body: { prompt: `${ASIDE_PREAMBLE}\n${question}` },
        timeoutMs: ASIDE_TIMEOUT_MS,
      })
    } catch (error) {
      // A route the service does not know answers 404 with no body; a missing session says so by name.
      if (error instanceof OpenCodeServiceError && error.status === 404 && error.tag === undefined) {
        throw new Error('This OpenCode service cannot answer side questions. Update OpenCode and try again.')
      }
      throw error
    }
    const text = parseGeneratedText(answer)
    if (!text) throw new Error('OpenCode gave no answer. Try asking again.')
    return { text }
  }

  /**
   * Summarizes the conversation to free up context. OpenCode answers at once and does the work in the
   * background, so a failure of the work itself (nothing to compact yet, the model not answering) shows up as
   * a note in the conversation, not here. It is asked to wait for the agent when the agent is busy, so that
   * a turn is not cut in the middle; it then runs when the agent is done.
   */
  async compact(threadId: string): Promise<void> {
    this.assertEnabled()
    const thread = this.thread(threadId)
    this.streams.ensure(thread.target)
    try {
      await this.dependencies.client.request(thread.target, 'session.compact', {
        params: { sessionID: thread.id },
        body: { delivery: 'queue' },
      })
    } catch (error) {
      // A route the service does not know answers 404 with no body; a missing session says so by name.
      if (error instanceof OpenCodeServiceError && error.status === 404 && error.tag === undefined) {
        throw new Error('This OpenCode service cannot compact conversations. Update OpenCode and try again.')
      }
      throw error
    }
  }

  /**
   * The thread's goal (`/goal`), or null when it has none. The goal is a plugin of OpenCode's, and a service
   * without it has no such route or does not know the plugin: that is "no goal" and not a failure.
   */
  async goal(threadId: string): Promise<ChatGoal | null> {
    this.assertEnabled()
    const thread = this.thread(threadId)
    try {
      return parseGoalAnswer(await this.dependencies.client.request(thread.target, 'goal.get', {
        query: { 'location[directory]': thread.directory },
        body: { input: { sessionID: thread.id } },
      }))
    } catch (error) {
      if (error instanceof OpenCodeServiceError && (error.status === 404 || (error.status === 400 && error.tag === 'RpcError'))) return null
      throw error
    }
  }

  /**
   * Sets the thread's goal, or pauses, resumes or clears it, by running OpenCode's `/goal` command. Setting
   * one starts the agent on it (or steers a busy agent to it), with the agent and model the composer shows,
   * as a message would. OpenCode refuses what makes no sense, such as pausing a goal that is not active, with
   * a reason in plain words, which is passed on. The new state arrives as a goal event.
   */
  async setGoal(request: ChatGoalRequest): Promise<void> {
    this.assertEnabled()
    const thread = this.thread(request.threadId)
    let text: string
    if (request.action === 'set') {
      const problem = goalObjectiveProblem(request.objective)
      if (problem) throw new Error(problem)
      text = request.objective.trim()
    } else {
      text = request.action
    }
    this.streams.ensure(thread.target)
    if (request.action === 'set') await this.applyChoice(thread, request)
    try {
      await this.dependencies.client.request(thread.target, 'session.command', {
        params: { sessionID: thread.id },
        body: { name: 'goal', text },
      })
    } catch (error) {
      // A command the service does not know answers 404; a missing session says so by name.
      if (error instanceof OpenCodeServiceError && error.status === 404 && (error.tag === undefined || error.tag === 'CommandNotFoundError')) {
        throw new Error('This OpenCode service does not support goals. Update OpenCode and try again.')
      }
      throw error
    }
    if (request.action === 'set' || request.action === 'resume') this.dependencies.recorder.markStatus(thread.id, 'working')
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
    else {
      this.subscribed.delete(threadId)
      for (const [child, parent] of this.subagentParents) {
        if (parent === threadId) this.subagentParents.delete(child)
      }
    }
  }

  private onEvent(event: ServiceEvent, target: OpenCodeTarget): void {
    this.dependencies.recorder.applyServiceEvent(event)
    // Shell lifecycle events need not carry a session ID. Refresh open lists on this service,
    // including parents whose subagents own the shell. The list API supplies the actual scope.
    if (event.type.startsWith('shell.') || event.type.startsWith('session.shell.')) {
      for (const threadId of this.subscribed.keys()) {
        const thread = this.dependencies.store.get(threadId)
        if (thread && serviceTargetKey(thread.target) === serviceTargetKey(target)) {
          this.dependencies.send({ type: 'background', threadId })
        }
      }
    }
    // An MCP server changed. It belongs to no session, so it is passed on before the thread checks below.
    if (event.type === 'mcp.status.changed' || event.type === 'mcp.tools.changed') {
      this.dependencies.send({ type: 'mcp', target })
      return
    }
    const threadId = serviceEventSessionId(event)
    if (threadId && (event.type === 'session.model.selected' || event.type === 'session.agent.selected')) {
      const parent = this.subagentParents.get(`${serviceTargetKey(target)}\n${threadId}`)
      if (parent && this.subscribed.has(parent)) this.dependencies.send({ type: 'messages', threadId: parent })
    }
    if (threadId && event.type === 'session.renamed') {
      const read = this.titleReads.get(threadId)
      if (read) read.renamed = true
    }
    if (!threadId || !this.subscribed.has(threadId)) return
    // The goal plugin tells every change of a goal by this event; one MDE cannot read is not passed on.
    if (event.type === 'rpc.opencode.goal.changed') {
      const change = parseGoalChange(event)
      if (change) this.dependencies.send({ type: 'goal', threadId: change.threadId, goal: change.goal })
      return
    }
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

  private async loadOptions(folder: { target: OpenCodeTarget; directory: string }): Promise<ChatOptions> {
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

  /**
   * The files and folders of a folder (new thread) or an existing thread that fit what was typed after an `@`,
   * best first. OpenCode ranks them, and leaves out what Git ignores. Nothing typed lists the most recent.
   */
  async files(request: ChatFilesRequest): Promise<ChatFileEntry[]> {
    this.assertEnabled()
    return this.findFiles(this.place(request), request.query)
  }

  /** Which of these paths the folder or thread has; the answer holds the ones it does, as they were written. */
  async checkFiles(request: ChatFilesCheckRequest): Promise<ChatFileEntry[]> {
    this.assertEnabled()
    const place = this.place(request)
    const found = await Promise.all([...new Set(request.paths)].map(async (path) => {
      const entry = await resolveFile((query) => this.findFiles(place, query), path).catch(() => null)
      return entry ? [{ path, directory: entry.directory }] : []
    }))
    return found.flat()
  }

  private async findFiles(place: { target: OpenCodeTarget; directory: string }, query: string): Promise<ChatFileEntry[]> {
    return parseFileEntries(await this.dependencies.client.request(place.target, 'fs.find', {
      query: { 'location[directory]': place.directory, query, limit: String(FILE_PICKER_LIMIT) },
    }))
  }

  private async loadSkills(place: { target: OpenCodeTarget; directory: string }): Promise<ChatSkill[]> {
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
    place: { target: OpenCodeTarget; directory: string },
    text: string,
    files: unknown[] | undefined,
  ): Promise<Record<string, unknown>> {
    let mentions: ReturnType<typeof skillMentions> = []
    if (text.includes('$')) {
      try {
        mentions = skillMentions(text, (await this.loadSkills(place)).map((skill) => skill.id))
      } catch { /* The skills are an extra; the message goes without them. */ }
    }
    // A path after an `@` that the project has is attached as a file; one it does not have is just text.
    let attached = files
    if (text.includes('@')) {
      try {
        const named = await mentionAttachments((query) => this.findFiles(place, query), place.directory, text)
        if (named.length) attached = [...(files ?? []), ...named]
      } catch { /* The files are an extra; the message goes without them. */ }
    }
    return {
      text,
      ...(attached?.length ? { files: attached } : {}),
      ...(mentions.length ? { skills: mentions.map(({ id, start, end, text: written }) => ({ id, mention: { start, end, text: written } })) } : {}),
    }
  }

  private async loadAgents(
    folder: { target: OpenCodeTarget },
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
  fileRoot(id: string): DirectoryContext | null {
    const source = id.startsWith('fld_')
      ? this.dependencies.store.folder(id)
      : id.startsWith('ses_') ? this.dependencies.store.get(id) : null
    if (!source) return null
    const target = source.target
    return {
      id,
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
  private place(request: ChatOptionsRequest): { target: OpenCodeTarget; directory: string } {
    return request.threadId ? this.thread(request.threadId) : this.folder(request.folderId ?? '')
  }

  private thread(id: string): InboxThread {
    const thread = this.dependencies.store.get(id)
    if (!thread) throw new Error('This thread is no longer in the Inbox.')
    return thread
  }

  async backgroundTasks(threadId: string) {
    this.assertEnabled()
    return listBackgroundTasks(this.dependencies.client, this.thread(threadId))
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
