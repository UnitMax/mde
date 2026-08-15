import { create } from 'zustand'
import type { PlatformInfo, WorkspaceData } from '@shared/ipc'
import type {
  Distro,
  NewProject,
  NewSession,
  OpenCodeChatItem,
  OpenCodeChatMessage,
  OpenCodeLiveChatItem,
  OpenCodeStreamChunk,
  Project,
  PtyExitInfo,
  PtyStatus,
  Session
} from '@shared/types'
import { disposeSession } from '@/terminal/sessions'

export interface OpenCodeChatState {
  messages: OpenCodeChatItem[]
  liveItems: OpenCodeLiveChatItem[]
  pending: boolean
  error: string | null
}

const EMPTY_CHAT: OpenCodeChatState = { messages: [], liveItems: [], pending: false, error: null }
let eventBridgeReady = false

function upsertLiveItem(items: OpenCodeLiveChatItem[], item: OpenCodeStreamChunk['item']): OpenCodeLiveChatItem[] {
  const id = item.partId
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
  sendOpenCodeMessage: (sessionId: string, text: string) => Promise<void>
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

  selectSession: (id) => set({ selectedSessionId: id }),

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

  sendOpenCodeMessage: async (sessionId, text) => {
    const prompt = text.trim()
    if (!prompt) return

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
            messages: [...previous.messages, userMessage],
            liveItems: [],
            pending: true,
            error: null
          }
        }
      }
    })

    try {
      const { messages } = await window.api.opencode.send({ sessionId, text: prompt })
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
              pending: false,
              liveItems: []
            }
          }
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OpenCode request failed.'
      set((state) => {
        const current = state.opencodeChats[sessionId]
        if (!current) return state
        return {
          opencodeChats: {
            ...state.opencodeChats,
            [sessionId]: { ...current, pending: false, error: message, liveItems: [] }
          }
        }
      })
    }
  },

  appendOpenCodeStream: ({ sessionId, item }) =>
    set((state) => {
      const current = state.opencodeChats[sessionId]
      // Deltas that arrive outside a turn belong to no visible message.
      if (!current?.pending) return state
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
