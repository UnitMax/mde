import { testLayout } from './helpers/terminal-layout'
import { describe, expect, it } from 'vitest'
import {
  validateProject,
  validateProjectList,
  validateTodoProject,
  validateTodoProjectList,
  validateTodoTask,
  validateTodoTaskList,
  reorderSessionList,
  validateSession,
  validateSessionList,
  validateWorkspace
} from '../src/main/store/workspace'
import type { Session } from '../src/shared/types'

const project = {
  id: 'project-1',
  name: 'Work',
  createdAt: '2026-01-01T00:00:00.000Z'
}

const session = {
  id: 'session-1',
  projectId: 'project-1',
  name: 'App',
  kind: 'wsl',
  distro: 'Ubuntu-24.04',
  path: '/home/me/src/app',
  createdAt: '2026-01-01T00:00:00.000Z'
}

const todoProject = {
  id: 'todo-project-1',
  name: 'Release plan',
  shorthand: 'ENG',
  nextTaskNumber: 1,
  columns: [
    { id: 'todo', name: 'To Do' },
    { id: 'in-progress', name: 'In Progress' },
    { id: 'done', name: 'Done' },
    { id: 'review', name: 'Review' }
  ],
  createdAt: '2026-01-02T00:00:00.000Z'
}

const defaultTab = {
  id: 'session-1:tab:default',
  name: 'Tab 1',
  layout: {
    tree: { type: 'pane', paneId: 'pane-1' },
    panes: [{ id: 'pane-1' }]
  }
}

const normalizedSession = {
  ...session,
  tabs: [defaultTab],
  activeTabId: defaultTab.id
}

describe('saved layout fallback', () => {
  it('resets an older layout while keeping tab identity, name and selection', () => {
    const tab = { id: 'existing-tab', name: 'Shell', layout: { layout: 'columns', panes: [{ id: 'a' }, { id: 'b' }] } }
    const restored = validateSession({ ...session, tabs: [tab, defaultTab], activeTabId: tab.id }, new Set([project.id]))
    expect(restored?.tabs?.[0]).toEqual({ ...tab, layout: defaultTab.layout })
    expect(restored?.tabs).toHaveLength(2)
    expect(restored?.activeTabId).toBe(tab.id)
  })
})

describe('workspace validation', () => {
  it('keeps project labels free of session location data', () => {
    expect(validateProject(project)).toEqual(project)
    expect(validateProject({ ...project, path: '/tmp/should-not-be-here' })).toEqual(project)
  })

  it('rejects malformed projects and deduplicates project ids', () => {
    expect(validateProject(null)).toBeNull()
    expect(validateProject({ ...project, name: '' })).toBeNull()
    expect(validateProjectList([project, project, { nope: true }])).toHaveLength(1)
  })

  it('validates independent To Do projects', () => {
    expect(validateTodoProject({ ...todoProject, name: '  Release plan  ' })).toEqual(todoProject)
    expect(validateTodoProject({ ...todoProject, name: '' })).toBeNull()
    expect(validateTodoProjectList([todoProject, todoProject, { nope: true }])).toEqual([
      todoProject
    ])
  })

  it('accepts only complete current To Do projects', () => {
    expect(validateTodoProject({
      id: 'legacy',
      name: 'Legacy',
      createdAt: '2026-01-01T00:00:00.000Z'
    })).toBeNull()
    expect(validateTodoProject({ ...todoProject, shorthand: 'eng' })).toBeNull()
    expect(validateTodoProject({ ...todoProject, columns: undefined })).toBeNull()
    expect(validateTodoProject({ ...todoProject, nextTaskNumber: undefined })).toBeNull()

    expect(validateTodoProjectList([
      todoProject,
      { ...todoProject, id: 'duplicate-key' },
      { id: 'legacy', name: 'Legacy' }
    ])).toEqual([todoProject])
  })

  it('validates tasks against arbitrary current columns', () => {

    const projects = new Map([[todoProject.id, todoProject]])
    const task = {
      id: 'task-1',
      todoProjectId: todoProject.id,
      columnId: 'review',
      number: 4,
      title: 'Review release',
      description: 'Check all changes',
      createdAt: '2026-01-03T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z'
    }
    expect(validateTodoTask(task, projects)).toEqual(task)
    expect(validateTodoTask({ ...task, columnId: 'missing' }, projects)).toBeNull()
    expect(validateTodoTaskList([task, task], projects)).toEqual([task])
    expect(validateTodoTask({ ...task, createdAt: undefined }, projects)).toBeNull()
    expect(validateTodoTask({ ...task, updatedAt: undefined }, projects)).toBeNull()
  })

  it('requires sessions to reference a project and retain their own path', () => {
    const projectIds = new Set([project.id])
    expect(validateSession(session, projectIds)).toEqual(normalizedSession)
    expect(validateSession({ ...session, color: 'teal' }, projectIds)).toMatchObject({ color: 'teal' })
    expect(validateSession({ ...session, color: 'not-a-color' }, projectIds)).toEqual(normalizedSession)
    expect(validateSession({ ...session, icon: 'robot' }, projectIds)).toMatchObject({ icon: 'robot' })
    expect(validateSession({ ...session, icon: 'not-an-icon' }, projectIds)).toEqual(normalizedSession)
    expect(validateSession({ ...session, obsolete: true }, projectIds)).toEqual(normalizedSession)
    expect(validateSession({ ...session, projectId: 'missing' }, projectIds)).toBeNull()
    expect(validateSession({ ...session, kind: 'wsl', distro: undefined }, projectIds)).toBeNull()
    expect(validateSessionList([session, session], projectIds)).toHaveLength(1)
  })

  it('normalizes tab names and ignores malformed tab entries', () => {
    const layout = testLayout([{ id: 'a' }, { id: 'b' }], 0.3)
    const custom = validateSession({ ...session, tabs: [
      { id: 'tab-custom', name: '  Shell  ', layout },
      { id: 'broken', name: '', layout: {} },
    ], activeTabId: 'tab-custom' }, new Set([project.id]))
    expect(custom).toMatchObject({ tabs: [{ id: 'tab-custom', name: 'Shell', layout }], activeTabId: 'tab-custom' })
  })

  it('preserves arbitrary nested splits and resets a malformed tree', () => {
    const layout = testLayout(Array.from({ length: 12 }, (_, index) => ({ id: `pane-${index}` })), 0.3)
    const raw = { ...session, tabs: [{ id: 'tab', name: 'Shell', layout }] }
    expect(validateSession(raw, new Set([project.id]))?.tabs?.[0]?.layout).toEqual(layout)
    const broken = { ...raw, tabs: [{ ...raw.tabs[0], layout: { ...layout, panes: layout.panes.slice(1) } }] }
    expect(validateSession(broken, new Set([project.id]))?.tabs?.[0]?.layout).toEqual(defaultTab.layout)
  })

  it('loads grouped projects and sessions from the new workspace shape', () => {
    expect(validateWorkspace({
      projects: [project],
      todoProjects: [todoProject],
      sessions: [session]
    })).toEqual({
      projects: [project],
      todoProjects: [todoProject],
      todoTasks: [],
      sessions: [normalizedSession]
    })
  })

  it('starts empty for the old flat project shape', () => {
    expect(validateWorkspace([session])).toEqual({
      projects: [],
      todoProjects: [],
      todoTasks: [],
      sessions: []
    })
  })
})

describe('session ordering', () => {
  const first: Session = {
    id: 'session-1',
    projectId: 'project-1',
    name: 'First',
    kind: 'wsl',
    distro: 'Ubuntu-24.04',
    path: '/home/me/src/first',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
  const otherProject: Session = { ...first, id: 'session-2', projectId: 'project-2' }
  const last: Session = { ...first, id: 'session-3', name: 'Last' }

  it('reorders only the selected project entries and supports appending', () => {
    const sessions = [first, otherProject, last]

    expect(reorderSessionList(sessions, { id: last.id, beforeId: first.id })).toEqual([
      last,
      otherProject,
      first
    ])
    expect(reorderSessionList(sessions, { id: first.id, beforeId: null })).toEqual([
      last,
      otherProject,
      first
    ])
  })

  it('rejects invalid targets and leaves no-op orders unchanged', () => {
    const sessions = [first, otherProject, last]

    expect(reorderSessionList(sessions, { id: first.id, beforeId: first.id })).toBeNull()
    expect(reorderSessionList(sessions, { id: first.id, beforeId: otherProject.id })).toBeNull()
    expect(reorderSessionList(sessions, { id: first.id, beforeId: 'missing' })).toBeNull()
    expect(reorderSessionList(sessions, { id: last.id, beforeId: null })).toEqual(sessions)
  })
})
