import { create } from 'zustand'
import type { PlatformInfo, WorkspaceData } from '@shared/ipc'
import type {
  Distro,
  NewProject,
  NewSession,
  OpenCodeChatItem,
  OpenCodeChatMessage,
  OpenCodeLiveChatItem,
  OpenCodeModelOption,
  OpenCodeModelSelection,
  OpenCodeSubagent,
  OpenCodePermissionReply,
  OpenCodeSessionSummary,
  OpenCodeStreamChunk,
  Project,
  PtyExitInfo,
  PtyStatus,
  Session
} from '@shared/types'
import { disposeSession } from '@/terminal/sessions'

export interface OpenCodeChatState {
  messages: OpenCodeChatItem[]
  availableSessions: OpenCodeSessionSummary[]
  availableModels: OpenCodeModelOption[]
  selectedModel: OpenCodeModelSelection | null
  subagents: OpenCodeSubagent[]
  openCodeSessionId: string | null
  liveItems: OpenCodeLiveChatItem[]
  pending: boolean
  sessionsLoading: boolean
  modelsLoading: boolean
  error: string | null
  unreadCompletion: boolean
}

const EMPTY_CHAT: OpenCodeChatState = {
  messages: [],
  availableSessions: [],
  availableModels: [],
  selectedModel: null,
  subagents: [],
  openCodeSessionId: null,
  liveItems: [],
  pending: false,
  sessionsLoading: false,
  modelsLoading: false,
  error: null,
  unreadCompletion: false
}
let eventBridgeReady = false

function upsertLiveItem(items: OpenCodeLiveChatItem[], item: OpenCodeStreamChunk['item']): OpenCodeLiveChatItem[] {
  if (item.kind === 'subagent') return items
  const id = item.kind === 'permission' ? item.requestId : item.partId
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

function retainActiveSubagentPermissions(
  liveItems: OpenCodeLiveChatItem[],
  subagents: OpenCodeSubagent[]
): OpenCodeLiveChatItem[] {
  return liveItems.filter(
    (item) =>
      item.role === 'permission' &&
      item.subagentId !== undefined &&
      subagents.some((subagent) => subagent.id === item.subagentId && subagentIsActive(subagent))
  )
}

interface WorkspaceState {
  projects: Project[]
  sessions: Session[]
  selectedSessionId: string | null
  statuses: Record<string, PtyStatus>
  exits: Record<string, PtyExitInfo>
  opencodeChats: Record<string, OpenCodeChatState>
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
  renameSession: (id: string, name: string) => Promise<void>
  moveSession: (id: string, projectId: string) => Promise<void>
  removeSession: (id: string) => Promise<void>
  revealSession: (id: string) => Promise<void>

  setStatus: (id: string, status: PtyStatus) => void
  noteExit: (info: PtyExitInfo) => void
  clearExit: (id: string) => void
  persistOpenCodeSelection: (sessionId: string, openCodeSessionId: string | null) => Promise<void>
  loadOpenCodeModels: (sessionId: string) => Promise<void>
  selectOpenCodeModel: (sessionId: string, model: OpenCodeModelSelection) => Promise<void>
  refreshOpenCodeSessionList: (sessionId: string) => Promise<void>
  loadOpenCodeSessions: (sessionId: string) => Promise<void>
  selectOpenCodeSession: (sessionId: string, openCodeSessionId: string) => Promise<void>
  createOpenCodeSession: (sessionId: string) => Promise<void>
  sendOpenCodeMessage: (sessionId: string, text: string) => Promise<void>
  replyOpenCodePermission: (
    sessionId: string,
    requestId: string,
    reply: OpenCodePermissionReply
  ) => Promise<void>
  appendOpenCodeStream: (chunk: OpenCodeStreamChunk) => void
  refreshDistros: () => Promise<void>
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  projects: [],
  sessions: [],
  selectedSessionId: null,
  statuses: {},
  exits: {},
  opencodeChats: {},
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
      window.api.opencode.onStream((chunk) => get().appendOpenCodeStream(chunk))
    }

    const [platform, workspace, statuses, wslAvailable] = await Promise.all([
      window.api.platform.info(),
      window.api.workspace.list(),
      window.api.pty.statuses(),
      window.api.wsl.available()
    ])

    const { projects, sessions } = workspace as WorkspaceData
    set({
      platform,
      projects,
      sessions,
      statuses,
      wslAvailable,
      selectedSessionId: null,
      ready: true
    })

    if (wslAvailable) void get().refreshDistros()
  },

  selectSession: (id) =>
    set((state) => {
      const chat = id ? state.opencodeChats[id] : undefined
      if (!id || !chat?.unreadCompletion) return { selectedSessionId: id }
      return {
        selectedSessionId: id,
        opencodeChats: {
          ...state.opencodeChats,
          [id]: { ...chat, unreadCompletion: false }
        }
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
      childIds.forEach((sessionId) => {
        delete statuses[sessionId]
        delete exits[sessionId]
        delete opencodeChats[sessionId]
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
        opencodeChats
      }
    })
  },

  addSession: async (input) => {
    const session = await window.api.sessions.create(input)
    set((state) => ({ sessions: [...state.sessions, session], selectedSessionId: session.id }))
    return session
  },

  renameSession: async (id, name) => {
    const updated = await window.api.sessions.update({ id, patch: { name } })
    if (!updated) return
    set((state) => ({ sessions: state.sessions.map((session) => (session.id === id ? updated : session)) }))
  },

  moveSession: async (id, projectId) => {
    const updated = await window.api.sessions.move({ id, projectId })
    if (!updated) return
    set((state) => ({ sessions: state.sessions.map((session) => (session.id === id ? updated : session)) }))
  },

  removeSession: async (id) => {
    await window.api.sessions.remove(id)
    disposeSession(id)
    set((state) => {
      const statuses = { ...state.statuses }
      const exits = { ...state.exits }
      const opencodeChats = { ...state.opencodeChats }
      delete statuses[id]
      delete exits[id]
      delete opencodeChats[id]
      return {
        sessions: state.sessions.filter((session) => session.id !== id),
        selectedSessionId: state.selectedSessionId === id ? null : state.selectedSessionId,
        statuses,
        exits,
        opencodeChats
      }
    })
  },

  revealSession: async (id) => {
    await window.api.paths.reveal(id)
  },

  setStatus: (id, status) =>
    set((state) => ({ statuses: { ...state.statuses, [id]: status } })),

  noteExit: (info) =>
    set((state) => ({
      statuses: { ...state.statuses, [info.sessionId]: 'exited' },
      exits: { ...state.exits, [info.sessionId]: info }
    })),

  clearExit: (id) =>
    set((state) => {
      const exits = { ...state.exits }
      delete exits[id]
      return { exits }
    }),

  persistOpenCodeSelection: async (sessionId, openCodeSessionId) => {
    try {
      const updated = await window.api.sessions.update({
        id: sessionId,
        patch: { opencodeSessionId: openCodeSessionId ?? '' }
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
    const selected = current ? findModel(current.availableModels, model) : null
    if (!selected) return
    const openCodeSessionId = current?.openCodeSessionId
    if (!openCodeSessionId) return

    const workspaceSession = get().sessions.find((session) => session.id === sessionId)
    const selections = {
      ...(workspaceSession?.opencodeModelSelections ?? {}),
      [openCodeSessionId]: selected
    }
    set((state) => ({
      opencodeChats: {
        ...state.opencodeChats,
        [sessionId]: { ...(state.opencodeChats[sessionId] ?? EMPTY_CHAT), selectedModel: selected, error: null }
      }
    }))

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

  refreshOpenCodeSessionList: async (sessionId) => {
    try {
      const result = await window.api.opencode.listSessions({ sessionId })
      const current = get().opencodeChats[sessionId]
      if (!current) return
      set((state) => ({
        opencodeChats: {
          ...state.opencodeChats,
          [sessionId]: {
            ...current,
            availableSessions: result.sessions,
            openCodeSessionId: result.selectedSessionId,
            selectedModel: result.selectedSessionId
              ? findModel(
                  current.availableModels,
                  get().sessions.find((session) => session.id === sessionId)?.opencodeModelSelections?.[
                    result.selectedSessionId
                  ]
                )
              : null,
            ...(result.selectedSessionId ? {} : { messages: [], liveItems: [] })
          }
        }
      }))
      if (result.selectedSessionId && result.selectedSessionId !== current.openCodeSessionId) {
        await get().persistOpenCodeSelection(sessionId, result.selectedSessionId)
      } else if (!result.selectedSessionId && current.openCodeSessionId) {
        await get().persistOpenCodeSelection(sessionId, null)
      }
    } catch {
      // A successful response should remain visible even if refreshing the picker fails.
    }
  },

  sendOpenCodeMessage: async (sessionId, text) => {
    const prompt = text.trim()
    if (!prompt) return

    const selectedModel = get().opencodeChats[sessionId]?.selectedModel
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

    set((state) => {
      const previous = state.opencodeChats[sessionId] ?? EMPTY_CHAT
      return {
        opencodeChats: {
          ...state.opencodeChats,
          [sessionId]: {
            ...previous,
            messages: [...previous.messages, userMessage],
            liveItems: retainActiveSubagentPermissions(previous.liveItems, previous.subagents),
            subagents: previous.subagents.filter(subagentIsActive),
            pending: true,
            sessionsLoading: false,
            error: null,
            unreadCompletion: false
          }
        }
      }
    })

    try {
      const { sessionId: openCodeSessionId, messages } = await window.api.opencode.send({
        sessionId,
        text: prompt,
        model: selectedModel
      })
      set((state) => {
        const current = state.opencodeChats[sessionId]
        if (!current) return state
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: {
              ...current,
              // The returned transcript supersedes the streamed preview.
              messages: [...current.messages, ...messages],
              openCodeSessionId,
              pending: false,
              liveItems: retainActiveSubagentPermissions(current.liveItems, current.subagents),
              unreadCompletion: state.selectedSessionId !== sessionId
            }
          }
        }
      })
      await get().persistOpenCodeSelection(sessionId, openCodeSessionId)
      await get().refreshOpenCodeSessionList(sessionId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OpenCode request failed.'
      set((state) => {
        const current = state.opencodeChats[sessionId]
        if (!current) return state
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: {
              ...current,
              pending: false,
              error: message,
              liveItems: retainActiveSubagentPermissions(current.liveItems, current.subagents),
              unreadCompletion: state.selectedSessionId !== sessionId
            }
          }
        }
      })
    }
  },

  loadOpenCodeSessions: async (sessionId) => {
    const existing = get().opencodeChats[sessionId]
    if (existing?.pending || existing?.sessionsLoading) return

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
    if (current?.pending || current?.sessionsLoading) return

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
              availableSessions: result.session
                ? previous.availableSessions.some((item) => item.id === result.session?.id)
                  ? previous.availableSessions.map((item) =>
                      item.id === result.session?.id ? result.session : item
                    )
                  : [result.session, ...previous.availableSessions]
                : previous.availableSessions,
              openCodeSessionId: result.sessionId,
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
    if (current?.pending || current?.sessionsLoading) return

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
      const result = await window.api.opencode.createSession({ sessionId })
      set((state) => {
        const previous = state.opencodeChats[sessionId] ?? EMPTY_CHAT
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: {
              ...previous,
              messages: [],
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

  appendOpenCodeStream: ({ sessionId, item }) =>
    set((state) => {
      const current = state.opencodeChats[sessionId]
      if (!current) return state

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
              subagents: upsertSubagent(existingSubagents, item.subagent),
              liveItems,
              unreadCompletion:
                finished && state.selectedSessionId !== sessionId ? true : current.unreadCompletion
            }
          }
        }
      }

      // Ordinary text/tool/reasoning deltas outside a parent turn belong to no
      // visible message, while subagent status events are handled above.
      if (!current.pending) return state
      return {
        opencodeChats: {
          ...state.opencodeChats,
          [sessionId]: { ...current, liveItems: upsertLiveItem(current.liveItems, item) }
        }
      }
    }),

  refreshDistros: async () => {
    const distros = await window.api.wsl.distros()
    set({ distros })
  }
}))
