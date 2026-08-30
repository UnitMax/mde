import { create } from 'zustand'
import type { PlatformInfo, WorkspaceData } from '@shared/ipc'
import type {
  Distro,
  GitStatusResponse,
  NewProject,
  NewTodoProject,
  NewTodoTask,
  NewSession,
  OpenCodeTuiAttentionReason,
  OpenCodeTuiInstanceLabelMode,
  OpenCodeTuiInstanceStatus,
  OpenCodeTuiInstancesUpdate,
  OpenCodeTuiStatus,
  OpenCodeTuiStatusUpdate,
  Project,
  TodoProject,
  TodoTask,
  PersistedTerminalLayout,
  PtyDirectoryUpdate,
  PtyExitInfo,
  PtyStatus,
  Session,
  SessionColor,
  SessionIcon
} from '@shared/types'
import { disposeSession } from '@/terminal/sessions'
import type { TerminalTaskLinks } from '@/lib/terminal-task-links'

export interface OpenCodeTuiStatusState {
  status: OpenCodeTuiStatus
  attentionReason?: OpenCodeTuiAttentionReason
  revision: number
  unread: boolean
}

export interface GitSessionStatus {
  response: GitStatusResponse | null
  error: string | null
  loading: boolean
}

let eventBridgeReady = false
let gitStatusRefreshPromise: Promise<void> | null = null
let gitStatusRefreshQueued = false

export type WorkspaceView = 'projects' | 'todo'

function belongsToSession(runtimeId: string, sessionId: string): boolean {
  return runtimeId === sessionId || runtimeId.startsWith(`${sessionId}:`)
}

interface WorkspaceState {
  projects: Project[]
  todoProjects: TodoProject[]
  todoTasks: TodoTask[]
  sessions: Session[]
  selectedSessionId: string | null
  selectedTodoProjectId: string | null
  activeWorkspaceView: WorkspaceView
  statuses: Record<string, PtyStatus>
  terminalDirectories: Record<string, string>
  exits: Record<string, PtyExitInfo>
  terminalTaskLinks: TerminalTaskLinks
  gitStatuses: Record<string, GitSessionStatus>
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
  setWorkspaceView: (view: WorkspaceView) => void
  selectTodoProject: (id: string) => void
  toggleSidebar: () => void

  addProject: (input: NewProject) => Promise<Project>
  renameProject: (id: string, name: string) => Promise<void>
  removeProject: (id: string) => Promise<void>

  addTodoProject: (input: NewTodoProject) => Promise<TodoProject>
  renameTodoProject: (id: string, name: string) => Promise<void>
  updateTodoProject: (
    id: string,
    patch: Partial<Pick<TodoProject, 'name'>> & { shorthand?: string }
  ) => Promise<TodoProject | null>
  removeTodoProject: (id: string) => Promise<void>

  addTodoTask: (input: NewTodoTask) => Promise<TodoTask>
  updateTodoTask: (
    id: string,
    patch: Partial<Pick<TodoTask, 'title' | 'description' | 'columnId'>>
  ) => Promise<TodoTask | null>
  moveTodoTask: (id: string, columnId: string, beforeId: string | null) => Promise<boolean>
  removeTodoTask: (id: string) => Promise<void>

  addSession: (input: NewSession) => Promise<Session>
  duplicateSession: (id: string) => Promise<Session | null>
  addTab: (sessionId: string) => Promise<Session | null>
  selectTab: (sessionId: string, tabId: string) => Promise<Session | null>
  renameTab: (sessionId: string, tabId: string, name: string) => Promise<Session | null>
  updateTabLayout: (sessionId: string, tabId: string, layout: PersistedTerminalLayout) => Promise<Session | null>
  removeTab: (sessionId: string, tabId: string) => Promise<Session | null>
  renameSession: (id: string, name: string) => Promise<void>
  setSessionColor: (id: string, color: SessionColor) => Promise<void>
  setSessionIcon: (id: string, icon: SessionIcon | null) => Promise<void>
  moveSession: (id: string, projectId: string) => Promise<void>
  reorderSession: (id: string, beforeId: string | null) => Promise<void>
  removeSession: (id: string) => Promise<void>
  revealSession: (id: string) => Promise<void>
  openSessionInVsCode: (id: string) => Promise<void>
  refreshGitStatuses: () => Promise<void>

  setStatus: (id: string, status: PtyStatus) => void
  linkTerminalToTodoTask: (terminalId: string, taskId: string) => void
  unlinkTerminalTask: (terminalId: string) => void
  unlinkTodoTask: (taskId: string) => void
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
  todoProjects: [],
  todoTasks: [],
  sessions: [],
  selectedSessionId: null,
  selectedTodoProjectId: null,
  activeWorkspaceView: 'projects',
  statuses: {},
  terminalDirectories: {},
  exits: {},
  terminalTaskLinks: {},
  gitStatuses: {},
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

    const { projects, todoProjects, todoTasks, sessions } = workspace as WorkspaceData
    set({
      platform,
      projects,
      todoProjects,
      todoTasks,
      sessions,
      statuses,
      // The event bridge may receive a report while these startup requests
      // are in flight. Preserve that newer event over the initial snapshot.
      terminalDirectories: { ...directories, ...get().terminalDirectories },
      gitStatuses: {},
      opencodeTuiStatuses: {},
      opencodeTuiInstanceLabelMode: opencodeTuiSettings.instanceLabelMode,
      wslAvailable,
      selectedSessionId: null,
      selectedTodoProjectId: todoProjects[0]?.id ?? null,
      activeWorkspaceView: 'projects',
      ready: true
    })

    if (wslAvailable) void get().refreshDistros()
  },

  selectSession: (id) =>
    set((state) => {
      const tuiStatus = id ? state.opencodeTuiStatuses[id] : undefined
      if (!id || !tuiStatus?.unread) {
        return {
          selectedSessionId: id,
          ...(id ? { activeWorkspaceView: 'projects' as const } : {})
        }
      }
      const opencodeTuiStatuses = { ...state.opencodeTuiStatuses }
      opencodeTuiStatuses[id] = { ...tuiStatus, unread: false }
      return {
        selectedSessionId: id,
        activeWorkspaceView: 'projects',
        opencodeTuiStatuses
      }
    }),

  setWorkspaceView: (view) =>
    set((state) => ({
      activeWorkspaceView: view,
      ...(view === 'todo' && !state.todoProjects.some(
        (project) => project.id === state.selectedTodoProjectId
      )
        ? { selectedTodoProjectId: state.todoProjects[0]?.id ?? null }
        : {})
    })),

  selectTodoProject: (id) =>
    set((state) =>
      state.todoProjects.some((project) => project.id === id)
        ? { selectedTodoProjectId: id, activeWorkspaceView: 'todo' }
        : {}
    ),

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
      const terminalDirectories = { ...state.terminalDirectories }
      const exits = { ...state.exits }
      const terminalTaskLinks = { ...state.terminalTaskLinks }
      const gitStatuses = { ...state.gitStatuses }
      const opencodeTuiStatuses = { ...state.opencodeTuiStatuses }
      const opencodeTuiInstances = { ...state.opencodeTuiInstances }
      childIds.forEach((sessionId) => {
        Object.keys(statuses).filter((id) => belongsToSession(id, sessionId)).forEach((id) => delete statuses[id])
        Object.keys(terminalDirectories).filter((id) => belongsToSession(id, sessionId)).forEach((id) => delete terminalDirectories[id])
        Object.keys(exits).filter((id) => belongsToSession(id, sessionId)).forEach((id) => delete exits[id])
        Object.keys(terminalTaskLinks)
          .filter((id) => belongsToSession(id, sessionId))
          .forEach((id) => delete terminalTaskLinks[id])
        delete gitStatuses[sessionId]
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
        terminalDirectories,
        exits,
        terminalTaskLinks,
        gitStatuses,
        opencodeTuiStatuses,
        opencodeTuiInstances
      }
    })
  },

  addTodoProject: async (input) => {
    const project = await window.api.todoProjects.create(input)
    set((state) => ({
      todoProjects: [...state.todoProjects, project],
      selectedTodoProjectId: project.id,
      activeWorkspaceView: 'todo'
    }))
    return project
  },

  renameTodoProject: async (id, name) => {
    await get().updateTodoProject(id, { name })
  },

  updateTodoProject: async (id, patch) => {
    const updated = await window.api.todoProjects.update({ id, patch })
    if (!updated) return null
    set((state) => ({
      todoProjects: state.todoProjects.map((project) => project.id === id ? updated : project)
    }))
    return updated
  },

  removeTodoProject: async (id) => {
    const removedTaskIds = get()
      .todoTasks
      .filter((task) => task.todoProjectId === id)
      .map((task) => task.id)
    await window.api.todoProjects.remove(id)
    set((state) => {
      const removedIndex = state.todoProjects.findIndex((project) => project.id === id)
      const todoProjects = state.todoProjects.filter((project) => project.id !== id)
      const selectedTodoProjectId = state.selectedTodoProjectId === id
        ? todoProjects[Math.min(removedIndex, todoProjects.length - 1)]?.id ?? null
        : state.selectedTodoProjectId
      const terminalTaskLinks = { ...state.terminalTaskLinks }
      removedTaskIds.forEach((taskId) => {
        Object.entries(terminalTaskLinks)
          .filter(([, linkedTaskId]) => linkedTaskId === taskId)
          .forEach(([terminalId]) => delete terminalTaskLinks[terminalId])
      })
      return {
        todoProjects,
        todoTasks: state.todoTasks.filter((task) => task.todoProjectId !== id),
        selectedTodoProjectId,
        terminalTaskLinks
      }
    })
  },

  addTodoTask: async (input) => {
    const task = await window.api.todoTasks.create(input)
    set((state) => ({
      todoTasks: [...state.todoTasks, task],
      todoProjects: state.todoProjects.map((project) =>
        project.id === task.todoProjectId && project.nextTaskNumber <= task.number
          ? { ...project, nextTaskNumber: task.number + 1 }
          : project
      )
    }))
    return task
  },

  updateTodoTask: async (id, patch) => {
    const updated = await window.api.todoTasks.update({ id, patch })
    if (!updated) return null
    set((state) => {
      const todoTasks = state.todoTasks.filter((task) => task.id !== id)
      const existingIndex = state.todoTasks.findIndex((task) => task.id === id)
      const existing = state.todoTasks[existingIndex]
      if (existing?.columnId === updated.columnId) todoTasks.splice(existingIndex, 0, updated)
      else todoTasks.push(updated)
      return { todoTasks }
    })
    return updated
  },

  moveTodoTask: async (id, columnId, beforeId) => {
    const todoTasks = await window.api.todoTasks.move({ id, columnId, beforeId })
    if (!todoTasks) return false
    set({ todoTasks })
    return true
  },

  removeTodoTask: async (id) => {
    await window.api.todoTasks.remove(id)
    set((state) => {
      const terminalTaskLinks = { ...state.terminalTaskLinks }
      Object.entries(terminalTaskLinks)
        .filter(([, linkedTaskId]) => linkedTaskId === id)
        .forEach(([terminalId]) => delete terminalTaskLinks[terminalId])
      return {
        todoTasks: state.todoTasks.filter((task) => task.id !== id),
        terminalTaskLinks
      }
    })
  },

  addSession: async (input) => {
    const session = await window.api.sessions.create(input)
    set((state) => ({
      sessions: [...state.sessions, session],
      selectedSessionId: session.id,
      activeWorkspaceView: 'projects'
    }))
    return session
  },

  duplicateSession: async (id) => {
    const session = await window.api.sessions.duplicate(id)
    if (!session) return null
    set((state) => ({
      sessions: [...state.sessions, session],
      selectedSessionId: session.id,
      activeWorkspaceView: 'projects'
    }))
    return session
  },

  addTab: async (sessionId) => {
    const updated = await window.api.tabs.create({ sessionId })
    if (!updated) return null
    set((state) => ({ sessions: state.sessions.map((session) => session.id === updated.id ? updated : session) }))
    return updated
  },

  selectTab: async (sessionId, tabId) => {
    const updated = await window.api.tabs.select({ sessionId, tabId })
    if (!updated) return null
    set((state) => ({ sessions: state.sessions.map((session) => session.id === updated.id ? updated : session) }))
    return updated
  },

  renameTab: async (sessionId, tabId, name) => {
    const updated = await window.api.tabs.update({ sessionId, tabId, patch: { name } })
    if (!updated) return null
    set((state) => ({ sessions: state.sessions.map((session) => session.id === updated.id ? updated : session) }))
    return updated
  },

  updateTabLayout: async (sessionId, tabId, layout) => {
    const updated = await window.api.tabs.update({ sessionId, tabId, patch: { layout } })
    if (!updated) return null
    set((state) => ({ sessions: state.sessions.map((session) => session.id === updated.id ? updated : session) }))
    return updated
  },

  removeTab: async (sessionId, tabId) => {
    const updated = await window.api.tabs.remove({ sessionId, tabId })
    if (!updated) return null
    set((state) => ({ sessions: state.sessions.map((session) => session.id === updated.id ? updated : session) }))
    return updated
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
      const terminalDirectories = { ...state.terminalDirectories }
      const exits = { ...state.exits }
      const terminalTaskLinks = { ...state.terminalTaskLinks }
      const gitStatuses = { ...state.gitStatuses }
      const opencodeTuiStatuses = { ...state.opencodeTuiStatuses }
      const opencodeTuiInstances = { ...state.opencodeTuiInstances }
      Object.keys(statuses).filter((runtimeId) => belongsToSession(runtimeId, id)).forEach((runtimeId) => delete statuses[runtimeId])
      Object.keys(terminalDirectories).filter((runtimeId) => belongsToSession(runtimeId, id)).forEach((runtimeId) => delete terminalDirectories[runtimeId])
      Object.keys(exits).filter((runtimeId) => belongsToSession(runtimeId, id)).forEach((runtimeId) => delete exits[runtimeId])
      Object.keys(terminalTaskLinks)
        .filter((runtimeId) => belongsToSession(runtimeId, id))
        .forEach((runtimeId) => delete terminalTaskLinks[runtimeId])
      delete gitStatuses[id]
      delete opencodeTuiStatuses[id]
      delete opencodeTuiInstances[id]
      return {
        sessions: state.sessions.filter((session) => session.id !== id),
        selectedSessionId: state.selectedSessionId === id ? null : state.selectedSessionId,
        statuses,
        terminalDirectories,
        exits,
        terminalTaskLinks,
        gitStatuses,
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

  refreshGitStatuses: async () => {
    if (gitStatusRefreshPromise) {
      gitStatusRefreshQueued = true
      return gitStatusRefreshPromise
    }

    const sessions = get().sessions
    if (sessions.length === 0) {
      set({ gitStatuses: {} })
      return
    }

    set((state) => {
      const gitStatuses = { ...state.gitStatuses }
      const sessionIds = new Set(sessions.map((session) => session.id))
      Object.keys(gitStatuses)
        .filter((sessionId) => !sessionIds.has(sessionId))
        .forEach((sessionId) => delete gitStatuses[sessionId])
      sessions.forEach((session) => {
        const previous = gitStatuses[session.id]
        gitStatuses[session.id] = {
          response: previous?.response ?? null,
          error: null,
          loading: true
        }
      })
      return { gitStatuses }
    })

    const refresh = (async (): Promise<void> => {
      const results = await Promise.all(
        sessions.map(async (session) => {
          try {
            const response = await window.api.git.status({ sessionId: session.id })
            return {
              id: session.id,
              value: { response, error: null, loading: false } satisfies GitSessionStatus
            }
          } catch (reason) {
            return {
              id: session.id,
              value: {
                response: null,
                error: reason instanceof Error ? reason.message : 'Could not load Git status.',
                loading: false
              } satisfies GitSessionStatus
            }
          }
        })
      )

      set((state) => {
        const activeIds = new Set(state.sessions.map((session) => session.id))
        const gitStatuses: Record<string, GitSessionStatus> = {}
        results.forEach(({ id, value }) => {
          if (activeIds.has(id)) gitStatuses[id] = value
        })
        return { gitStatuses }
      })
    })()

    gitStatusRefreshPromise = refresh
    try {
      await refresh
    } finally {
      if (gitStatusRefreshPromise === refresh) gitStatusRefreshPromise = null
      if (gitStatusRefreshQueued) {
        gitStatusRefreshQueued = false
        void get().refreshGitStatuses()
      }
    }
  },

  setStatus: (id, status) =>
    set((state) => {
      const terminalTaskLinks = { ...state.terminalTaskLinks }
      if (status !== 'running') delete terminalTaskLinks[id]
      return {
        statuses: { ...state.statuses, [id]: status },
        terminalTaskLinks
      }
    }),

  linkTerminalToTodoTask: (terminalId, taskId) =>
    set((state) => {
      if (!state.todoTasks.some((task) => task.id === taskId)) return state
      const terminalTaskLinks = { ...state.terminalTaskLinks }
      delete terminalTaskLinks[terminalId]
      Object.entries(terminalTaskLinks)
        .filter(([, linkedTaskId]) => linkedTaskId === taskId)
        .forEach(([linkedTerminalId]) => delete terminalTaskLinks[linkedTerminalId])
      terminalTaskLinks[terminalId] = taskId
      return { terminalTaskLinks }
    }),

  unlinkTerminalTask: (terminalId) =>
    set((state) => {
      if (!state.terminalTaskLinks[terminalId]) return state
      const terminalTaskLinks = { ...state.terminalTaskLinks }
      delete terminalTaskLinks[terminalId]
      return { terminalTaskLinks }
    }),

  unlinkTodoTask: (taskId) =>
    set((state) => {
      const terminalTaskLinks = { ...state.terminalTaskLinks }
      Object.entries(terminalTaskLinks)
        .filter(([, linkedTaskId]) => linkedTaskId === taskId)
        .forEach(([terminalId]) => delete terminalTaskLinks[terminalId])
      return { terminalTaskLinks }
    }),

  setTerminalDirectory: (update) =>
    set((state) => {
      const terminalDirectories = { ...state.terminalDirectories }
      if (update.directory === null) delete terminalDirectories[update.terminalId]
      else terminalDirectories[update.terminalId] = update.directory
      return { terminalDirectories }
    }),

  noteExit: (info) =>
    set((state) => {
      const terminalTaskLinks = { ...state.terminalTaskLinks }
      delete terminalTaskLinks[info.terminalId]
      return {
        statuses: { ...state.statuses, [info.terminalId]: 'exited' },
        exits: { ...state.exits, [info.terminalId]: info },
        terminalTaskLinks
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
