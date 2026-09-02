import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createGitCommandRunner,
  readGitDiffWithRunner,
  readGitInfoWithRunner,
  readGitStatusWithRunner
} from '../src/main/git'
import type { Session } from '../src/shared/types'

const run = promisify(execFile)

/**
 * SEC-008: a complete working tree can ship its own `.git/config`, hooks, and
 * `.gitattributes`, and MDE queries Git automatically. Real Git is required to
 * prove those facilities stay inert, so the suite is skipped where it is
 * unavailable. Windows and WSL transports are covered by argument-level tests
 * in `git.test.ts` and by manual runtime checks.
 */
const hasPosixGit = await (async () => {
  if (process.platform === 'win32') return false
  try {
    await run('git', ['--version'])
    return true
  } catch {
    return false
  }
})()

const describeUntrustedRepository = hasPosixGit ? describe : describe.skip

describeUntrustedRepository('Automatic Git queries against an untrusted working tree', () => {
  let root = ''
  let repository = ''
  let sentinels = ''
  let session: Session

  async function firedSentinels(): Promise<string[]> {
    return (await readdir(sentinels)).sort()
  }

  async function writeSentinelScript(path: string, name: string): Promise<void> {
    await writeFile(path, `#!/bin/sh\ntouch '${join(sentinels, name)}'\ncat "$1" 2>/dev/null\nexit 0\n`, {
      mode: 0o755
    })
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'mde-sec-008.'))
    repository = join(root, 'untrusted')
    sentinels = join(root, 'sentinels')
    const hooks = join(root, 'hostile-hooks')
    await mkdir(sentinels)
    await mkdir(hooks)
    await mkdir(repository)

    await run('git', ['init', '--quiet', '--initial-branch=main'], { cwd: repository })
    await writeFile(join(repository, 'tracked.txt'), 'one\n')
    await run('git', ['add', 'tracked.txt'], { cwd: repository })
    await run(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'Add tracked file'],
      { cwd: repository }
    )

    // Every program the repository can name during an ordinary status or diff.
    await writeSentinelScript(join(repository, 'fsmonitor.sh'), 'fsmonitor')
    await writeSentinelScript(join(hooks, 'post-index-change'), 'post-index-change')
    await writeSentinelScript(join(repository, 'textconv.sh'), 'textconv')
    await writeSentinelScript(join(repository, 'clean.sh'), 'clean-filter')
    await writeFile(
      join(repository, '.git', 'config'),
      [
        '[core]',
        `\tfsmonitor = ${join(repository, 'fsmonitor.sh')}`,
        `\thooksPath = ${hooks}`,
        '[diff "hostile"]',
        `\ttextconv = ${join(repository, 'textconv.sh')}`,
        '[filter "hostile"]',
        `\tclean = ${join(repository, 'clean.sh')}`,
        ''
      ].join('\n'),
      { flag: 'a' }
    )
    await writeFile(join(repository, '.gitattributes'), '*.txt diff=hostile filter=hostile\n')

    await writeFile(join(repository, 'tracked.txt'), 'one\ntwo\n')
    await writeFile(join(repository, 'untracked.txt'), 'new\n')

    session = {
      id: 'untrusted-1',
      projectId: 'project-1',
      name: 'Untrusted tree',
      kind: 'native',
      path: repository,
      createdAt: '2026-09-02T00:00:00.000Z'
    }
  })

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await rm(sentinels, { recursive: true, force: true })
    await mkdir(sentinels)
  })

  it('is a fixture that really does execute programs under unhardened Git', async () => {
    await run('git', ['status', '--porcelain=v2', '-z'], { cwd: repository })
    await run('git', ['diff', '--numstat', '-z', 'HEAD', '--'], { cwd: repository })
    await run('git', ['diff', 'HEAD', '--'], { cwd: repository })

    expect(await firedSentinels()).toEqual(['clean-filter', 'fsmonitor', 'post-index-change', 'textconv'])
  })

  it('executes nothing the repository configured while reading status', async () => {
    await expect(readGitStatusWithRunner(createGitCommandRunner(session, 'linux'))).resolves.toEqual({
      repository: true,
      branch: 'main',
      additions: 1,
      deletions: 0,
      commitsAhead: null
    })

    expect(await firedSentinels()).toEqual([])
  })

  it('executes nothing the repository configured while reading history and changes', async () => {
    const info = await readGitInfoWithRunner(createGitCommandRunner(session, 'linux'))

    expect(info.branch).toBe('main')
    expect(info.commits).toHaveLength(1)
    expect(info.changes).toContainEqual(
      expect.objectContaining({ path: 'tracked.txt', status: 'modified', unstaged: true })
    )
    expect(info.changes).toContainEqual(expect.objectContaining({ path: 'untracked.txt', status: 'untracked' }))
    expect(await firedSentinels()).toEqual([])
  })

  it('executes nothing the repository configured while reading a diff', async () => {
    const tracked = await readGitDiffWithRunner(createGitCommandRunner(session, 'linux'), 'tracked.txt')
    const untracked = await readGitDiffWithRunner(createGitCommandRunner(session, 'linux'), 'untracked.txt')

    expect(tracked.diff).toContain('+two')
    expect(untracked.diff).toContain('+new')
    expect(await firedSentinels()).toEqual([])
  })
})
