import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
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

  it('persists the global session order across a reload', async () => {
    const first = await createSession({
      name: 'First session',
      kind: 'native',

    })
    const other = await createSession({
      name: 'Other session',
      kind: 'native',

    })
    const last = await createSession({
      name: 'Last session',
      kind: 'native',

    })

    const reordered = await reorderSession({ id: last.id, beforeId: first.id })

    expect(reordered?.map((session) => session.id)).toEqual([last.id, first.id, other.id])
    initWorkspaceStore(storeDir)
    expect((await loadWorkspace()).sessions.map((session) => session.id)).toEqual([
      last.id,
      first.id,
      other.id
    ])
  })
})
