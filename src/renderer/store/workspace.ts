import { create } from 'zustand'
import type { PlatformInfo, WorkspaceData } from '@shared/ipc'
import type {
  Distro,
  NewProject,
  NewSession,
  OpenCodeChatItem,
  OpenCodeChatMessage,
  OpenCodeContextUsage,
  OpenCodeGenerationPhase,
  OpenCodeGenerationState,
  OpenCodeGenerationStats,
  OpenCodeLiveChatItem,
  OpenCodeAgent,
  OpenCodeModelOption,
  OpenCodeModelSelection,
  OpenCodeRevertState,
  OpenCodeSubagent,
  OpenCodePermissionReply,
  OpenCodeQuestionAnswers,
  OpenCodeQuestionPrompt,
  OpenCodeSessionSummary,
  OpenCodeSlashCommand,
  OpenCodeStreamChunk,
  OpenCodeTuiAttentionReason,
  OpenCodeTuiStatus,
  OpenCodeTuiStatusUpdate,
  Project,
  PtyDirectoryUpdate,
  PtyExitInfo,
  PtyStatus,
  Session,
  SessionColor,
  SessionIcon
} from '@shared/types'
import { disposeSession } from '@/terminal/sessions'
import { estimateTokenCount } from '@shared/generation-metrics'

export interface OpenCodeChatState {
  messages: OpenCodeChatItem[]
  contextUsage: OpenCodeContextUsage | null
  generation: OpenCodeGenerationState | null
  compacting: boolean
  availableSessions: OpenCodeSessionSummary[]
  availableModels: OpenCodeModelOption[]
  selectedModel: OpenCodeModelSelection | null
  agent: OpenCodeAgent
  subagents: OpenCodeSubagent[]
  revert: OpenCodeRevertState | null
  undoSupported: boolean
  undoing: boolean
  redoing: boolean
  externalBusy: boolean
  openCodeSessionId: string | null
  liveItems: OpenCodeLiveChatItem[]
  pending: boolean
  operationId?: string | null
  stopping?: boolean
  sessionsLoading: boolean
  modelsLoading: boolean
  error: string | null
  unreadCompletion: boolean
}

export interface OpenCodeTuiStatusState {
  status: OpenCodeTuiStatus
  attentionReason?: OpenCodeTuiAttentionReason
  revision: number
  unread: boolean
}

const EMPTY_CHAT: OpenCodeChatState = {
  messages: [],
  contextUsage: null,
  generation: null,
  compacting: false,
  availableSessions: [],
  availableModels: [],
  selectedModel: null,
  agent: 'build',
  subagents: [],
  revert: null,
  undoSupported: false,
  undoing: false,
  redoing: false,
  externalBusy: false,
  openCodeSessionId: null,
  liveItems: [],
  pending: false,
  operationId: null,
  stopping: false,
  sessionsLoading: false,
  modelsLoading: false,
  error: null,
  unreadCompletion: false
}
let eventBridgeReady = false

function upsertLiveItem(items: OpenCodeLiveChatItem[], item: OpenCodeStreamChunk['item']): OpenCodeLiveChatItem[] {
  if (item.kind === 'subagent' || item.kind === 'status' || item.kind === 'compaction') return items
  if (item.kind === 'question' && item.status !== 'asked') {
    return items.filter((current) => current.id !== item.requestId)
  }
  const id = item.kind === 'permission' || item.kind === 'question' ? item.requestId : item.partId
  const index = items.findIndex((current) => current.id === id)

  if (item.kind === 'text') {
    const existing = index >= 0 ? items[index] : undefined
    const next: OpenCodeLiveChatItem =
      existing?.role === 'assistant'
        ? { ...existing, text: existing.text + item.delta }
        : { id, role: 'assistant', text: item.delta, live: true }
    if (index < 0) return [...items, next]
    return items.map((current, currentIndex) => (currentIndex === index ? next : current))
  }

  if (item.kind === 'reasoning') {
    const existing = index >= 0 ? items[index] : undefined
    const next: OpenCodeLiveChatItem =
      existing?.role === 'reasoning'
        ? {
            ...existing,
            text: existing.text + item.delta,
            ...(item.durationMs === undefined ? {} : { durationMs: item.durationMs })
          }
        : {
            id,
            role: 'reasoning',
            text: item.delta,
            live: true,
            ...(item.durationMs === undefined ? {} : { durationMs: item.durationMs })
          }
    if (index < 0) return [...items, next]
    return items.map((current, currentIndex) => (currentIndex === index ? next : current))
  }

  if (item.kind === 'permission') {
    const existing = index >= 0 ? items[index] : undefined
    const next: OpenCodeLiveChatItem = {
      ...(existing?.role === 'permission' ? existing : {}),
      id,
      role: 'permission',
      live: true,
      permission: item.permission,
      patterns: item.patterns,
      ...('subagentId' in item && item.subagentId ? { subagentId: item.subagentId } : {}),
      ...(item.title === undefined ? {} : { title: item.title })
    }
    if (index < 0) return [...items, next]
    return items.map((current, currentIndex) => (currentIndex === index ? next : current))
  }

  if (item.kind === 'question') {
    const existing = index >= 0 ? items[index] : undefined
    const next: OpenCodeLiveChatItem = {
      ...(existing?.role === 'question' ? existing : {}),
      id,
      role: 'question',
      live: true,
      questions: item.questions,
      ...('subagentId' in item && item.subagentId ? { subagentId: item.subagentId } : {})
    }
    if (index < 0) return [...items, next]
    return items.map((current, currentIndex) => (currentIndex === index ? next : current))
  }

  const existing = index >= 0 ? items[index] : undefined
  const next: OpenCodeLiveChatItem = {
    ...(existing?.role === 'tool' ? existing : {}),
    id,
    role: 'tool',
    live: true,
    tool: item.tool,
    status: item.status,
    input: item.input,
    ...(item.rawInput === undefined ? {} : { rawInput: item.rawInput }),
    ...(item.title === undefined ? {} : { title: item.title }),
    ...(item.output === undefined ? {} : { output: item.output }),
    ...(item.error === undefined ? {} : { error: item.error })
  }
  if (index < 0) return [...items, next]
  return items.map((current, currentIndex) => (currentIndex === index ? next : current))
}

function sameModel(a: OpenCodeModelSelection, b: OpenCodeModelSelection): boolean {
  return a.providerID === b.providerID && a.modelID === b.modelID && a.variant === b.variant
}

function contextUsageMatchesModel(usage: OpenCodeContextUsage | null, model: OpenCodeModelSelection): boolean {
  return usage?.model.providerID === model.providerID && usage.model.modelID === model.modelID
}

function findModel(
  models: OpenCodeModelOption[],
  selection: OpenCodeModelSelection | undefined
): OpenCodeModelSelection | null {
  if (!selection) return null
  const available = models.find((model) => sameModel(model, selection))
  return available
    ? {
        providerID: available.providerID,
        modelID: available.modelID,
        ...(available.variant ? { variant: available.variant } : {})
      }
    : null
}

function upsertSubagent(items: OpenCodeSubagent[], next: OpenCodeSubagent): OpenCodeSubagent[] {
  const index = items.findIndex((item) => item.id === next.id)
  if (index < 0) return [...items, next]
  return items.map((item, itemIndex) => (itemIndex === index ? next : item))
}

function subagentIsActive(subagent: OpenCodeSubagent): boolean {
  return subagent.status === 'working' || subagent.status === 'waiting'
}

function latestCompletedUserId(messages: OpenCodeChatItem[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || message.role !== 'user' || message.id.startsWith('user-')) continue
    if (messages.slice(index + 1).some((item) => item.role === 'assistant')) return message.id
  }
  return null
}

function newGenerationState(): OpenCodeGenerationState {
  return {
    status: 'running',
    live: {
      startedAt: Date.now(),
      firstTokenAt: null,
      lastTokenAt: null,
      phase: null,
      estimatedTokens: 0,
      toolWaiting: false,
      toolInputSnapshots: {}
    },
    final: null
  }
}

function generationPhase(item: OpenCodeStreamChunk['item']): OpenCodeGenerationPhase | null {
  if (item.kind === 'reasoning') return 'thinking'
  if (item.kind === 'text') return 'response'
  if (item.kind === 'tool') return 'tool'
  if (item.kind === 'question' && item.status === 'asked') return 'tool'
  return null
}

function toolInputDelta(
  live: NonNullable<OpenCodeGenerationState['live']>,
  item: Extract<OpenCodeStreamChunk['item'], { kind: 'tool' }>
): { delta: string; snapshots: Record<string, string> } {
  const previous = live.toolInputSnapshots[item.partId] ?? ''
  const snapshot =
    item.rawInput ?? (previous ? '' : Object.keys(item.input).length > 0 ? JSON.stringify(item.input) ?? '' : '')
  if (!snapshot) return { delta: '', snapshots: live.toolInputSnapshots }
  const delta = snapshot.startsWith(previous) ? snapshot.slice(previous.length) : snapshot
  return {
    delta,
    snapshots: { ...live.toolInputSnapshots, [item.partId]: snapshot }
  }
}

function updateGenerationState(
  generation: OpenCodeGenerationState | null,
  item: OpenCodeStreamChunk['item']
): OpenCodeGenerationState | null {
  if (!generation?.live) return generation
  const phase = generationPhase(item)
  if (!phase) return generation

  const live = generation.live
  let delta = ''
  let snapshots = live.toolInputSnapshots
  if (item.kind === 'text' || item.kind === 'reasoning') delta = item.delta
  if (item.kind === 'tool') {
    const result = toolInputDelta(live, item)
    delta = result.delta
    snapshots = result.snapshots
  }

  const estimatedDelta = estimateTokenCount(delta)
  const now = Date.now()
  const waiting =
    (item.kind === 'tool' && (item.status === 'pending' || item.status === 'running') && !delta) ||
    (item.kind === 'question' && item.status === 'asked')
  return {
    ...generation,
    live: {
      ...live,
      phase,
      firstTokenAt: live.firstTokenAt ?? (estimatedDelta > 0 ? now : null),
      lastTokenAt: estimatedDelta > 0 ? now : live.lastTokenAt,
      estimatedTokens: live.estimatedTokens + estimatedDelta,
      toolWaiting: waiting,
      toolInputSnapshots: snapshots
    }
  }
}

function completedGenerationStats(
  stats: OpenCodeGenerationStats | null,
  generation: OpenCodeGenerationState | null
): OpenCodeGenerationStats | null {
  if (!stats) return null
  const firstTokenAt = generation?.live?.firstTokenAt
  return {
    ...stats,
    timeToFirstTokenMs:
      firstTokenAt === null || firstTokenAt === undefined || generation?.live?.startedAt === undefined
        ? null
        : Math.max(0, firstTokenAt - generation.live.startedAt)
  }
}

function retainActiveSubagentInteractions(
  liveItems: OpenCodeLiveChatItem[],
  subagents: OpenCodeSubagent[]
): OpenCodeLiveChatItem[] {
  return liveItems.filter(
    (item) =>
      (item.role === 'permission' || item.role === 'question') &&
      item.subagentId !== undefined &&
      subagents.some((subagent) => subagent.id === item.subagentId && subagentIsActive(subagent))
  )
}

function finalizeCancelledLiveItems(liveItems: OpenCodeLiveChatItem[]): OpenCodeChatItem[] {
  return liveItems.flatMap((item): OpenCodeChatItem[] => {
    if (item.role === 'assistant') {
      return item.text ? [{ id: item.id, role: 'assistant' as const, text: item.text }] : []
    }
    if (item.role === 'reasoning') {
      return item.text
        ? [{
            id: item.id,
            role: 'reasoning' as const,
            text: item.text,
            ...(item.durationMs === undefined ? {} : { durationMs: item.durationMs })
          }]
        : []
    }
    if (item.role !== 'tool') return []

    const unfinished = item.status === 'pending' || item.status === 'running'
    return [
      {
        id: item.id,
        role: 'tool' as const,
        tool: item.tool,
        status: unfinished ? ('error' as const) : item.status,
        input: item.input,
        ...(item.title === undefined ? {} : { title: item.title }),
        ...(item.output === undefined ? {} : { output: item.output }),
        ...(item.error === undefined && !unfinished ? {} : { error: item.error ?? 'Cancelled' })
      }
    ]
  })
}

function cancelActiveSubagents(subagents: OpenCodeSubagent[]): OpenCodeSubagent[] {
  const finishedAt = Date.now()
  return subagents.map((subagent) =>
    subagentIsActive(subagent) ? { ...subagent, status: 'cancelled' as const, finishedAt } : subagent
  )
}

function questionAnswersValid(prompts: OpenCodeQuestionPrompt[], answers: OpenCodeQuestionAnswers): boolean {
  if (prompts.length !== answers.length) return false

  return prompts.every((prompt, index) => {
    const selected = answers[index]
    if (!selected || selected.length === 0) return false
    if (!prompt.multiple && selected.length !== 1) return false
    if (selected.some((answer) => answer.trim().length === 0)) return false
    if (prompt.custom !== false) return true
    const labels = new Set(prompt.options.map((option) => option.label))
    return selected.every((answer) => labels.has(answer))
  })
}

interface WorkspaceState {
  projects: Project[]
  sessions: Session[]
  selectedSessionId: string | null
  statuses: Record<string, PtyStatus>
  terminalDirectories: Record<string, string>
  exits: Record<string, PtyExitInfo>
  opencodeChats: Record<string, OpenCodeChatState>
  opencodeTuiStatuses: Record<string, OpenCodeTuiStatusState>
  platform: PlatformInfo | null
  wslAvailable: boolean
  distros: Distro[]
  sidebarCollapsed: boolean
  ready: boolean

  init: () => Promise<void>
  selectSession: (id: string | null) => void
  toggleSidebar: () => void

  addProject: (input: NewProject) => Promise<Project>
  renameProject: (id: string, name: string) => Promise<void>
  removeProject: (id: string) => Promise<void>

  addSession: (input: NewSession) => Promise<Session>
  duplicateSession: (id: string) => Promise<Session | null>
  renameSession: (id: string, name: string) => Promise<void>
  setSessionColor: (id: string, color: SessionColor) => Promise<void>
  setSessionIcon: (id: string, icon: SessionIcon | null) => Promise<void>
  moveSession: (id: string, projectId: string) => Promise<void>
  reorderSession: (id: string, beforeId: string | null) => Promise<void>
  removeSession: (id: string) => Promise<void>
  revealSession: (id: string) => Promise<void>
  openSessionInVsCode: (id: string) => Promise<void>

  setStatus: (id: string, status: PtyStatus) => void
  setTerminalDirectory: (update: PtyDirectoryUpdate) => void
  noteExit: (info: PtyExitInfo) => void
  clearExit: (id: string) => void
  persistOpenCodeSelection: (
    sessionId: string,
    openCodeSessionId: string | null,
    model?: OpenCodeModelSelection
  ) => Promise<void>
  loadOpenCodeModels: (sessionId: string) => Promise<void>
  selectOpenCodeModel: (sessionId: string, model: OpenCodeModelSelection) => Promise<void>
  selectOpenCodeAgent: (sessionId: string, agent: OpenCodeAgent) => void
  executeOpenCodeCommand: (sessionId: string, command: OpenCodeSlashCommand) => Promise<void>
  refreshOpenCodeSessionList: (sessionId: string) => Promise<void>
  loadOpenCodeSessions: (sessionId: string) => Promise<void>
  selectOpenCodeSession: (sessionId: string, openCodeSessionId: string) => Promise<void>
  createOpenCodeSession: (sessionId: string) => Promise<void>
  sendOpenCodeMessage: (sessionId: string, text: string) => Promise<void>
  stopOpenCodeGeneration: (sessionId: string) => Promise<void>
  undoOpenCodeLastTurn: (sessionId: string) => Promise<void>
  redoOpenCodeLastTurn: (sessionId: string) => Promise<void>
  replyOpenCodePermission: (
    sessionId: string,
    requestId: string,
    reply: OpenCodePermissionReply
  ) => Promise<void>
  replyOpenCodeQuestion: (sessionId: string, requestId: string, answers: OpenCodeQuestionAnswers) => Promise<void>
  rejectOpenCodeQuestion: (sessionId: string, requestId: string) => Promise<void>
  appendOpenCodeStream: (chunk: OpenCodeStreamChunk) => void
  appendOpenCodeTuiStatus: (update: OpenCodeTuiStatusUpdate) => void
  refreshDistros: () => Promise<void>
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  projects: [],
  sessions: [],
  selectedSessionId: null,
  statuses: {},
  terminalDirectories: {},
  exits: {},
  opencodeChats: {},
  opencodeTuiStatuses: {},
  platform: null,
  wslAvailable: false,
  distros: [],
  sidebarCollapsed: false,
  ready: false,

  init: async () => {
    // React StrictMode may run the mount effect more than once in development.
    // These are process-lifetime push subscriptions, so install them once.
    if (!eventBridgeReady) {
      eventBridgeReady = true
      window.api.pty.onExit((info) => get().noteExit(info))
      window.api.pty.onDirectory((update) => get().setTerminalDirectory(update))
      window.api.opencode.onStream((chunk) => get().appendOpenCodeStream(chunk))
      window.api.opencodeTui.onStatus((update) => get().appendOpenCodeTuiStatus(update))
    }

    const [platform, workspace, statuses, directories, wslAvailable] = await Promise.all([
      window.api.platform.info(),
      window.api.workspace.list(),
      window.api.pty.statuses(),
      window.api.pty.directories(),
      window.api.wsl.available()
    ])

    const { projects, sessions } = workspace as WorkspaceData
    set({
      platform,
      projects,
      sessions,
      statuses,
      // The event bridge may receive a report while these startup requests
      // are in flight. Preserve that newer event over the initial snapshot.
      terminalDirectories: { ...directories, ...get().terminalDirectories },
      opencodeTuiStatuses: {},
      wslAvailable,
      selectedSessionId: null,
      ready: true
    })

    if (wslAvailable) void get().refreshDistros()
  },

  selectSession: (id) =>
    set((state) => {
      const chat = id ? state.opencodeChats[id] : undefined
      const tuiStatus = id ? state.opencodeTuiStatuses[id] : undefined
      if (!id || (!chat?.unreadCompletion && !tuiStatus?.unread)) return { selectedSessionId: id }
      const opencodeTuiStatuses = { ...state.opencodeTuiStatuses }
      if (tuiStatus) opencodeTuiStatuses[id] = { ...tuiStatus, unread: false }
      return {
        selectedSessionId: id,
        opencodeTuiStatuses,
        ...(chat?.unreadCompletion
          ? {
              opencodeChats: {
                ...state.opencodeChats,
                [id]: { ...chat, unreadCompletion: false }
              }
            }
          : {})
      }
    }),

  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  addProject: async (input) => {
    const project = await window.api.projects.create(input)
    set((state) => ({ projects: [...state.projects, project] }))
    return project
  },

  renameProject: async (id, name) => {
    const updated = await window.api.projects.update({ id, patch: { name } })
    if (!updated) return
    set((state) => ({ projects: state.projects.map((project) => (project.id === id ? updated : project)) }))
  },

  removeProject: async (id) => {
    const childIds = get()
      .sessions.filter((session) => session.projectId === id)
      .map((session) => session.id)
    await window.api.projects.remove(id)
    childIds.forEach(disposeSession)
    set((state) => {
      const statuses = { ...state.statuses }
      const exits = { ...state.exits }
      const opencodeChats = { ...state.opencodeChats }
      const opencodeTuiStatuses = { ...state.opencodeTuiStatuses }
      childIds.forEach((sessionId) => {
        delete statuses[sessionId]
        delete exits[sessionId]
        delete opencodeChats[sessionId]
        delete opencodeTuiStatuses[sessionId]
      })
      return {
        projects: state.projects.filter((project) => project.id !== id),
        sessions: state.sessions.filter((session) => session.projectId !== id),
        selectedSessionId:
          state.selectedSessionId && childIds.includes(state.selectedSessionId)
            ? null
            : state.selectedSessionId,
        statuses,
        exits,
        opencodeChats,
        opencodeTuiStatuses
      }
    })
  },

  addSession: async (input) => {
    const session = await window.api.sessions.create(input)
    set((state) => ({ sessions: [...state.sessions, session], selectedSessionId: session.id }))
    return session
  },

  duplicateSession: async (id) => {
    const session = await window.api.sessions.duplicate(id)
    if (!session) return null
    set((state) => ({ sessions: [...state.sessions, session], selectedSessionId: session.id }))
    return session
  },

  renameSession: async (id, name) => {
    const updated = await window.api.sessions.update({ id, patch: { name } })
    if (!updated) return
    set((state) => ({ sessions: state.sessions.map((session) => (session.id === id ? updated : session)) }))
  },

  setSessionColor: async (id, color) => {
    const updated = await window.api.sessions.update({ id, patch: { color } })
    if (!updated) return
    set((state) => ({ sessions: state.sessions.map((session) => (session.id === id ? updated : session)) }))
  },

  setSessionIcon: async (id, icon) => {
    const updated = await window.api.sessions.update({ id, patch: { icon } })
    if (!updated) return
    set((state) => ({ sessions: state.sessions.map((session) => (session.id === id ? updated : session)) }))
  },

  moveSession: async (id, projectId) => {
    const updated = await window.api.sessions.move({ id, projectId })
    if (!updated) return
    set((state) => ({ sessions: state.sessions.map((session) => (session.id === id ? updated : session)) }))
  },

  reorderSession: async (id, beforeId) => {
    const sessions = await window.api.sessions.reorder({ id, beforeId })
    if (!sessions) return
    set({ sessions })
  },

  removeSession: async (id) => {
    await window.api.sessions.remove(id)
    disposeSession(id)
    set((state) => {
      const statuses = { ...state.statuses }
      const exits = { ...state.exits }
      const opencodeChats = { ...state.opencodeChats }
      const opencodeTuiStatuses = { ...state.opencodeTuiStatuses }
      delete statuses[id]
      delete exits[id]
      delete opencodeChats[id]
      delete opencodeTuiStatuses[id]
      return {
        sessions: state.sessions.filter((session) => session.id !== id),
        selectedSessionId: state.selectedSessionId === id ? null : state.selectedSessionId,
        statuses,
        exits,
        opencodeChats,
        opencodeTuiStatuses
      }
    })
  },

  revealSession: async (id) => {
    await window.api.paths.reveal(id)
  },

  openSessionInVsCode: async (id) => {
    await window.api.paths.openInVsCode(id)
  },

  setStatus: (id, status) =>
    set((state) => ({ statuses: { ...state.statuses, [id]: status } })),

  setTerminalDirectory: (update) =>
    set((state) => {
      const terminalDirectories = { ...state.terminalDirectories }
      if (update.directory === null) delete terminalDirectories[update.terminalId]
      else terminalDirectories[update.terminalId] = update.directory
      return { terminalDirectories }
    }),

  noteExit: (info) =>
    set((state) => {
      // Split-created PTYs share a workspace session as their launch source,
      // but must not mark that session's primary shell as exited.
      if (info.terminalId !== info.sessionId) return state
      return {
        statuses: { ...state.statuses, [info.sessionId]: 'exited' },
        exits: { ...state.exits, [info.sessionId]: info }
      }
    }),

  clearExit: (id) =>
    set((state) => {
      const exits = { ...state.exits }
      delete exits[id]
      return { exits }
    }),

  persistOpenCodeSelection: async (sessionId, openCodeSessionId, model) => {
    try {
      const workspaceSession = get().sessions.find((session) => session.id === sessionId)
      const modelSelections =
        openCodeSessionId && model
          ? { ...(workspaceSession?.opencodeModelSelections ?? {}), [openCodeSessionId]: model }
          : undefined
      const updated = await window.api.sessions.update({
        id: sessionId,
        patch: {
          opencodeSessionId: openCodeSessionId ?? '',
          ...(modelSelections ? { opencodeModelSelections: modelSelections } : {})
        }
      })
      if (!updated) return
      set((state) => ({
        sessions: state.sessions.map((session) => (session.id === sessionId ? updated : session))
      }))
    } catch {
      // Conversation state remains usable if workspace persistence is temporarily unavailable.
    }
  },

  loadOpenCodeModels: async (sessionId) => {
    const existing = get().opencodeChats[sessionId]
    if (existing?.pending || existing?.modelsLoading) return

    set((state) => {
      const previous = state.opencodeChats[sessionId] ?? EMPTY_CHAT
      return {
        opencodeChats: {
          ...state.opencodeChats,
          [sessionId]: { ...previous, modelsLoading: true, error: null }
        }
      }
    })

    try {
      const result = await window.api.opencode.listModels({ sessionId })
      const current = get().opencodeChats[sessionId]
      if (!current) return
      const workspaceSession = get().sessions.find((session) => session.id === sessionId)
      const saved = current.openCodeSessionId
        ? workspaceSession?.opencodeModelSelections?.[current.openCodeSessionId]
        : undefined
      const selected = findModel(result.models, saved ?? current.selectedModel ?? undefined)
      set((state) => ({
        opencodeChats: {
          ...state.opencodeChats,
          [sessionId]: {
            ...current,
            availableModels: result.models,
            selectedModel: selected,
            contextUsage:
              current.contextUsage && selected && contextUsageMatchesModel(current.contextUsage, selected)
                ? current.contextUsage
                : null,
            modelsLoading: false
          }
        }
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load OpenCode models.'
      set((state) => {
        const previous = state.opencodeChats[sessionId] ?? EMPTY_CHAT
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: { ...previous, modelsLoading: false, error: message }
          }
        }
      })
    }
  },

  selectOpenCodeModel: async (sessionId, model) => {
    const current = get().opencodeChats[sessionId]
    if (current?.liveItems.some((item) => item.role === 'question')) return
    const selected = current ? findModel(current.availableModels, model) : null
    if (!selected) return
    const openCodeSessionId = current?.openCodeSessionId

    set((state) => ({
      opencodeChats: {
        ...state.opencodeChats,
        [sessionId]: {
          ...(state.opencodeChats[sessionId] ?? EMPTY_CHAT),
          selectedModel: selected,
          contextUsage:
            current?.contextUsage && contextUsageMatchesModel(current.contextUsage, selected)
              ? current.contextUsage
              : null,
          error: null
        }
      }
    }))
    if (!openCodeSessionId) return

    const workspaceSession = get().sessions.find((session) => session.id === sessionId)
    const selections = {
      ...(workspaceSession?.opencodeModelSelections ?? {}),
      [openCodeSessionId]: selected
    }
    try {
      const updated = await window.api.sessions.update({
        id: sessionId,
        patch: { opencodeModelSelections: selections }
      })
      if (!updated) return
      set((state) => ({
        sessions: state.sessions.map((session) => (session.id === sessionId ? updated : session))
      }))
    } catch {
      // The selection remains active for this process if persistence is unavailable.
    }
  },

  selectOpenCodeAgent: (sessionId, agent) => {
    if (agent !== 'build' && agent !== 'plan') return
    const current = get().opencodeChats[sessionId]
    if (
      current?.pending ||
      current?.externalBusy ||
      current?.sessionsLoading ||
      current?.modelsLoading ||
      current?.liveItems.some((item) => item.role === 'question')
    ) {
      return
    }

    set((state) => {
      const previous = state.opencodeChats[sessionId] ?? EMPTY_CHAT
      if (previous.agent === agent) return state
      return {
        opencodeChats: {
          ...state.opencodeChats,
          [sessionId]: { ...previous, agent, error: null }
        }
      }
    })
  },

  refreshOpenCodeSessionList: async (sessionId) => {
    try {
      const result = await window.api.opencode.listSessions({ sessionId })
      const current = get().opencodeChats[sessionId]
      if (!current) return
      // A path-spelling mismatch or a transient server refresh can briefly
      // return no selected session even though the visible conversation is
      // still valid. Do not erase the authoritative transcript in that case.
      const selectedSessionId = result.selectedSessionId ?? current.openCodeSessionId
      const availableSessions =
        !result.selectedSessionId && current.openCodeSessionId ? current.availableSessions : result.sessions
      set((state) => ({
        opencodeChats: {
          ...state.opencodeChats,
          [sessionId]: {
            ...current,
            availableSessions,
            openCodeSessionId: selectedSessionId,
            undoSupported: result.undoSupported,
            selectedModel: result.selectedSessionId
              ? findModel(
                  current.availableModels,
                  get().sessions.find((session) => session.id === sessionId)?.opencodeModelSelections?.[
                    result.selectedSessionId
                  ]
                )
              : current.selectedModel,
          }
        }
      }))
      if (selectedSessionId && selectedSessionId !== current.openCodeSessionId) {
        await get().persistOpenCodeSelection(sessionId, selectedSessionId)
      }
    } catch {
      // A successful response should remain visible even if refreshing the picker fails.
    }
  },

  sendOpenCodeMessage: async (sessionId, text) => {
    const prompt = text.trim()
    if (!prompt) return

    const current = get().opencodeChats[sessionId]
    if (current?.pending || current?.externalBusy || current?.liveItems.some((item) => item.role === 'question')) return
    const selectedModel = current?.selectedModel
    const agent = current?.agent ?? 'build'
    if (!selectedModel) {
      set((state) => ({
        opencodeChats: {
          ...state.opencodeChats,
          [sessionId]: { ...(state.opencodeChats[sessionId] ?? EMPTY_CHAT), error: 'Select a model before sending.' }
        }
      }))
      return
    }

    const userMessage: OpenCodeChatMessage = {
      id: `user-${crypto.randomUUID()}`,
      role: 'user',
      text: prompt
    }
    const operationId = crypto.randomUUID()

    set((state) => {
      const previous = state.opencodeChats[sessionId] ?? EMPTY_CHAT
      return {
        opencodeChats: {
          ...state.opencodeChats,
          [sessionId]: {
            ...previous,
            messages: [...previous.messages, userMessage],
            compacting: false,
            generation: newGenerationState(),
            liveItems: retainActiveSubagentInteractions(previous.liveItems, previous.subagents),
            subagents: previous.subagents.filter(subagentIsActive),
            pending: true,
            operationId,
            stopping: false,
            externalBusy: false,
            sessionsLoading: false,
            error: null,
            unreadCompletion: false
          }
        }
      }
    })

    try {
      const { sessionId: openCodeSessionId, userMessageId, messages, contextUsage, generationStats } = await window.api.opencode.send({
        sessionId,
        text: prompt,
        model: selectedModel,
        agent
      })
      set((state) => {
        const current = state.opencodeChats[sessionId]
        if (!current || current.operationId !== operationId) return state
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: {
              ...current,
              // The returned transcript supersedes the streamed preview.
              messages: (() => {
                const next = [...current.messages]
                const optimisticIndex = [...next]
                  .map((item, index) => ({ item, index }))
                  .reverse()
                  .find(({ item }) => item.role === 'user' && item.id.startsWith('user-'))?.index
                if (optimisticIndex !== undefined && userMessageId) {
                  const optimistic = next[optimisticIndex]
                  if (optimistic?.role === 'user') next[optimisticIndex] = { ...optimistic, id: userMessageId }
                }
                return [...next, ...messages]
              })(),
              openCodeSessionId,
              contextUsage: contextUsage ?? null,
              compacting: false,
              generation: {
                status: 'completed',
                live: null,
                final: completedGenerationStats(generationStats ?? null, current.generation)
              },
              pending: false,
              operationId: null,
              stopping: false,
              revert: null,
              externalBusy: false,
              liveItems: retainActiveSubagentInteractions(current.liveItems, current.subagents),
              unreadCompletion: state.selectedSessionId !== sessionId
            }
          }
        }
      })
      await get().persistOpenCodeSelection(sessionId, openCodeSessionId, selectedModel)
      await get().refreshOpenCodeSessionList(sessionId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OpenCode request failed.'
      set((state) => {
        const current = state.opencodeChats[sessionId]
        if (!current || current.operationId !== operationId || current.stopping) return state
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: {
              ...current,
              pending: false,
              operationId: null,
              stopping: false,
              compacting: false,
              generation: null,
              error: message,
              liveItems: retainActiveSubagentInteractions(current.liveItems, current.subagents),
              unreadCompletion: state.selectedSessionId !== sessionId
            }
          }
        }
      })
    }
  },

  stopOpenCodeGeneration: async (sessionId) => {
    const current = get().opencodeChats[sessionId]
    if (!current?.pending || current.stopping || !current.operationId) return
    const operationId = current.operationId

    set((state) => {
      const chat = state.opencodeChats[sessionId]
      if (!chat || chat.operationId !== operationId || !chat.pending) return state
      return {
        opencodeChats: {
          ...state.opencodeChats,
          [sessionId]: { ...chat, stopping: true, error: null }
        }
      }
    })

    try {
      await window.api.opencode.abort({ sessionId })
      set((state) => {
        const chat = state.opencodeChats[sessionId]
        if (!chat || chat.operationId !== operationId || !chat.pending) return state
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: {
              ...chat,
              messages: [...chat.messages, ...finalizeCancelledLiveItems(chat.liveItems)],
              generation: { status: 'cancelled', live: null, final: null },
              pending: false,
              operationId: null,
              stopping: false,
              compacting: false,
              externalBusy: false,
              liveItems: [],
              subagents: cancelActiveSubagents(chat.subagents),
              error: null
            }
          }
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not stop OpenCode.'
      set((state) => {
        const chat = state.opencodeChats[sessionId]
        if (!chat || chat.operationId !== operationId) return state
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: { ...chat, stopping: false, error: message }
          }
        }
      })
    }
  },

  executeOpenCodeCommand: async (sessionId, command) => {
    const current = get().opencodeChats[sessionId]
    const selectedModel = current?.selectedModel
    if (!selectedModel) {
      set((state) => ({
        opencodeChats: {
          ...state.opencodeChats,
          [sessionId]: { ...(state.opencodeChats[sessionId] ?? EMPTY_CHAT), error: 'Select a model before sending.' }
        }
      }))
      return
    }
    if (current?.pending || current?.externalBusy || current.liveItems.some((item) => item.role === 'question')) return

    const operationId = crypto.randomUUID()

    set((state) => {
      const previous = state.opencodeChats[sessionId] ?? EMPTY_CHAT
      return {
        opencodeChats: {
          ...state.opencodeChats,
          [sessionId]: {
            ...previous,
            compacting: false,
            generation: newGenerationState(),
            liveItems: retainActiveSubagentInteractions(previous.liveItems, previous.subagents),
            subagents: previous.subagents.filter(subagentIsActive),
            pending: true,
            operationId,
            stopping: false,
            externalBusy: false,
            sessionsLoading: false,
            error: null,
            unreadCompletion: false
          }
        }
      }
    })

    try {
      const result = await window.api.opencode.executeCommand({
        sessionId,
        command,
        model: selectedModel
      })
      set((state) => {
        const chat = state.opencodeChats[sessionId]
        if (!chat || chat.operationId !== operationId) return state
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: {
              ...chat,
              messages: result.messages,
              contextUsage: result.contextUsage ?? null,
              compacting: false,
              generation: {
                status: 'completed',
                live: null,
                final: completedGenerationStats(result.generationStats ?? null, chat.generation)
              },
              openCodeSessionId: result.sessionId,
              pending: false,
              operationId: null,
              stopping: false,
              revert: result.revert,
              undoSupported: result.undoSupported,
              externalBusy: false,
              liveItems: retainActiveSubagentInteractions(chat.liveItems, chat.subagents),
              unreadCompletion: state.selectedSessionId !== sessionId
            }
          }
        }
      })
      await get().persistOpenCodeSelection(sessionId, result.sessionId, selectedModel)
      await get().refreshOpenCodeSessionList(sessionId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OpenCode command failed.'
      set((state) => {
        const chat = state.opencodeChats[sessionId]
        if (!chat || chat.operationId !== operationId || chat.stopping) return state
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: {
              ...chat,
              pending: false,
              operationId: null,
              stopping: false,
              compacting: false,
              generation: null,
              error: message,
              liveItems: retainActiveSubagentInteractions(chat.liveItems, chat.subagents),
              unreadCompletion: state.selectedSessionId !== sessionId
            }
          }
        }
      })
    }
  },

  undoOpenCodeLastTurn: async (sessionId) => {
    const current = get().opencodeChats[sessionId]
    if (
      !current ||
      !current.undoSupported ||
      current.pending ||
      current.externalBusy ||
      current.undoing ||
      current.redoing ||
      current.revert ||
      current.subagents.some(subagentIsActive)
    ) {
      return
    }

    const messageId = latestCompletedUserId(current.messages)
    if (!messageId) return
    set((state) => ({
      opencodeChats: {
        ...state.opencodeChats,
        [sessionId]: { ...current, undoing: true, error: null }
      }
    }))

    try {
      const result = await window.api.opencode.revert({ sessionId, messageId })
      set((state) => {
        const chat = state.opencodeChats[sessionId]
        if (!chat) return state
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: {
              ...chat,
              messages: result.messages,
              contextUsage: result.contextUsage ?? null,
              compacting: false,
              generation: null,
              openCodeSessionId: result.sessionId,
              revert: result.revert,
              undoSupported: result.undoSupported,
              undoing: false,
              liveItems: [],
              subagents: [],
              error: null
            }
          }
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OpenCode undo failed.'
      set((state) => {
        const chat = state.opencodeChats[sessionId]
        if (!chat) return state
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: { ...chat, undoing: false, error: message }
          }
        }
      })
    }
  },

  redoOpenCodeLastTurn: async (sessionId) => {
    const current = get().opencodeChats[sessionId]
    if (
      !current ||
      !current.undoSupported ||
      !current.revert ||
      current.pending ||
      current.externalBusy ||
      current.undoing ||
      current.redoing ||
      current.subagents.some(subagentIsActive)
    ) {
      return
    }

    set((state) => ({
      opencodeChats: {
        ...state.opencodeChats,
        [sessionId]: { ...current, redoing: true, error: null }
      }
    }))

    try {
      const result = await window.api.opencode.unrevert({ sessionId })
      set((state) => {
        const chat = state.opencodeChats[sessionId]
        if (!chat) return state
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: {
              ...chat,
              messages: result.messages,
              contextUsage: result.contextUsage ?? null,
              compacting: false,
              generation: null,
              openCodeSessionId: result.sessionId,
              revert: result.revert,
              undoSupported: result.undoSupported,
              redoing: false,
              liveItems: [],
              subagents: [],
              error: null
            }
          }
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OpenCode redo failed.'
      set((state) => {
        const chat = state.opencodeChats[sessionId]
        if (!chat) return state
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: { ...chat, redoing: false, error: message }
          }
        }
      })
    }
  },

  loadOpenCodeSessions: async (sessionId) => {
    const existing = get().opencodeChats[sessionId]
    if (existing?.pending || existing?.sessionsLoading || existing?.liveItems.some((item) => item.role === 'question')) return

    set((state) => {
      const previous = state.opencodeChats[sessionId] ?? EMPTY_CHAT
      return {
        opencodeChats: {
          ...state.opencodeChats,
          [sessionId]: { ...previous, sessionsLoading: true, error: null }
        }
      }
    })

    try {
      const result = await window.api.opencode.listSessions({ sessionId })
      set((state) => {
        const previous = state.opencodeChats[sessionId] ?? EMPTY_CHAT
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: {
              ...previous,
              availableSessions: result.sessions,
              openCodeSessionId: result.selectedSessionId,
              undoSupported: result.undoSupported,
              sessionsLoading: false
            }
          }
        }
      })

      if (result.selectedSessionId) {
        await get().selectOpenCodeSession(sessionId, result.selectedSessionId)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load OpenCode conversations.'
      set((state) => {
        const previous = state.opencodeChats[sessionId] ?? EMPTY_CHAT
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: { ...previous, sessionsLoading: false, error: message }
          }
        }
      })
    }
  },

  selectOpenCodeSession: async (sessionId, openCodeSessionId) => {
    const current = get().opencodeChats[sessionId]
    if (current?.pending || current?.sessionsLoading || current?.liveItems.some((item) => item.role === 'question')) return

    set((state) => {
      const previous = state.opencodeChats[sessionId] ?? EMPTY_CHAT
      return {
        opencodeChats: {
          ...state.opencodeChats,
          [sessionId]: { ...previous, sessionsLoading: true, error: null }
        }
      }
    })

    try {
      const result = await window.api.opencode.selectSession({ sessionId, openCodeSessionId })
      set((state) => {
        const previous = state.opencodeChats[sessionId] ?? EMPTY_CHAT
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: {
              ...previous,
              messages: result.messages,
              contextUsage: result.contextUsage ?? null,
              compacting: false,
              generation: null,
              availableSessions: result.session
                ? previous.availableSessions.some((item) => item.id === result.session?.id)
                  ? previous.availableSessions.map((item) =>
                      item.id === result.session?.id ? result.session : item
                    )
                  : [result.session, ...previous.availableSessions]
                : previous.availableSessions,
              openCodeSessionId: result.sessionId,
              revert: result.revert,
              undoSupported: result.undoSupported,
              selectedModel: findModel(
                previous.availableModels,
                get().sessions.find((session) => session.id === sessionId)?.opencodeModelSelections?.[
                  result.sessionId
                ]
              ),
              liveItems: [],
              subagents: [],
              sessionsLoading: false,
              error: null
            }
          }
        }
      })
      await get().persistOpenCodeSelection(sessionId, result.sessionId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load the OpenCode conversation.'
      set((state) => {
        const previous = state.opencodeChats[sessionId] ?? EMPTY_CHAT
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: { ...previous, sessionsLoading: false, error: message }
          }
        }
      })
    }
  },

  createOpenCodeSession: async (sessionId) => {
    const current = get().opencodeChats[sessionId]
    if (current?.pending || current?.sessionsLoading || current?.liveItems.some((item) => item.role === 'question')) return

    set((state) => {
      const previous = state.opencodeChats[sessionId] ?? EMPTY_CHAT
      return {
        opencodeChats: {
          ...state.opencodeChats,
          [sessionId]: { ...previous, sessionsLoading: true, error: null }
        }
      }
    })

    try {
      const result = await window.api.opencode.createSession({
        sessionId,
        agent: current?.agent ?? 'build'
      })
      set((state) => {
        const previous = state.opencodeChats[sessionId] ?? EMPTY_CHAT
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: {
              ...previous,
              messages: [],
              contextUsage: null,
              compacting: false,
              generation: null,
              availableSessions: result.session
                ? [result.session, ...previous.availableSessions.filter((item) => item.id !== result.sessionId)]
                : previous.availableSessions,
              openCodeSessionId: result.sessionId,
              selectedModel: null,
              liveItems: [],
              subagents: [],
              sessionsLoading: false,
              error: null
            }
          }
        }
      })
      await get().persistOpenCodeSelection(sessionId, result.sessionId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create an OpenCode conversation.'
      set((state) => {
        const previous = state.opencodeChats[sessionId] ?? EMPTY_CHAT
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: { ...previous, sessionsLoading: false, error: message }
          }
        }
      })
    }
  },

  replyOpenCodePermission: async (sessionId, requestId, reply) => {
    const current = get().opencodeChats[sessionId]
    const permission = current?.liveItems.find(
      (item) => item.role === 'permission' && item.id === requestId
    )
    if (!permission || permission.role !== 'permission' || permission.responding) return

    set((state) => {
      const chat = state.opencodeChats[sessionId]
      if (!chat) return state
      return {
        opencodeChats: {
          ...state.opencodeChats,
          [sessionId]: {
            ...chat,
            liveItems: chat.liveItems.map((item) =>
              item.role === 'permission' && item.id === requestId
                ? { ...item, responding: true }
                : item
            ),
            error: null
          }
        }
      }
    })

    try {
      await window.api.opencode.replyPermission({ sessionId, requestId, reply })
      set((state) => {
        const chat = state.opencodeChats[sessionId]
        if (!chat) return state
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: {
              ...chat,
              liveItems: chat.liveItems.filter(
                (item) => !(item.role === 'permission' && item.id === requestId)
              )
            }
          }
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OpenCode permission reply failed.'
      set((state) => {
        const chat = state.opencodeChats[sessionId]
        if (!chat) return state
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: {
              ...chat,
              error: message,
              liveItems: chat.liveItems.map((item) =>
                item.role === 'permission' && item.id === requestId
                  ? { ...item, responding: false }
                  : item
              )
            }
          }
        }
      })
    }
  },

  replyOpenCodeQuestion: async (sessionId, requestId, answers) => {
    const current = get().opencodeChats[sessionId]
    const question = current?.liveItems.find((item) => item.role === 'question' && item.id === requestId)
    if (!question || question.role !== 'question' || question.responding) return
    if (!questionAnswersValid(question.questions, answers)) {
      set((state) => ({
        opencodeChats: {
          ...state.opencodeChats,
          [sessionId]: { ...(state.opencodeChats[sessionId] ?? EMPTY_CHAT), error: 'Answer every question before submitting.' }
        }
      }))
      return
    }

    set((state) => {
      const chat = state.opencodeChats[sessionId]
      if (!chat) return state
      return {
        opencodeChats: {
          ...state.opencodeChats,
          [sessionId]: {
            ...chat,
            error: null,
            liveItems: chat.liveItems.map((item) =>
              item.role === 'question' && item.id === requestId ? { ...item, responding: true } : item
            )
          }
        }
      }
    })

    try {
      await window.api.opencode.replyQuestion({ sessionId, requestId, answers })
      set((state) => {
        const chat = state.opencodeChats[sessionId]
        if (!chat) return state
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: {
              ...chat,
              liveItems: chat.liveItems.filter((item) => !(item.role === 'question' && item.id === requestId))
            }
          }
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OpenCode question reply failed.'
      set((state) => {
        const chat = state.opencodeChats[sessionId]
        if (!chat) return state
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: {
              ...chat,
              error: message,
              liveItems: chat.liveItems.map((item) =>
                item.role === 'question' && item.id === requestId ? { ...item, responding: false } : item
              )
            }
          }
        }
      })
    }
  },

  rejectOpenCodeQuestion: async (sessionId, requestId) => {
    const current = get().opencodeChats[sessionId]
    const question = current?.liveItems.find((item) => item.role === 'question' && item.id === requestId)
    if (!question || question.role !== 'question' || question.responding) return

    set((state) => {
      const chat = state.opencodeChats[sessionId]
      if (!chat) return state
      return {
        opencodeChats: {
          ...state.opencodeChats,
          [sessionId]: {
            ...chat,
            error: null,
            liveItems: chat.liveItems.map((item) =>
              item.role === 'question' && item.id === requestId ? { ...item, responding: true } : item
            )
          }
        }
      }
    })

    try {
      await window.api.opencode.rejectQuestion({ sessionId, requestId })
      set((state) => {
        const chat = state.opencodeChats[sessionId]
        if (!chat) return state
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: {
              ...chat,
              liveItems: chat.liveItems.filter((item) => !(item.role === 'question' && item.id === requestId))
            }
          }
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OpenCode question rejection failed.'
      set((state) => {
        const chat = state.opencodeChats[sessionId]
        if (!chat) return state
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: {
              ...chat,
              error: message,
              liveItems: chat.liveItems.map((item) =>
                item.role === 'question' && item.id === requestId ? { ...item, responding: false } : item
              )
            }
          }
        }
      })
    }
  },

  appendOpenCodeStream: ({ sessionId, item }) =>
    set((state) => {
      const current = state.opencodeChats[sessionId]
      if (!current) return state
      if (current.generation?.status === 'cancelled' && item.kind !== 'status') return state

      if (item.kind === 'question') {
        const liveItems =
          item.status === 'asked'
            ? upsertLiveItem(current.liveItems, item)
            : current.liveItems.filter((liveItem) => liveItem.id !== item.requestId)
        const generation =
          item.status === 'asked'
            ? updateGenerationState(current.generation, item)
            : current.generation?.live
              ? {
                  ...current.generation,
                  live: { ...current.generation.live, toolWaiting: false }
                }
              : current.generation
        const subagents = item.subagentId
          ? current.subagents.map((subagent) =>
              subagent.id === item.subagentId
                ? { ...subagent, status: item.status === 'asked' ? ('waiting' as const) : ('working' as const) }
                : subagent
            )
          : current.subagents
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: { ...current, generation, liveItems, subagents }
          }
        }
      }

      if (item.kind === 'subagent') {
        const previous = current.subagents.find((subagent) => subagent.id === item.subagent.id)
        const existingSubagents = item.replacesId
          ? current.subagents.filter((subagent) => subagent.id !== item.replacesId)
          : current.subagents
        let liveItems = current.liveItems
        if (item.permission) {
          liveItems = upsertLiveItem(liveItems, {
            kind: 'permission',
            requestId: item.permission.requestId,
            permission: item.permission.permission,
            patterns: item.permission.patterns,
            ...(item.permission.title ? { title: item.permission.title } : {}),
            subagentId: item.subagent.id
          })
        }
        if (item.permissionResolved) {
          liveItems = liveItems.filter((liveItem) => liveItem.id !== item.permissionResolved)
        }
        const finished =
          previous && subagentIsActive(previous) &&
          (item.subagent.status === 'completed' ||
            item.subagent.status === 'error' ||
            item.subagent.status === 'cancelled')
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: {
              ...current,
              generation:
                current.pending && current.generation?.live
                  ? {
                      ...current.generation,
                      live: {
                        ...current.generation.live,
                        phase: 'tool',
                        toolWaiting: item.subagent.status === 'working' || item.subagent.status === 'waiting'
                      }
                    }
                  : current.generation,
              subagents: upsertSubagent(existingSubagents, item.subagent),
              liveItems,
              unreadCompletion:
                finished && state.selectedSessionId !== sessionId ? true : current.unreadCompletion
            }
          }
        }
      }

      if (item.kind === 'status') {
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: {
              ...current,
              externalBusy: item.status === 'busy' && !current.pending
            }
          }
        }
      }

      if (item.kind === 'compaction') {
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: { ...current, compacting: item.status === 'started' }
          }
        }
      }

      // Ordinary text/tool/reasoning deltas outside a parent turn belong to no
      // visible message, while subagent status events are handled above.
      if (!current.pending) return state
      const generation = updateGenerationState(current.generation, item)
      return {
        opencodeChats: {
          ...state.opencodeChats,
          [sessionId]: { ...current, generation, liveItems: upsertLiveItem(current.liveItems, item) }
        }
      }
    }),

  appendOpenCodeTuiStatus: ({ sessionId, status, attentionReason, revision }) =>
    set((state) => {
      if (status === null) {
        if (!state.opencodeTuiStatuses[sessionId]) return state
        const opencodeTuiStatuses = { ...state.opencodeTuiStatuses }
        delete opencodeTuiStatuses[sessionId]
        return { opencodeTuiStatuses }
      }

      const previous = state.opencodeTuiStatuses[sessionId]
      if (previous?.revision === revision && previous.status === status && previous.attentionReason === attentionReason) {
        return state
      }
      return {
        opencodeTuiStatuses: {
          ...state.opencodeTuiStatuses,
          [sessionId]: {
            status,
            ...(attentionReason ? { attentionReason } : {}),
            revision,
            unread:
              status === 'completed' || status === 'error'
                ? state.selectedSessionId !== sessionId
                : previous?.unread ?? false
          }
        }
      }
    }),

  refreshDistros: async () => {
    const distros = await window.api.wsl.distros()
    set({ distros })
  }
}))
