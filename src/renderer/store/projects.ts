import { create } from 'zustand'
import type { PlatformInfo } from '@shared/ipc'
import type { Distro, NewProject, Project, PtyExitInfo, PtyStatus } from '@shared/types'
import { disposeSession } from '@/terminal/sessions'

interface ProjectsState {
  projects: Project[]
  selectedId: string | null
  statuses: Record<string, PtyStatus>
  exits: Record<string, PtyExitInfo>
  platform: PlatformInfo | null
  wslAvailable: boolean
  distros: Distro[]
  sidebarCollapsed: boolean
  ready: boolean

  init: () => Promise<void>
  select: (id: string | null) => void
  toggleSidebar: () => void

  addProject: (input: NewProject) => Promise<Project>
  renameProject: (id: string, name: string) => Promise<void>
  removeProject: (id: string) => Promise<void>
  revealProject: (id: string) => Promise<void>

  setStatus: (id: string, status: PtyStatus) => void
  noteExit: (info: PtyExitInfo) => void
  clearExit: (id: string) => void
  refreshDistros: () => Promise<void>
}

export const useProjects = create<ProjectsState>((set, get) => ({
  projects: [],
  selectedId: null,
  statuses: {},
  exits: {},
  platform: null,
  wslAvailable: false,
  distros: [],
  sidebarCollapsed: false,
  ready: false,

  init: async () => {
    const [platform, projects, statuses, wslAvailable] = await Promise.all([
      window.api.platform.info(),
      window.api.projects.list(),
      window.api.pty.statuses(),
      window.api.wsl.available()
    ])

    set({
      platform,
      projects,
      statuses,
      wslAvailable,
      // Nothing is auto-opened: a PTY is created on first view, not on launch.
      selectedId: null,
      ready: true
    })

    if (wslAvailable) void get().refreshDistros()

    window.api.pty.onExit((info) => get().noteExit(info))
  },

  select: (id) => set({ selectedId: id }),

  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  addProject: async (input) => {
    const project = await window.api.projects.create(input)
    set((state) => ({ projects: [...state.projects, project], selectedId: project.id }))
    return project
  },

  renameProject: async (id, name) => {
    const updated = await window.api.projects.update({ id, patch: { name } })
    if (!updated) return
    set((state) => ({ projects: state.projects.map((p) => (p.id === id ? updated : p)) }))
  },

  removeProject: async (id) => {
    // Main kills the PTY; the renderer drops the xterm instance that fed it.
    await window.api.projects.remove(id)
    disposeSession(id)
    set((state) => {
      const statuses = { ...state.statuses }
      const exits = { ...state.exits }
      delete statuses[id]
      delete exits[id]
      return {
        projects: state.projects.filter((p) => p.id !== id),
        selectedId: state.selectedId === id ? null : state.selectedId,
        statuses,
        exits
      }
    })
  },

  revealProject: async (id) => {
    await window.api.paths.reveal(id)
  },

  setStatus: (id, status) =>
    set((state) => ({ statuses: { ...state.statuses, [id]: status } })),

  noteExit: (info) =>
    set((state) => ({
      statuses: { ...state.statuses, [info.projectId]: 'exited' },
      exits: { ...state.exits, [info.projectId]: info }
    })),

  clearExit: (id) =>
    set((state) => {
      const exits = { ...state.exits }
      delete exits[id]
      return { exits }
    }),

  refreshDistros: async () => {
    const distros = await window.api.wsl.distros()
    set({ distros })
  }
}))
