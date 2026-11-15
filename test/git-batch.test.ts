import { execFile } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirectoryContext } from '../src/shared/types'

const exec = promisify(execFile)
const roundTrips = vi.hoisted(() => ({ commands: [] as string[][] }))

// The distro is this machine: what would be handed to `wsl.exe -d <distro> --cd <cwd> -e` is run here,
// so the script meets a real bash and a real Git.
vi.mock('../src/main/wsl/distros', () => ({
  runWslCommand: (_distro: string, command: readonly string[], options: { cwd?: string; maxBuffer?: number } = {}) => {
    roundTrips.commands.push([...command])
    return new Promise((resolve) => {
      execFile(command[0]!, command.slice(1), { cwd: options.cwd, maxBuffer: options.maxBuffer ?? 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({ stdout, stderr, code: error ? (typeof error.code === 'number' ? error.code : 1) : 0 })
      })
    })
  },
}))

import {
  createGitCommandRunner, readGitCheckoutChangesWithRunner, readGitDiffWithRunner, readGitTerminalInfoWithRunner,
  runGitCheckoutBatch,
} from '../src/main/git'
import {
  fillGitBatchCommand, GIT_BATCH_BASE, GIT_BATCH_HEAD, GIT_BATCH_SCRIPT, parseGitBatchOutput, usesGitBatchHead,
} from '../src/main/git-batch'
import { readGitCommitDiffWithRunner, readGitCommitWithRunner, readGitGraphAndCheckouts } from '../src/main/git-graph'
import { canonicalWslDirectory } from '../src/main/wsl/paths'

const directories: string[] = []
afterAll(async () => { await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true }))) })
beforeEach(() => { roundTrips.commands = [] })

async function folder(): Promise<string> {
  const directory = realpathSync.native(await mkdtemp(join(tmpdir(), 'mde-git-batch-')))
  directories.push(directory)
  return directory
}

async function repository() {
  const directory = await folder()
  const git = (...args: string[]) => exec('git', args, { cwd: directory })
  await git('init', '-b', 'main')
  await git('config', 'user.name', 'TestUser')
  await git('config', 'user.email', 'test@example.invalid')
  await git('config', 'commit.gpgsign', 'false')
  const write = (path: string, content: string) => writeFile(join(directory, path), content)
  return { directory, git, write }
}

/** The same folder read two ways: process by process, and as WSL is read, in batches. */
function runners(directory: string) {
  const native: DirectoryContext = { kind: 'native', path: directory } as DirectoryContext
  const wsl: DirectoryContext = { kind: 'wsl', distro: 'Here', path: directory } as DirectoryContext
  return {
    separate: () => createGitCommandRunner(native, 'linux', directory),
    batched: () => createGitCommandRunner(wsl, 'win32', directory),
  }
}

describe('Git batch helpers', () => {
  it('reads the frames of a batch and keeps what each step wrote', () => {
    const b = 'f00d'
    expect(parseGitBatchOutput(b, `true\n/repo\n\n${b} 0\nabc\0def\n${b} 1\n\n${b} 128\n`, `\n${b}\nwarning\n\n${b}\nfatal: no\n${b}\n`)).toEqual([
      { stdout: 'true\n/repo\n', stderr: '', code: 0 },
      { stdout: 'abc\0def', stderr: 'warning\n', code: 1 },
      { stdout: '', stderr: 'fatal: no', code: 128 },
    ])
    expect(parseGitBatchOutput(b, 'cut off before any frame', '')).toEqual([])
  })

  it('fills placeholders only where Git reads revisions', () => {
    const args = ['diff', GIT_BATCH_BASE, GIT_BATCH_HEAD, '--', GIT_BATCH_BASE, GIT_BATCH_HEAD]
    expect(fillGitBatchCommand(args, true, 'EMPTY')).toEqual(['diff', 'HEAD', 'HEAD', '--', GIT_BATCH_BASE, GIT_BATCH_HEAD])
    expect(fillGitBatchCommand(args, false, 'EMPTY')).toEqual(['diff', 'EMPTY', '--', GIT_BATCH_BASE, GIT_BATCH_HEAD])
    expect(usesGitBatchHead(['diff', GIT_BATCH_BASE, '--'])).toBe(true)
    expect(usesGitBatchHead(['diff', '--', GIT_BATCH_BASE])).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('is valid bash', async () => {
    await expect(exec('bash', ['-n', '-c', GIT_BATCH_SCRIPT])).resolves.toBeTruthy()
  })
})

// These run the script with the local bash, which a Windows host does not have outside WSL.
describe.skipIf(process.platform === 'win32')('Git readings in one round trip', { timeout: 30_000 }, () => {
  it('reads a checkout the same way batched as process by process', async () => {
    const repo = await repository()
    await repo.write('kept.txt', 'one\ntwo\n')
    await repo.write('moved.txt', 'a long enough line to be found again\nand another one\nand a third\n')
    await repo.write('gone.txt', 'bye\n')
    await repo.git('add', '.')
    await repo.git('commit', '-m', 'First')
    await repo.write('kept.txt', 'one\nthree\nfour\n')
    await repo.git('mv', 'moved.txt', 'renamed.txt')
    await repo.git('rm', '-q', 'gone.txt')
    const hostile = "new 'single' \"double\"; $(touch sentinel) `touch sentinel` {mde:base}.ts"
    await repo.write(hostile, 'fresh\nlines\n')
    await repo.write(GIT_BATCH_BASE, 'a file named like a placeholder\n')
    await mkdir(join(repo.directory, 'sub'))
    await repo.write('sub/inner.txt', 'inner\n')
    const { separate, batched } = runners(join(repo.directory, 'sub'))

    const changes = await readGitCheckoutChangesWithRunner(batched())
    expect(changes).toEqual(await readGitCheckoutChangesWithRunner(separate()))
    expect(changes.worktree).toBe(repo.directory)
    expect(changes.files?.map((file) => file.path).sort()).toEqual([GIT_BATCH_BASE, 'gone.txt', hostile, 'kept.txt', 'renamed.txt', 'sub/inner.txt'].sort())
    expect(changes.files?.find((file) => file.path === hostile)).toMatchObject({ status: 'untracked', additions: 2 })

    expect(await readGitTerminalInfoWithRunner(batched())).toEqual(await readGitTerminalInfoWithRunner(separate()))
    for (const path of ['kept.txt', 'renamed.txt', hostile, GIT_BATCH_BASE, 'gone.txt']) {
      const diff = await readGitDiffWithRunner(batched(), path)
      expect(diff).toEqual(await readGitDiffWithRunner(separate(), path))
      expect(diff.diff).not.toBe('')
    }
    await expect(readGitDiffWithRunner(batched(), '../outside.txt')).rejects.toThrow('no longer available')
    expect(existsSync(join(repo.directory, 'sentinel'))).toBe(false)
    expect(existsSync(join(repo.directory, 'sub', 'sentinel'))).toBe(false)
  })

  it('takes one round trip for each reading, and two when a second question depends on the first', async () => {
    const repo = await repository()
    await repo.write('a.txt', 'one\n')
    await repo.git('add', '.')
    await repo.git('commit', '-m', 'First')
    await repo.write('a.txt', 'two\n')
    const { batched } = runners(repo.directory)
    const count = async (reading: () => Promise<unknown>): Promise<number> => {
      roundTrips.commands = []
      await reading()
      return roundTrips.commands.length
    }

    expect(await count(() => readGitTerminalInfoWithRunner(batched()))).toBe(1)
    expect(await count(() => readGitCheckoutChangesWithRunner(batched()))).toBe(1)
    expect(await count(() => readGitDiffWithRunner(batched(), 'a.txt'))).toBe(1)
    expect(await count(() => readGitGraphAndCheckouts(batched(), 100, 'all', true))).toBe(1)
    const head = (await repo.git('rev-parse', 'HEAD')).stdout.trim()
    expect(await count(() => readGitCommitWithRunner(batched(), head))).toBe(1)
    expect(await count(() => readGitCommitDiffWithRunner(batched(), head, 'a.txt'))).toBe(1)

    await repo.write('new.txt', 'new\n')
    expect(await count(() => readGitCheckoutChangesWithRunner(batched()))).toBe(2)
    expect(await count(() => readGitDiffWithRunner(batched(), 'new.txt'))).toBe(2)
  })

  it('reads the graph and commits the same way batched as process by process', async () => {
    const repo = await repository()
    await repo.write('a.txt', 'one\n')
    await repo.git('add', '.')
    await repo.git('commit', '-m', 'First')
    await repo.git('checkout', '-q', '-b', 'feature')
    await repo.git('mv', 'a.txt', 'b.txt')
    await repo.write('c.txt', 'c\n')
    await repo.git('add', '.')
    await repo.git('commit', '-m', 'Feature work')
    await repo.git('checkout', '-q', 'main')
    await repo.write('d.txt', 'd\n')
    await repo.git('add', '.')
    await repo.git('commit', '-m', 'Main work')
    await repo.git('merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature')
    await repo.git('tag', 'v1')
    const { separate, batched } = runners(repo.directory)

    for (const scope of ['head', 'local', 'all'] as const) {
      const graph = await readGitGraphAndCheckouts(batched(), 100, scope, true)
      expect(graph).toEqual(await readGitGraphAndCheckouts(separate(), 100, scope, true))
      expect(graph.graph.commits).toHaveLength(4)
      expect(graph.checkouts).toEqual([{ root: repo.directory, head: graph.graph.head, branch: 'main' }])
    }
    const { graph } = await readGitGraphAndCheckouts(batched(), 100, 'all', false)
    for (const commit of graph.commits) {
      const details = await readGitCommitWithRunner(batched(), commit.hash)
      expect(details).toEqual(await readGitCommitWithRunner(separate(), commit.hash))
      expect(details.files.length).toBeGreaterThan(0)
      for (const file of details.files) {
        const diff = await readGitCommitDiffWithRunner(batched(), commit.hash, file.path)
        expect(diff).toEqual(await readGitCommitDiffWithRunner(separate(), commit.hash, file.path))
      }
    }
    const merge = await readGitCommitWithRunner(batched(), graph.commits[0]!.hash)
    expect(merge.files.map((file) => file.path).sort()).toEqual(['b.txt', 'c.txt'])
    await expect(readGitCommitWithRunner(batched(), 'f'.repeat(40))).rejects.toThrow(/not in this repository/)
    await expect(readGitCommitDiffWithRunner(batched(), graph.commits[0]!.hash, 'd.txt')).rejects.toThrow(/not changed in this commit/)
  })

  it('reads a repository with no commit, and a folder that is no repository', async () => {
    const repo = await repository()
    await repo.write('staged.txt', 'new\n')
    await repo.git('add', '.')
    const { separate, batched } = runners(repo.directory)
    const changes = await readGitCheckoutChangesWithRunner(batched())
    expect(changes).toEqual(await readGitCheckoutChangesWithRunner(separate()))
    expect(changes).toMatchObject({ available: true, branch: 'main', additions: 1 })
    expect(await readGitDiffWithRunner(batched(), 'staged.txt')).toEqual(await readGitDiffWithRunner(separate(), 'staged.txt'))
    for (const scope of ['head', 'all'] as const) {
      const graph = await readGitGraphAndCheckouts(batched(), 10, scope, true)
      expect(graph).toEqual(await readGitGraphAndCheckouts(separate(), 10, scope, true))
      expect(graph.graph).toMatchObject({ available: true, head: null, commits: [] })
    }

    const plain = runners(await folder())
    expect(await runGitCheckoutBatch(plain.batched(), [['--no-pager', 'status']])).toBeNull()
    expect((await readGitCheckoutChangesWithRunner(plain.batched())).available).toBe(false)
    expect(await readGitTerminalInfoWithRunner(plain.batched())).toMatchObject({ repository: false, worktree: null })
    expect((await readGitGraphAndCheckouts(plain.batched(), 10, 'all', true)).graph.available).toBe(false)
  })

  it('switches every configured filter driver off, and stops at one it cannot name safely', async () => {
    const repo = await repository()
    const sentinel = join(repo.directory, 'ran')
    await repo.write('.gitattributes', '*.txt filter=mine\n')
    await repo.write('a.txt', 'one\n')
    await repo.git('add', '.')
    await repo.git('commit', '-m', 'First')
    await repo.git('config', 'filter.mine.clean', `sh -c 'touch "${sentinel}"; cat'`)
    await repo.git('config', 'filter.with.dots.process', `sh -c 'touch "${sentinel}"'`)
    await repo.write('a.txt', 'two\n')
    await repo.write('b.txt', 'new\n')
    const { batched } = runners(repo.directory)

    expect(await readGitCheckoutChangesWithRunner(batched())).toMatchObject({ available: true, fileCount: 2 })
    expect((await readGitDiffWithRunner(batched(), 'a.txt')).diff).toContain('+two')
    expect(await readGitTerminalInfoWithRunner(batched())).toMatchObject({ repository: true, changedFiles: 2 })
    expect(existsSync(sentinel)).toBe(false)

    await repo.git('config', 'filter.a=b.clean', 'cat')
    await expect(readGitCheckoutChangesWithRunner(batched())).rejects.toThrow('Could not inspect Git filters safely.')
    expect(existsSync(sentinel)).toBe(false)
  })

  it('spreads commands that do not fit on one command line over several round trips, in order', async () => {
    const repo = await repository()
    await repo.write('a.txt', 'one\n')
    await repo.git('add', '.')
    await repo.git('commit', '-m', 'First')
    const { batched } = runners(repo.directory)
    const padding = 'x'.repeat(900)
    const commands = Array.from({ length: 80 }, (_, index) => ['--no-pager', 'log', '-1', `--format=format:${index} ${padding}`, GIT_BATCH_HEAD, '--'])

    const batch = await runGitCheckoutBatch(batched(), commands)

    expect(roundTrips.commands.length).toBeGreaterThan(1)
    expect(batch?.results.map((result) => result.stdout.split(' ')[0])).toEqual(commands.map((_, index) => String(index)))
    expect(batch?.results.every((result) => result.code === 0)).toBe(true)
  })

  it('resolves a WSL folder and checks it is one in a single round trip', async () => {
    const directory = await folder()
    await mkdir(join(directory, 'real dir'))
    await symlink(join(directory, 'real dir'), join(directory, 'link'))
    await writeFile(join(directory, 'file.txt'), '')

    expect(await canonicalWslDirectory('Here', join(directory, 'link'))).toBe(join(directory, 'real dir'))
    expect(roundTrips.commands).toHaveLength(1)
    expect(roundTrips.commands[0]!.slice(0, 2)).toEqual(['bash', '-c'])
    expect(await canonicalWslDirectory('Here', join(directory, 'file.txt'))).toBeNull()
    expect(await canonicalWslDirectory('Here', join(directory, 'missing'))).toBeNull()

    roundTrips.commands = []
    const asked = await Promise.all([1, 2, 3].map(() => canonicalWslDirectory('Here', directory)))
    expect(asked).toEqual([directory, directory, directory])
    expect(roundTrips.commands).toHaveLength(1)
  })
})
