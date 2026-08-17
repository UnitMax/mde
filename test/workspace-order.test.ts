import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createProject,
  createSession,
  initWorkspaceStore,
  loadWorkspace,
  reorderSession
} from '../src/main/store/workspace'

describe('workspace session ordering persistence', () => {
  let storeDir: string

  beforeEach(async () => {
    storeDir = await fs.mkdtemp(join(tmpdir(), 'mde-workspace-order-'))
    initWorkspaceStore(storeDir)
  })

  afterEach(async () => {
    await fs.rm(storeDir, { recursive: true, force: true })
  })

  it('persists a reordered project slice without moving another project', async () => {
    const firstProject = await createProject({ name: 'First' })
    const secondProject = await createProject({ name: 'Second' })
    const first = await createSession({
      projectId: firstProject.id,
      name: 'First session',
      mode: 'terminal',
      kind: 'native',
      path: '/workspace/first'
    })
    const other = await createSession({
      projectId: secondProject.id,
      name: 'Other session',
      mode: 'terminal',
      kind: 'native',
      path: '/workspace/other'
    })
    const last = await createSession({
      projectId: firstProject.id,
      name: 'Last session',
      mode: 'terminal',
      kind: 'native',
      path: '/workspace/last'
    })

    const reordered = await reorderSession({ id: last.id, beforeId: first.id })

    expect(reordered?.map((session) => session.id)).toEqual([last.id, other.id, first.id])
    expect((await loadWorkspace()).sessions.map((session) => session.id)).toEqual([
      last.id,
      other.id,
      first.id
    ])
  })
})
