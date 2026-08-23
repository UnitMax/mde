import { create } from 'zustand'
import type { PlatformInfo, WorkspaceData } from '@shared/ipc'
import type {
  Distro,
  NewProject,
  NewSession,
  OpenCodeTuiAttentionReason,
  OpenCodeTuiInstanceLabelMode,
  OpenCodeTuiInstanceStatus,
  OpenCodeTuiInstancesUpdate,
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

export interface OpenCodeTuiStatusState {
  status: OpenCodeTuiStatus
  attentionReason?: OpenCodeTuiAttentionReason
  revision: number
  unread: boolean
}

let eventBridgeReady = false

interface WorkspaceState {
  projects: Project[]
  sessions: Session[]
  selectedSessionId: string | null
  statuses: Record<string, PtyStatus>
  terminalDirectories: Record<string, string>
  exits: Record<string, PtyExitInfo>
  opencodeTuiStatuses: Record<string, OpenCodeTuiStatusState>
  opencodeTuiInstances: Record<string, OpenCodeTuiInstanceStatus[]>
  opencodeTuiInstanceLabelMode: OpenCodeTuiInstanceLabelMode
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
  appendOpenCodeTuiStatus: (update: OpenCodeTuiStatusUpdate) => void
  appendOpenCodeTuiInstances: (update: OpenCodeTuiInstancesUpdate) => void
  setOpenCodeTuiInstanceLabelMode: (mode: OpenCodeTuiInstanceLabelMode) => Promise<void>
  refreshDistros: () => Promise<void>
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  projects: [],
  sessions: [],
  selectedSessionId: null,
  statuses: {},
  terminalDirectories: {},
  exits: {},
  opencodeTuiStatuses: {},
  opencodeTuiInstances: {},
  opencodeTuiInstanceLabelMode: 'numbered',
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
      window.api.opencodeTui.onStatus((update) => get().appendOpenCodeTuiStatus(update))
      window.api.opencodeTui.onInstances((update) => get().appendOpenCodeTuiInstances(update))
    }

    const [platform, workspace, statuses, directories, wslAvailable, opencodeTuiSettings] = await Promise.all([
      window.api.platform.info(),
      window.api.workspace.list(),
      window.api.pty.statuses(),
      window.api.pty.directories(),
      window.api.wsl.available(),
      window.api.opencodeTui.settings()
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
      opencodeTuiInstanceLabelMode: opencodeTuiSettings.instanceLabelMode,
      wslAvailable,
      selectedSessionId: null,
      ready: true
    })

    if (wslAvailable) void get().refreshDistros()
  },

  selectSession: (id) =>
    set((state) => {
      const tuiStatus = id ? state.opencodeTuiStatuses[id] : undefined
      if (!id || !tuiStatus?.unread) return { selectedSessionId: id }
      const opencodeTuiStatuses = { ...state.opencodeTuiStatuses }
      opencodeTuiStatuses[id] = { ...tuiStatus, unread: false }
      return {
        selectedSessionId: id,
        opencodeTuiStatuses
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
      const opencodeTuiStatuses = { ...state.opencodeTuiStatuses }
      const opencodeTuiInstances = { ...state.opencodeTuiInstances }
      childIds.forEach((sessionId) => {
        delete statuses[sessionId]
        delete exits[sessionId]
        delete opencodeTuiStatuses[sessionId]
        delete opencodeTuiInstances[sessionId]
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
        opencodeTuiStatuses,
        opencodeTuiInstances
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
      const opencodeTuiStatuses = { ...state.opencodeTuiStatuses }
      const opencodeTuiInstances = { ...state.opencodeTuiInstances }
      delete statuses[id]
      delete exits[id]
      delete opencodeTuiStatuses[id]
      delete opencodeTuiInstances[id]
      return {
        sessions: state.sessions.filter((session) => session.id !== id),
        selectedSessionId: state.selectedSessionId === id ? null : state.selectedSessionId,
        statuses,
        exits,
        opencodeTuiStatuses,
        opencodeTuiInstances
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

  appendOpenCodeTuiInstances: ({ sessionId, instances }) =>
    set((state) => {
      const previous = state.opencodeTuiInstances[sessionId]
      if (instances.length === 0) {
        if (!previous) return state
        const opencodeTuiInstances = { ...state.opencodeTuiInstances }
        delete opencodeTuiInstances[sessionId]
        return { opencodeTuiInstances }
      }
      return {
        opencodeTuiInstances: {
          ...state.opencodeTuiInstances,
          [sessionId]: instances
        }
      }
    }),

  setOpenCodeTuiInstanceLabelMode: async (mode) => {
    const settings = await window.api.opencodeTui.setInstanceLabelMode({ mode })
    set({ opencodeTuiInstanceLabelMode: settings.instanceLabelMode })
  },

  refreshDistros: async () => {
    const distros = await window.api.wsl.distros()
    set({ distros })
  }
}))
