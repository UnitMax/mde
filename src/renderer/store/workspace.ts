import { create } from 'zustand'
import type { PlatformInfo, WorkspaceData } from '@shared/ipc'
import type {
  Distro,
  InboxThread,
  NewTodoProject,
  NewTodoTask,
  NewSession,
  TodoProject,
  TodoTask,
  PersistedTerminalLayout,
  PtyDirectoryUpdate,
  PtyExitInfo,
  PtyStatus,
  Session,
  SessionColor,
  SessionIcon,
  WindowMode
} from '@shared/types'
import { fileRootTerminalId } from '@/lib/file-root'
import { disposeSession } from '@/terminal/sessions'
import { inboxThreadTerminalId } from '@shared/inbox-thread-terminal'
import { viewportSettle } from '@/terminal/viewport-settle'
import { isInboxThreadUnread } from '@/lib/inbox'
import {
  inboxTerminalHighlightTone,
  type InboxTerminalHighlight,
} from '@/lib/inbox-terminal-highlight'

let eventBridgeReady = false

export type WorkspaceView = 'sessions' | 'todo' | 'inbox'

export type SettingsSection =
  | 'appearance'
  | 'terminal'
  | 'shortcuts'
  | 'agents'
  | 'sidebar'
  | 'about'

export interface SettingsDialogState {
  open: boolean
  section: SettingsSection
}

/** Newest activity first, matching the main process order. */
function sortInboxThreads(threads: InboxThread[]): InboxThread[] {
  return [...threads].sort(
    (a, b) => b.lastActivityAt - a.lastActivityAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  )
}

function withInboxThread(threads: readonly InboxThread[], thread: InboxThread): InboxThread[] {
  return sortInboxThreads([...threads.filter((item) => item.id !== thread.id), thread])
}

function belongsToSession(runtimeId: string, sessionId: string): boolean {
  return runtimeId === sessionId || runtimeId.startsWith(`${sessionId}:`)
}

interface WorkspaceState {
  todoProjects: TodoProject[]
  todoTasks: TodoTask[]
  sessions: Session[]
  selectedSessionId: string | null
  selectedTodoProjectId: string | null
  activeWorkspaceView: WorkspaceView
  statuses: Record<string, PtyStatus>
  terminalDirectories: Record<string, string>
  exits: Record<string, PtyExitInfo>
  /** MDE's own record of OpenCode threads, newest activity first. */
  inboxThreads: InboxThread[]
  selectedInboxThreadId: string | null
  /** Threads marked unread by hand and not opened since; they stay unread while open, even after a refocus. */
  inboxMarkedUnread: Record<string, true>
  /** When something new last happened in a thread being read, by thread; drives a brief cue. */
  inboxCues: Record<string, number>
  settingsDialog: SettingsDialogState
  /** Brief border animations for Inbox Terminal chats, keyed by thread ID and never persisted. */
  inboxTerminalHighlights: Record<string, InboxTerminalHighlight>
  platform: PlatformInfo | null
  /** Owned by the main process, which resizes the window; mirrored here to pick the UI. */
  windowMode: WindowMode
  wslAvailable: boolean
  distros: Distro[]
  sidebarCollapsed: boolean
  fileTreeCollapsed: boolean
  /** File open in the viewer per session, relative to the session root. */
  openFiles: Record<string, string>
  ready: boolean

  init: () => Promise<void>
  selectSession: (id: string | null) => void
  setWorkspaceView: (view: WorkspaceView) => void
  selectTodoProject: (id: string) => void
  toggleSidebar: () => void
  toggleFileTree: () => void
  openFile: (rootId: string, path: string) => void
  closeFile: (rootId: string) => void

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
  reorderSession: (id: string, beforeId: string | null) => Promise<void>
  removeSession: (id: string) => Promise<void>

  setStatus: (id: string, status: PtyStatus) => void
  setTerminalDirectory: (update: PtyDirectoryUpdate) => void
  noteExit: (info: PtyExitInfo) => void
  clearExit: (id: string) => void
  clearInboxTerminalHighlight: (threadId: string, token: number) => void
  openSettings: (section?: SettingsSection) => void
  closeSettings: () => void
  selectInboxThread: (id: string | null) => void
  setInboxThreadRead: (id: string, read: boolean) => Promise<void>
  /** Counts the open thread as seen when the window comes back to the front, unless it was marked unread by hand. */
  markOpenInboxThreadSeen: () => void
  setInboxThreadArchived: (id: string, archived: boolean) => Promise<void>
  setInboxThreadPinned: (id: string, pinned: boolean) => Promise<void>
  /** Removes a thread from the Inbox; with `removeWorktree`, its Git worktree goes too, or nothing does. */
  removeInboxThread: (id: string, options?: { removeWorktree?: boolean }) => Promise<void>
  /** Applies a thread pushed by the main process. */
  upsertInboxThread: (thread: InboxThread) => void
  setWindowMode: (mode: WindowMode) => Promise<void>
  refreshDistros: () => Promise<void>
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  todoProjects: [],
  todoTasks: [],
  sessions: [],
  selectedSessionId: null,
  selectedTodoProjectId: null,
  activeWorkspaceView: 'sessions',
  statuses: {},
  terminalDirectories: {},
  exits: {},
  inboxThreads: [],
  selectedInboxThreadId: null,
  inboxMarkedUnread: {},
  inboxCues: {},
  settingsDialog: { open: false, section: 'appearance' },
  inboxTerminalHighlights: {},
  platform: null,
  windowMode: 'normal',
  wslAvailable: false,
  distros: [],
  sidebarCollapsed: false,
  fileTreeCollapsed: false,
  openFiles: {},
  ready: false,

  init: async () => {
    // React StrictMode may run the mount effect more than once in development.
    // These are process-lifetime push subscriptions, so install them once.
    if (!eventBridgeReady) {
      eventBridgeReady = true
      window.api.pty.onExit((info) => get().noteExit(info))
      window.api.pty.onDirectory((update) => get().setTerminalDirectory(update))
      window.api.inbox.onChanged((thread) => get().upsertInboxThread(thread))
      window.api.windowMode.onChanged((windowMode) => set({ windowMode }))
    }

    const [
      platform,
      workspace,
      statuses,
      directories,
      wslAvailable,
      windowMode,
      inboxThreads
    ] = await Promise.all([
      window.api.platform.info(),
      window.api.workspace.list(),
      window.api.pty.statuses(),
      window.api.pty.directories(),
      window.api.wsl.available(),
      // A renderer reload can happen while the window is still in mini mode.
      window.api.windowMode.get(),
      // A local file read; the inbox must never hold up the rest of the workspace.
      window.api.inbox.list().catch(() => [] as InboxThread[])
    ])

    const { todoProjects, todoTasks, sessions } = workspace as WorkspaceData
    set({
      platform,
      windowMode,
      todoProjects,
      todoTasks,
      sessions,
      statuses,
      // The event bridge may receive a report while these startup requests
      // are in flight. Preserve that newer event over the initial snapshot.
      terminalDirectories: { ...directories, ...get().terminalDirectories },
      // Pushes that arrived during startup are newer than the listed snapshot.
      inboxThreads: get().inboxThreads.reduce(withInboxThread, sortInboxThreads(inboxThreads)),
      wslAvailable,
      selectedSessionId: null,
      selectedTodoProjectId: todoProjects[0]?.id ?? null,
      activeWorkspaceView: 'sessions',
      ready: true
    })

    if (wslAvailable) void get().refreshDistros()
  },

  selectSession: (id) => set({ selectedSessionId: id, ...(id ? { activeWorkspaceView: 'sessions' as const } : {}) }),

  setWorkspaceView: (view) => {
    set((state) => ({
      activeWorkspaceView: view,
      ...(view === 'todo' && !state.todoProjects.some(
        (project) => project.id === state.selectedTodoProjectId
      )
        ? { selectedTodoProjectId: state.todoProjects[0]?.id ?? null }
        : {})
    }))
    if (view === 'inbox') {
      const { inboxThreads, selectedInboxThreadId } = get()
      const thread = inboxThreads.find((item) => item.id === selectedInboxThreadId)
      if (thread && thread.lastActivityAt > thread.readAt) void get().setInboxThreadRead(thread.id, true)
    }
  },

  selectTodoProject: (id) =>
    set((state) =>
      state.todoProjects.some((project) => project.id === id)
        ? { selectedTodoProjectId: id, activeWorkspaceView: 'todo' }
        : {}
    ),

  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleFileTree: () => set((state) => ({ fileTreeCollapsed: !state.fileTreeCollapsed })),
  openFile: (rootId, path) =>
    set((state) => ({ openFiles: { ...state.openFiles, [rootId]: path } })),
  closeFile: (rootId) =>
    set((state) => {
      if (!(rootId in state.openFiles)) return {}
      const openFiles = { ...state.openFiles }
      delete openFiles[rootId]
      return { openFiles }
    }),

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
    await window.api.todoProjects.remove(id)
    set((state) => {
      const removedIndex = state.todoProjects.findIndex((project) => project.id === id)
      const todoProjects = state.todoProjects.filter((project) => project.id !== id)
      const selectedTodoProjectId = state.selectedTodoProjectId === id
        ? todoProjects[Math.min(removedIndex, todoProjects.length - 1)]?.id ?? null
        : state.selectedTodoProjectId
      return {
        todoProjects,
        todoTasks: state.todoTasks.filter((task) => task.todoProjectId !== id),
        selectedTodoProjectId,
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
    set((state) => ({ todoTasks: state.todoTasks.filter((task) => task.id !== id) }))
  },

  addSession: async (input) => {
    const session = await window.api.sessions.create(input)
    set((state) => ({
      sessions: [...state.sessions, session],
      selectedSessionId: session.id,
      activeWorkspaceView: 'sessions'
    }))
    return session
  },

  duplicateSession: async (id) => {
    const session = await window.api.sessions.duplicate(id)
    if (!session) return null
    set((state) => ({
      sessions: [...state.sessions, session],
      selectedSessionId: session.id,
      activeWorkspaceView: 'sessions'
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
      Object.keys(statuses).filter((runtimeId) => belongsToSession(runtimeId, id)).forEach((runtimeId) => delete statuses[runtimeId])
      Object.keys(terminalDirectories).filter((runtimeId) => belongsToSession(runtimeId, id)).forEach((runtimeId) => delete terminalDirectories[runtimeId])
      Object.keys(exits).filter((runtimeId) => belongsToSession(runtimeId, id)).forEach((runtimeId) => delete exits[runtimeId])
      const openFiles = { ...state.openFiles }
      Object.keys(openFiles)
        .filter((key) => belongsToSession(fileRootTerminalId(key) ?? key, id))
        .forEach((key) => delete openFiles[key])
      return {
        openFiles,
        sessions: state.sessions.filter((session) => session.id !== id),
        selectedSessionId: state.selectedSessionId === id ? null : state.selectedSessionId,
        statuses,
        terminalDirectories,
        exits,
      }
    })
  },

  setStatus: (id, status) =>
    set((state) => ({
      statuses: { ...state.statuses, [id]: status },
      openFiles: status === 'none'
        ? Object.fromEntries(Object.entries(state.openFiles).filter(([key]) => fileRootTerminalId(key) !== id))
        : state.openFiles,
    })),

  setTerminalDirectory: (update) =>
    set((state) => {
      const terminalDirectories = { ...state.terminalDirectories }
      if (update.directory === null) delete terminalDirectories[update.terminalId]
      else terminalDirectories[update.terminalId] = update.directory
      return { terminalDirectories }
    }),

  noteExit: (info) =>
    set((state) => ({
      statuses: { ...state.statuses, [info.terminalId]: 'exited' },
      exits: { ...state.exits, [info.terminalId]: info },
    })),

  clearExit: (id) =>
    set((state) => {
      const exits = { ...state.exits }
      delete exits[id]
      return { exits }
    }),

  clearInboxTerminalHighlight: (threadId, token) =>
    set((state) => {
      if (state.inboxTerminalHighlights[threadId]?.token !== token) return state
      const inboxTerminalHighlights = { ...state.inboxTerminalHighlights }
      delete inboxTerminalHighlights[threadId]
      return { inboxTerminalHighlights }
    }),

  openSettings: (section = 'appearance') => set({ settingsDialog: { open: true, section } }),

  closeSettings: () =>
    set((state) => ({ settingsDialog: { ...state.settingsDialog, open: false } })),

  selectInboxThread: (id) => {
    set({ selectedInboxThreadId: id, ...(id ? { activeWorkspaceView: 'inbox' as const } : {}) })
    const thread = id ? get().inboxThreads.find((item) => item.id === id) : undefined
    if (thread && thread.lastActivityAt > thread.readAt) void get().setInboxThreadRead(thread.id, true)
  },

  setInboxThreadRead: async (id, read) => {
    // Marking a thread unread has to survive it being the open one: it stays unread until it is opened again.
    set((state) => {
      const { [id]: _released, ...others } = state.inboxMarkedUnread
      return { inboxMarkedUnread: read ? others : { ...others, [id]: true } }
    })
    const thread = await window.api.inbox.setRead({ id, read })
    if (thread) get().upsertInboxThread(thread)
  },

  markOpenInboxThreadSeen: () => {
    const { activeWorkspaceView, windowMode, selectedInboxThreadId, inboxThreads, inboxMarkedUnread } = get()
    if (windowMode !== 'normal' || activeWorkspaceView !== 'inbox' || !selectedInboxThreadId || inboxMarkedUnread[selectedInboxThreadId]) return
    const thread = inboxThreads.find((item) => item.id === selectedInboxThreadId)
    if (thread && isInboxThreadUnread(thread)) void get().setInboxThreadRead(thread.id, true)
  },

  setInboxThreadArchived: async (id, archived) => {
    const thread = await window.api.inbox.setArchived({ id, archived })
    if (thread) get().upsertInboxThread(thread)
  },

  setInboxThreadPinned: async (id, pinned) => {
    const thread = await window.api.inbox.setPinned({ id, pinned })
    if (thread) get().upsertInboxThread(thread)
  },

  removeInboxThread: async (id, options) => {
    await window.api.inbox.remove({ id, ...(options?.removeWorktree ? { removeWorktree: true } : {}) })
    const terminalId = inboxThreadTerminalId(id)
    disposeSession(terminalId)
    get().setStatus(terminalId, 'none')
    get().clearExit(terminalId)
    get().setTerminalDirectory({ terminalId, directory: null })
    set((state) => {
      const { [id]: _marked, ...inboxMarkedUnread } = state.inboxMarkedUnread
      const { [id]: _cue, ...inboxCues } = state.inboxCues
      const { [id]: _highlight, ...inboxTerminalHighlights } = state.inboxTerminalHighlights
      return {
        inboxThreads: state.inboxThreads.filter((thread) => thread.id !== id),
        selectedInboxThreadId: state.selectedInboxThreadId === id ? null : state.selectedInboxThreadId,
        inboxMarkedUnread,
        inboxCues,
        inboxTerminalHighlights,
      }
    })
  },

  upsertInboxThread: (thread) => {
    const state = get()
    const previous = state.inboxThreads.find((item) => item.id === thread.id)
    const tone = inboxTerminalHighlightTone(previous, thread)
    set({
      inboxThreads: withInboxThread(state.inboxThreads, thread),
      ...(tone ? {
        inboxTerminalHighlights: {
          ...state.inboxTerminalHighlights,
          [thread.id]: { tone, token: (state.inboxTerminalHighlights[thread.id]?.token ?? 0) + 1, at: Date.now() },
        },
      } : {}),
    })
    // New activity on the thread being read is seen immediately, like an open mail. Only new activity
    // counts: a thread that was just marked unread is still the open one, and has to stay unread.
    const activity = !previous || thread.lastActivityAt > previous.lastActivityAt
    if (
      activity &&
      state.windowMode === 'normal' &&
      state.activeWorkspaceView === 'inbox' &&
      state.selectedInboxThreadId === thread.id &&
      isInboxThreadUnread(thread) &&
      typeof document !== 'undefined' &&
      document.hasFocus()
    ) {
      void get().setInboxThreadRead(thread.id, true)
      // Nothing is left marking it unread, so the list and header say, briefly, that something happened.
      if (previous) set((current) => ({ inboxCues: { ...current.inboxCues, [thread.id]: Date.now() } }))
    }
  },

  setWindowMode: async (mode) => {
    set({ windowMode: await window.api.windowMode.set({ mode }) })
  },

  refreshDistros: async () => {
    const distros = await window.api.wsl.distros()
    set({ distros })
  }
}))

// The terminals are mounted as soon as the mode flips, which can be before the window has
// finished growing back. Their sizing waits for the viewport to stop changing.
useWorkspace.subscribe((state, previous) => {
  if (previous.windowMode === 'mini' && state.windowMode === 'normal') viewportSettle.begin()
})
