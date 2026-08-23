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
    expect(validateSession(session, projectIds)).toEqual(session)
    expect(validateSession({ ...session, color: 'teal' }, projectIds)).toMatchObject({ color: 'teal' })
    expect(validateSession({ ...session, color: 'not-a-color' }, projectIds)).toEqual(session)
    expect(validateSession({ ...session, icon: 'robot' }, projectIds)).toMatchObject({ icon: 'robot' })
    expect(validateSession({ ...session, icon: 'not-an-icon' }, projectIds)).toEqual(session)
    expect(validateSession({ ...session, obsolete: true }, projectIds)).toEqual(session)
    expect(validateSession({ ...session, projectId: 'missing' }, projectIds)).toBeNull()
    expect(validateSession({ ...session, kind: 'wsl', distro: undefined }, projectIds)).toBeNull()
    expect(validateSessionList([session, session], projectIds)).toHaveLength(1)
  })

  it('loads grouped projects and sessions from the new workspace shape', () => {
    expect(validateWorkspace({ projects: [project], sessions: [session] })).toEqual({
      projects: [project],
      sessions: [session]
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
