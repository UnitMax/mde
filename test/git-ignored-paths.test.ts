import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readGitIgnoredPaths } from '../src/main/inbox/changes'

const exec = promisify(execFile)
const hasGit = process.platform !== 'win32' && await exec('git', ['--version']).then(() => true, () => false)

describe.skipIf(!hasGit)('what Git ignores, for the @ picker', () => {
  let root: string
  const context = (path: string) => ({ id: 'fld_fixture', name: 'Fixture', kind: 'native' as const, path, createdAt: '' })

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mde-git-ignored-'))
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
    vi.stubEnv('GIT_CONFIG_GLOBAL', join(root, 'global-config'))
    await writeFile(join(root, 'global-config'), '')
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  })

  it('names the ignored paths as they were given, folders and other than ASCII names included', async () => {
    const repo = join(root, 'repo')
    await mkdir(join(repo, 'src', 'ünï'), { recursive: true })
    await exec('git', ['init', '-q'], { cwd: repo })
    await writeFile(join(repo, '.gitignore'), 'node_modules/\nünï/\n*.log\n')
    const ignored = await readGitIgnoredPaths(context(repo), ['node_modules/', 'src/', 'src/ünï/', 'src/app.ts', 'src/debug.log'])
    expect([...ignored].sort()).toEqual(['node_modules/', 'src/debug.log', 'src/ünï/'])
    expect(await readGitIgnoredPaths(context(repo), ['src/', 'src/app.ts'])).toEqual(new Set())
  })

  it('ignores nothing outside a repository', async () => {
    const plain = join(root, 'plain')
    await mkdir(plain)
    expect(await readGitIgnoredPaths(context(plain), ['node_modules/'])).toEqual(new Set())
  })
})
