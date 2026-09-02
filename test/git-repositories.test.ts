import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addGitRepository,
  initGitRepositoryStore,
  loadGitRepositories,
  removeGitRepository,
  validateGitRepositoryList
} from '../src/main/store/git-repositories'

describe('Git repository catalog', () => {
  let storeDir: string

  beforeEach(async () => {
    storeDir = await fs.mkdtemp(join(tmpdir(), 'mde-git-repositories-'))
    initGitRepositoryStore(storeDir)
  })

  afterEach(async () => {
    await fs.rm(storeDir, { recursive: true, force: true })
  })

  it('validates WSL entries and drops malformed or duplicate IDs', () => {
    const repository = {
      id: 'repo-1',
      kind: 'wsl',
      distro: 'Ubuntu-24.04',
      path: '/home/me/src/app',
      createdAt: '2026-01-01T00:00:00.000Z'
    }

    expect(validateGitRepositoryList([
      repository,
      repository,
      { id: 'native', kind: 'native', path: 'C:\\src' },
      { nope: true }
    ])).toEqual([repository])
  })

  it('persists, reloads, and removes manually added repositories', async () => {
    const repository = await addGitRepository({
      kind: 'wsl',
      distro: 'Ubuntu-24.04',
      path: '/home/me/src/app'
    })

    expect((await loadGitRepositories()).map(({ id, ...value }) => value)).toEqual([{
      kind: 'wsl',
      distro: 'Ubuntu-24.04',
      path: '/home/me/src/app',
      createdAt: expect.any(String)
    }])

    initGitRepositoryStore(storeDir)
    expect((await loadGitRepositories()).map(({ id, ...value }) => value)).toEqual([{
      kind: 'wsl',
      distro: 'Ubuntu-24.04',
      path: '/home/me/src/app',
      createdAt: expect.any(String)
    }])

    await removeGitRepository(repository.id)
    expect(await loadGitRepositories()).toEqual([])
  })
})
