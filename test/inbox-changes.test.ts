import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, unlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  INBOX_DIFF_PREVIEW_BYTES,
  INBOX_UNTRACKED_COUNT_LIMIT,
  parseGitFileNumstat,
  readGitCheckoutChangesWithRunner,
  readGitCheckoutDiffWithRunner,
  type GitCommandRunner
} from '../src/main/git'

const exec = promisify(execFile)
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

async function repository(initialize = true) {
  const directory = await mkdtemp(join(tmpdir(), 'mde-inbox-git-'))
  directories.push(directory)
  const git = (...args: string[]) => exec('git', args, { cwd: directory })
  if (initialize) {
    await git('init', '-b', 'main')
    await git('config', 'user.name', 'TestUser')
    await git('config', 'user.email', 'test@example.invalid')
  }
  const runner = (cwd = directory): GitCommandRunner => async (args) => {
    try {
      const result = await exec('git', args, { cwd })
      return { ...result, code: 0 }
    } catch (error) {
      const result = error as { code: number; stdout: string; stderr: string }
      return { stdout: result.stdout, stderr: result.stderr, code: result.code }
    }
  }
  return { directory, git, runner, write: (path: string, content: string | Buffer) => writeFile(join(directory, path), content) }
}

describe('Inbox checkout changes', () => {
  it('parses literal paths, binary counts, and NUL-delimited renames', () => {
    expect([...parseGitFileNumstat('2\t1\tfile\nname\0-\t-\timage.bin\0' + '1\t0\t\0old\0new name\0')]).toEqual([
      ['file\nname', { additions: 2, deletions: 1, binary: false }],
      ['image.bin', { additions: 0, deletions: 0, binary: true }],
      ['new name', { additions: 1, deletions: 0, binary: false }],
    ])
  })

  it('shows staged plus unstaged changes, deletions, renames, binary and untracked files against HEAD', async () => {
    const repo = await repository()
    await repo.write('tracked.txt', 'base\n')
    await repo.write('gone.txt', 'gone\n')
    await repo.write('old name.txt', 'rename me\n')
    await repo.write('image.bin', Buffer.from([0, 1, 2]))
    await repo.git('add', '.')
    await repo.git('commit', '-m', 'Seed')
    await repo.write('tracked.txt', 'staged\n')
    await repo.git('add', 'tracked.txt')
    await repo.write('tracked.txt', 'staged\nextra\n')
    await unlink(join(repo.directory, 'gone.txt'))
    await repo.git('mv', 'old name.txt', 'new [name].txt')
    await repo.write('image.bin', Buffer.from([0, 3, 4]))
    await repo.write(':(glob)*.txt', 'new\n')
    const result = await readGitCheckoutChangesWithRunner(repo.runner())
    expect(result).toMatchObject({ available: true, branch: 'main', worktree: repo.directory, additions: 3, deletions: 2, fileCount: 5 })
    expect(result.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'tracked.txt', additions: 2, deletions: 1 }),
      expect.objectContaining({ path: 'gone.txt', status: 'deleted', additions: 0, deletions: 1 }),
      expect.objectContaining({ path: 'new [name].txt', status: 'renamed', additions: 0, deletions: 0 }),
      expect.objectContaining({ path: 'image.bin', binary: true, additions: 0, deletions: 0 }),
      expect.objectContaining({ path: ':(glob)*.txt', status: 'untracked', additions: 1, deletions: 0 }),
    ]))
    const patch = await readGitCheckoutDiffWithRunner(repo.runner(), 'tracked.txt')
    expect(patch.diff).toContain('-base')
    expect(patch.diff).toContain('+staged')
    expect(patch.diff).toContain('+extra')
    expect((await readGitCheckoutDiffWithRunner(repo.runner(), ':(glob)*.txt')).diff).toContain('+new')
    expect((await readGitCheckoutDiffWithRunner(repo.runner(), 'image.bin')).binary).toBe(true)
    await expect(readGitCheckoutDiffWithRunner(repo.runner(), '../outside')).rejects.toThrow('no longer available')
  })

  it('queries the whole checkout when a thread starts in a subfolder, and follows branch switches and commits', async () => {
    const repo = await repository()
    await repo.write('a.txt', 'seed\n')
    await repo.git('add', '.')
    await repo.git('commit', '-m', 'Seed')
    await mkdir(join(repo.directory, 'sub'))
    const run = repo.runner(join(repo.directory, 'sub'))
    await repo.git('checkout', '-b', 'feature')
    await repo.write('a.txt', 'changed\n')
    expect(await readGitCheckoutChangesWithRunner(run)).toMatchObject({ branch: 'feature', additions: 1, deletions: 1 })
    await repo.git('add', '.')
    await repo.git('commit', '-m', 'Change')
    expect(await readGitCheckoutChangesWithRunner(run)).toMatchObject({ branch: 'feature', additions: 0, deletions: 0, fileCount: 0 })
    await repo.git('checkout', 'main')
    expect(await readGitCheckoutChangesWithRunner(run)).toMatchObject({ branch: 'main', fileCount: 0 })
    await repo.git('checkout', '--detach')
    expect((await readGitCheckoutChangesWithRunner(run)).branch).toBeNull()
  })

  it('supports an unborn branch and reports folders without Git', async () => {
    const repo = await repository()
    await repo.write('staged.txt', 'one\n')
    await repo.git('add', '.')
    await repo.write('untracked.txt', 'two\n')
    expect(await readGitCheckoutChangesWithRunner(repo.runner())).toMatchObject({ available: true, additions: 2, deletions: 0, fileCount: 2 })
    const plain = await repository(false)
    expect(await readGitCheckoutChangesWithRunner(plain.runner())).toMatchObject({ available: false, fileCount: 0 })
  })

  it('caps patch previews without losing the Git file identity', async () => {
    const repo = await repository()
    await repo.write('large.txt', 'long line\n'.repeat(20_000))
    const patch = await readGitCheckoutDiffWithRunner(repo.runner(), 'large.txt')
    expect(patch.truncated).toBe(true)
    expect(Buffer.byteLength(patch.diff)).toBeLessThanOrEqual(64 * 1024)
    expect(patch.path).toBe('large.txt')
  })

  it('counts only the first untracked files, so a folder of them cannot queue a process each on every poll', async () => {
    const repo = await repository()
    await repo.write('tracked.txt', 'base\n')
    await repo.git('add', '.')
    await repo.git('commit', '-m', 'Seed')
    await repo.write('tracked.txt', 'base\nmore\n')
    await mkdir(join(repo.directory, 'build'))
    const total = INBOX_UNTRACKED_COUNT_LIMIT + 5
    await Promise.all(Array.from({ length: total }, (_, n) => repo.write(`build/out-${String(n).padStart(3, '0')}.txt`, 'one\ntwo\n')))
    const calls: string[][] = []
    const run = repo.runner()
    const result = await readGitCheckoutChangesWithRunner(async (args) => { calls.push(args); return run(args) })
    expect(result).toMatchObject({ available: true, fileCount: total + 1, uncounted: 5, additions: 1 + INBOX_UNTRACKED_COUNT_LIMIT * 2 })
    expect(result.files).toHaveLength(total + 1)
    expect(result.files?.filter((file) => file.status === 'untracked' && file.additions === 0)).toHaveLength(5)
    expect(calls.filter((args) => args.includes('--no-index'))).toHaveLength(INBOX_UNTRACKED_COUNT_LIMIT)
    // Nothing is left out when everything fits.
    await Promise.all(Array.from({ length: 5 }, (_, n) => rm(join(repo.directory, `build/out-${String(n).padStart(3, '0')}.txt`))))
    await Promise.all(Array.from({ length: 5 }, (_, n) => rm(join(repo.directory, `build/out-${String(INBOX_UNTRACKED_COUNT_LIMIT + n).padStart(3, '0')}.txt`))))
    expect((await readGitCheckoutChangesWithRunner(repo.runner())).uncounted).toBeUndefined()
  })

  it('cuts a long patch on a character boundary and returns a short one untouched', async () => {
    const repo = await repository()
    // Three-byte characters, laid out so that the cap falls inside one (without the trim the patch ends in U+FFFD).
    await repo.write('wide.txt', '€€€€€€€€€€\n'.repeat(4_000))
    const patch = await readGitCheckoutDiffWithRunner(repo.runner(), 'wide.txt')
    expect(patch.truncated).toBe(true)
    expect(patch.diff).not.toContain('\ufffd')
    expect(Buffer.byteLength(patch.diff)).toBeLessThanOrEqual(INBOX_DIFF_PREVIEW_BYTES)
    await repo.write('short.txt', 'ends with \ufffd')
    const short = await readGitCheckoutDiffWithRunner(repo.runner(), 'short.txt')
    expect(short.truncated).toBe(false)
    expect(short.diff).toContain('+ends with \ufffd')
  })
})
