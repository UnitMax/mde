import { describe, expect, it } from 'vitest'
import {
  validateProject,
  validateProjectList,
  validateSession,
  validateSessionList,
  validateWorkspace
} from '../src/main/store/workspace'

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
    expect(validateSession({ ...session, projectId: 'missing' }, projectIds)).toBeNull()
    expect(validateSession({ ...session, kind: 'wsl', distro: undefined }, projectIds)).toBeNull()
    expect(validateSessionList([session, session], projectIds)).toHaveLength(1)
  })

  it('keeps a persisted OpenCode conversation selection', () => {
    const projectIds = new Set([project.id])
    expect(validateSession({ ...session, opencodeSessionId: 'ses_existing' }, projectIds)).toMatchObject({
      id: session.id,
      opencodeSessionId: 'ses_existing'
    })
    expect(validateSession({ ...session, opencodeSessionId: '' }, projectIds)).toEqual(session)
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
