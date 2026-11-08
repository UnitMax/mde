import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGitCommandRunner, createGitMutationRunner, readGitStatusWithRunner } from '../src/main/git'
import { InboxWorktrees } from '../src/main/inbox/worktree'

const exec = promisify(execFile)
const hasGit = process.platform !== 'win32' && await exec('git', ['--version']).then(() => true, () => false)

describe.skipIf(!hasGit)('MDE-owned Git stays local and does not execute filters', () => {
  let root: string
  let repo: string
  let home: string
  let sentinel: string
  let servers: Server[]
  const git = async (...args: string[]): Promise<string> => (await exec('git', args, { cwd: repo })).stdout.trim()
  const context = () => ({ id: 'fixture', name: 'Fixture', kind: 'native' as const, path: repo, createdAt: '2026-11-08T00:00:00.000Z' })
  const service = () => new InboxWorktrees({ home: async () => home, randomId: () => 'abcdef12' })
  const folder = () => ({ id: 'fld_fixture', name: 'Fixture', directory: repo, target: { kind: 'native' as const }, createdAt: 1, lastUsedAt: 1 })
  const fired = () => access(sentinel).then(() => true, () => false)

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mde-git-local-'))
    repo = join(root, 'repo')
    home = join(root, 'home')
    sentinel = join(root, 'sentinel')
    servers = []
    await mkdir(repo)
    await mkdir(home)
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
    vi.stubEnv('GIT_CONFIG_GLOBAL', join(root, 'global-config'))
    await writeFile(join(root, 'global-config'), '')
    await git('init', '-q', '--initial-branch=main')
    await writeFile(join(repo, 'tracked.txt'), 'original\n')
    await writeFile(join(repo, '.gitattributes'), '*.txt text eol=crlf filter=fixture\n')
    await git('add', '.')
    await git('-c', 'user.name=TestUser', '-c', 'user.email=test@example.com', 'commit', '-qm', 'Fixture')
    await git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  })

  afterEach(async () => {
    for (const server of servers) {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  })

  async function configureFilter(command: 'clean' | 'smudge' | 'process', scope: 'local' | 'global' | 'include' | 'worktree'): Promise<void> {
    const program = join(root, 'filter.sh')
    await writeFile(program, `#!/bin/sh\nprintf fixture > '${sentinel}'\ncat\n`, { mode: 0o755 })
    const value = `'${program}'`
    if (scope === 'include') {
      const included = join(root, 'included-config')
      await git('config', '--file', included, `filter.fixture.${command}`, value)
      await git('config', 'include.path', included)
    } else {
      if (scope === 'worktree') await git('config', 'extensions.worktreeConfig', 'true')
      await git('config', `--${scope}`, `filter.fixture.${command}`, value)
      await git('config', `--${scope}`, 'filter.fixture.required', 'true')
    }
    await writeFile(join(repo, '.git', 'info', 'attributes'), '*.txt filter=fixture\n')
  }

  it.each(['local', 'global', 'include', 'worktree'] as const)('suppresses clean filters from %s config and info/attributes during status', async (scope) => {
    await configureFilter('clean', scope)
    await writeFile(join(repo, 'tracked.txt'), 'changed\n')
    expect(await readGitStatusWithRunner(createGitCommandRunner(context(), 'linux'))).toMatchObject({ repository: true, branch: 'main' })
    expect(await fired()).toBe(false)
  })

  it('suppresses long-running process filters and rechecks configuration on each operation', async () => {
    const run = createGitCommandRunner(context(), 'linux')
    await run(['status', '--porcelain=v2'])
    await configureFilter('process', 'local')
    await writeFile(join(repo, 'tracked.txt'), 'changed\n')
    expect((await run(['status', '--porcelain=v2'])).code).toBe(0)
    expect(await fired()).toBe(false)
  })

  it('ignores GIT_CONFIG when discovering the effective repository filters', async () => {
    await configureFilter('clean', 'local')
    const decoy = join(root, 'decoy-config')
    await writeFile(decoy, '')
    vi.stubEnv('GIT_CONFIG', decoy)
    await writeFile(join(repo, 'tracked.txt'), 'changed\n')
    expect((await createGitCommandRunner(context(), 'linux')(['status', '--porcelain=v2'])).code).toBe(0)
    expect(await fired()).toBe(false)
  })

  it.each(['smudge', 'process'] as const)('refuses a worktree needing a %s filter and cleans up its generated branch', async (command) => {
    await configureFilter(command, 'local')
    await expect(service().create(folder(), 'main')).rejects.toThrow('This checkout needs Git filters.')
    expect(await fired()).toBe(false)
    expect(await git('branch', '--list', 'mde/abcdef12')).toBe('')
    expect(await git('worktree', 'list')).not.toContain('abcdef12')
  })

  it('checks filters enabled only on the newly created branch', async () => {
    await configureFilter('smudge', 'include')
    await git('config', '--unset', 'include.path')
    await git('config', 'includeIf.onbranch:mde/**.path', join(root, 'included-config'))
    await expect(service().create(folder(), 'main')).rejects.toThrow('This checkout needs Git filters.')
    expect(await fired()).toBe(false)
    expect(await git('branch', '--list', 'mde/abcdef12')).toBe('')
    expect(await git('worktree', 'list')).not.toContain('abcdef12')
  })

  it('checks the target worktree’s conditional filters before checking removal cleanliness', async () => {
    const created = await service().create(folder(), 'main')
    await configureFilter('clean', 'include')
    await git('config', '--unset', 'include.path')
    await git('config', 'includeIf.onbranch:mde/**.path', join(root, 'included-config'))
    await writeFile(join(created.directory, 'tracked.txt'), 'changed\n')
    await expect(service().remove({
      id: 'ses_fixture', title: 'Fixture', target: { kind: 'native' }, directory: created.directory,
      branch: null, status: 'idle', createdAt: 1, lastActivityAt: 1, readAt: 1, archived: false,
      worktree: created.worktree, folderId: 'fld_fixture',
    }, [])).rejects.toThrow('Could not remove the worktree:')
    expect(await fired()).toBe(false)
    expect(await access(created.directory).then(() => true, () => false)).toBe(true)
  })

  it('still creates ordinary worktrees and honors built-in line-ending attributes', async () => {
    const created = await service().create(folder(), 'origin/main')
    expect(await readFile(join(created.directory, 'tracked.txt'), 'utf8')).toBe('original\r\n')
    expect(await git('rev-parse', 'refs/heads/mde/abcdef12')).toBe(await git('rev-parse', 'refs/remotes/origin/main'))
  })

  it('does not block an unrelated checkout merely because LFS is globally installed', async () => {
    await git('config', '--global', 'filter.lfs.process', 'must-not-run')
    await git('config', '--global', 'filter.lfs.required', 'true')
    const created = await service().create(folder(), 'main')
    expect(await readFile(join(created.directory, 'tracked.txt'), 'utf8')).toBe('original\r\n')
  })

  async function missingBlob(remote: string): Promise<void> {
    const oid = await git('rev-parse', 'HEAD:tracked.txt')
    await git('config', 'remote.origin.url', remote)
    await git('config', 'remote.origin.promisor', 'true')
    await git('config', 'extensions.partialClone', 'origin')
    await rm(join(repo, '.git', 'objects', oid.slice(0, 2), oid.slice(2)))
    await writeFile(join(repo, 'tracked.txt'), 'changed\n')
  }

  it('keeps the branch picker working with missing blobs and blocks HTTP fetching during reads and checkout', async () => {
    const requests: string[] = []
    const server = createServer((request, response) => { requests.push(request.url ?? ''); response.writeHead(404).end() })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No fixture address')
    await missingBlob(`http://127.0.0.1:${address.port}/fixture`)
    // Repository and inherited settings cannot weaken MDE's transport allowlist.
    await git('config', 'protocol.http.allow', 'always')
    vi.stubEnv('GIT_ALLOW_PROTOCOL', 'http:https:file')
    vi.stubEnv('GIT_NO_LAZY_FETCH', '0')

    expect(await service().info(folder())).toMatchObject({
      repository: true, branch: 'main', branches: [{ name: 'main', remote: false }, { name: 'origin/main', remote: true }],
    })
    await expect(readGitStatusWithRunner(createGitCommandRunner(context(), 'linux'))).rejects.toThrow()
    await expect(service().create(folder(), 'main')).rejects.toThrow()
    expect(requests).toEqual([])
    expect(await git('branch', '--list', 'mde/abcdef12')).toBe('')
  })

  it('blocks a configured remote helper before the helper program starts', async () => {
    const helper = join(root, 'git-remote-fixture')
    await writeFile(helper, `#!/bin/sh\nprintf fixture > '${sentinel}'\nexit 1\n`, { mode: 0o755 })
    vi.stubEnv('PATH', `${root}:${process.env.PATH}`)
    await missingBlob('fixture::untrusted')
    await git('config', 'protocol.fixture.allow', 'always')
    expect((await createGitCommandRunner(context(), 'linux')(['diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--'])).code).not.toBe(0)
    expect(await fired()).toBe(false)
  })

  it('applies the transport denial to the mutation runner independently of read commands', async () => {
    const result = await createGitMutationRunner(context(), repo, undefined, 'linux')(['fetch', 'https://127.0.0.1:1/fixture'])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain("transport 'https' not allowed")
  })
})
