import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { GitRepository } from '@shared/types'
import type { GitRepositoryInput } from '@shared/ipc'

const FILE_NAME = 'git-repositories.json'

let storeDir: string | null = null
let cache: GitRepository[] | null = null
let writeQueue: Promise<void> = Promise.resolve()

export function initGitRepositoryStore(dir: string): void {
  storeDir = dir
  cache = null
}

function storeFile(): string {
  if (!storeDir) throw new Error('Git repository store used before initGitRepositoryStore()')
  return join(storeDir, FILE_NAME)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function validateRepository(raw: unknown): GitRepository | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  if (
    !isNonEmptyString(value.id) ||
    value.kind !== 'wsl' ||
    !isNonEmptyString(value.distro) ||
    !isNonEmptyString(value.path)
  ) return null

  return {
    id: value.id,
    kind: 'wsl',
    distro: value.distro.trim(),
    path: value.path.trim(),
    createdAt: isNonEmptyString(value.createdAt)
      ? value.createdAt
      : new Date(0).toISOString()
  }
}

export function validateGitRepositoryList(raw: unknown): GitRepository[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  return raw
    .map(validateRepository)
    .filter((repository): repository is GitRepository => repository !== null)
    .filter((repository) => {
      if (seen.has(repository.id)) return false
      seen.add(repository.id)
      return true
    })
}

async function persist(repositories: GitRepository[]): Promise<void> {
  const target = storeFile()
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  const contents = `${JSON.stringify(repositories, null, 2)}\n`

  await fs.mkdir(storeDir as string, { recursive: true })
  const handle = await fs.open(temporary, 'w')
  try {
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.rename(temporary, target)
}

function enqueueWrite(repositories: GitRepository[]): Promise<void> {
  const run = writeQueue.then(() => persist(repositories))
  writeQueue = run.catch(() => undefined)
  return run
}

export async function loadGitRepositories(): Promise<GitRepository[]> {
  if (cache) return cache

  let text: string
  try {
    text = await fs.readFile(storeFile(), 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      console.warn('[git-repositories] could not read catalog, starting empty:', error)
    }
    cache = []
    return cache
  }

  try {
    cache = validateGitRepositoryList(JSON.parse(text))
  } catch (error) {
    console.warn('[git-repositories] catalog is not valid JSON, starting empty:', error)
    cache = []
  }
  return cache
}

export async function addGitRepository(input: GitRepositoryInput): Promise<GitRepository> {
  const repositories = await loadGitRepositories()
  const path = input.path.trim()
  const distro = input.distro.trim()
  if (!path) throw new Error('Repository path cannot be empty')
  if (!distro) throw new Error('WSL distro cannot be empty')

  const repository: GitRepository = {
    id: randomUUID(),
    kind: 'wsl',
    distro,
    path,
    createdAt: new Date().toISOString()
  }
  cache = [...repositories, repository]
  await enqueueWrite(cache)
  return repository
}

export async function removeGitRepository(id: string): Promise<void> {
  const repositories = await loadGitRepositories()
  cache = repositories.filter((repository) => repository.id !== id)
  await enqueueWrite(cache)
}
