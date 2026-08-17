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

  it('copies terminal launch configuration and color without OpenCode state', async () => {
    const project = await createProject({ name: 'Work' })
    const source = await createSession({
      projectId: project.id,
      name: 'App',
      mode: 'terminal',
      kind: 'wsl',
      distro: 'Ubuntu-24.04',
      path: '/home/me/src/app',
      shell: '/bin/zsh'
    })
    await updateSession({
      id: source.id,
      patch: {
        color: 'teal',
        opencodeSessionId: 'ses_existing',
        opencodeModelSelections: {
          ses_existing: { providerID: 'cloud', modelID: 'model-a', variant: 'fast' }
        }
      }
    })

    const duplicate = await duplicateSession(source.id)
    if (!duplicate) throw new Error('Expected a terminal session duplicate')

    expect(duplicate).toMatchObject({
      projectId: project.id,
      name: 'App (copy)',
      color: 'teal',
      mode: 'terminal',
      kind: 'wsl',
      distro: 'Ubuntu-24.04',
      path: '/home/me/src/app',
      shell: '/bin/zsh'
    })
    expect(duplicate.id).not.toBe(source.id)
    expect(Date.parse(duplicate.createdAt)).toBeGreaterThanOrEqual(Date.parse(source.createdAt))
    expect(duplicate.opencodeSessionId).toBeUndefined()
    expect(duplicate.opencodeModelSelections).toBeUndefined()

    const secondDuplicate = await duplicateSession(source.id)
    expect(secondDuplicate?.name).toBe('App (copy 2)')
    expect((await loadWorkspace()).sessions).toHaveLength(3)
  })

  it('does not duplicate GUI sessions', async () => {
    const project = await createProject({ name: 'Work' })
    const source = await createSession({
      projectId: project.id,
      name: 'GUI app',
      mode: 'gui',
      kind: 'native',
      path: '/workspace/app'
    })

    expect(await duplicateSession(source.id)).toBeNull()
    expect((await loadWorkspace()).sessions).toHaveLength(1)
  })
})
