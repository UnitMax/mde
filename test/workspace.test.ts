import { describe, expect, it } from 'vitest'
import {
  validateProject,
  validateProjectList,
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

const defaultTab = {
  id: 'session-1:tab:default',
  name: 'Tab 1',
  layout: {
    layout: 'single',
    panes: [{ id: 'pane-1' }],
    sizes: { columnRatio: 0.5, rowRatio: 0.5 }
  }
}

const normalizedSession = {
  ...session,
  tabs: [defaultTab],
  activeTabId: defaultTab.id
}

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

  it('normalizes tab names, ratios, and malformed tab entries', () => {
    const projectIds = new Set([project.id])
    const custom = validateSession({
      ...session,
      tabs: [
        {
          id: 'tab-custom',
          name: '  Shell  ',
          layout: {
            layout: 'columns',
            panes: [
              { id: 'pane-1' },
              { id: 'pane-2' }
            ],
            sizes: { columnRatio: 2, rowRatio: -1 }
          }
        },
        { id: 'broken', name: '', layout: {} }
      ],
      activeTabId: 'tab-custom'
    }, projectIds)

    expect(custom).toMatchObject({
      tabs: [{
        id: 'tab-custom',
        name: 'Shell',
        layout: { layout: 'columns', sizes: { columnRatio: 0.5, rowRatio: 0.5 } }
      }],
      activeTabId: 'tab-custom'
    })
  })

  it('validates three-column and six-pane layouts with independent column ratios', () => {
    const projectIds = new Set([project.id])
    const panes = [
      { id: 'pane-1' },
      { id: 'pane-2' },
      { id: 'pane-3' },
      { id: 'pane-4' },
      { id: 'pane-5' },
      { id: 'pane-6' }
    ]
    const six = validateSession({
      ...session,
      tabs: [{
        id: 'tab-six',
        name: 'Six',
        layout: {
          layout: 'sixGrid',
          panes,
          sizes: { columnRatio: 0.3, secondColumnRatio: 0.7, rowRatio: 0.4 }
        }
      }]
    }, projectIds)

    expect(six?.tabs?.[0]?.layout).toEqual({
      layout: 'sixGrid',
      panes,
      sizes: { columnRatio: 0.3, secondColumnRatio: 0.7, rowRatio: 0.4 }
    })

    const invalidRatios = validateSession({
      ...session,
      tabs: [{
        id: 'tab-three',
        name: 'Three',
        layout: {
          layout: 'threeColumns',
          panes: panes.slice(0, 3),
          sizes: { columnRatio: 0.8, secondColumnRatio: 0.2, rowRatio: 0.5 }
        }
      }]
    }, projectIds)
    expect(invalidRatios?.tabs?.[0]?.layout.sizes).toEqual({
      columnRatio: 1 / 3,
      secondColumnRatio: 2 / 3,
      rowRatio: 0.5
    })

    const invalidPaneCount = validateSession({
      ...session,
      tabs: [{
        id: 'tab-invalid',
        name: 'Invalid',
        layout: {
          layout: 'sixGrid',
          panes: panes.slice(0, 5),
          sizes: { columnRatio: 1 / 3, secondColumnRatio: 2 / 3, rowRatio: 0.5 }
        }
      }]
    }, projectIds)
    expect(invalidPaneCount?.tabs?.[0]?.name).toBe('Tab 1')
  })

  it('loads grouped projects and sessions from the new workspace shape', () => {
    expect(validateWorkspace({ projects: [project], sessions: [session] })).toEqual({
      projects: [project],
      sessions: [normalizedSession]
    })
  })

  it('starts empty for the old flat project shape', () => {
    expect(validateWorkspace([session])).toEqual({ projects: [], sessions: [] })
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
