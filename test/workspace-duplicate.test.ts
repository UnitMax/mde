import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createProject,
  createSession,
  duplicateSession,
  initWorkspaceStore,
  loadWorkspace,
  updateSession
} from '../src/main/store/workspace'

describe('workspace session duplication', () => {
  let storeDir: string

  beforeEach(async () => {
    storeDir = await fs.mkdtemp(join(tmpdir(), 'mde-workspace-'))
    initWorkspaceStore(storeDir)
  })

  afterEach(async () => {
    await fs.rm(storeDir, { recursive: true, force: true })
  })

  it('copies terminal launch configuration and appearance', async () => {
    const project = await createProject({ name: 'Work' })
    const source = await createSession({
      projectId: project.id,
      name: 'App',
      kind: 'wsl',
      distro: 'Ubuntu-24.04',
      path: '/home/me/src/app',
      shell: '/bin/zsh'
    })
    await updateSession({
      id: source.id,
      patch: {
        color: 'teal',
        icon: 'robot'
      }
    })

    const duplicate = await duplicateSession(source.id)
    if (!duplicate) throw new Error('Expected a terminal session duplicate')

    expect(duplicate).toMatchObject({
      projectId: project.id,
      name: 'App (copy)',
      color: 'teal',
      icon: 'robot',
      kind: 'wsl',
      distro: 'Ubuntu-24.04',
      path: '/home/me/src/app',
      shell: '/bin/zsh'
    })
    expect(duplicate.id).not.toBe(source.id)
    expect(Date.parse(duplicate.createdAt)).toBeGreaterThanOrEqual(Date.parse(source.createdAt))
    const secondDuplicate = await duplicateSession(source.id)
    expect(secondDuplicate?.name).toBe('App (copy 2)')
    expect((await loadWorkspace()).sessions).toHaveLength(3)
  })

  it('clears a persisted session icon when requested', async () => {
    const project = await createProject({ name: 'Work' })
    const source = await createSession({
      projectId: project.id,
      name: 'App',
      kind: 'native',
      path: '/workspace/app'
    })

    await updateSession({ id: source.id, patch: { icon: 'robot' } })
    await updateSession({ id: source.id, patch: { icon: null } })

    expect((await loadWorkspace()).sessions[0]?.icon).toBeUndefined()
  })

})
