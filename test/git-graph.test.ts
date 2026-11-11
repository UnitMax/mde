import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGitCommandRunner, createGitFetchRunner, repositoryFetchPrograms } from '../src/main/git'
import {
  fetchErrorMessage,
  fetchGitWithRunners,
  parseGitGraphLog,
  parseGitGraphRefs,
  parseGitNameStatus,
  readGitCommitWithRunner,
  readGitGraphWithRunner,
} from '../src/main/git-graph'
import type { DirectoryContext } from '../src/shared/types'

const run = promisify(execFile)
const hash = (seed: string): string => seed.repeat(40).slice(0, 40)

describe('Git graph parsing', () => {
  it('reads log records with their parents and keeps a subject whole', () => {
    const stdout = `${hash('a')}\x1f${hash('b')} ${hash('c')}\x1fAda\x1f1700000000\x1fMerge branch 'x'\x1e\n` +
      `${hash('b')}\x1f\x1fBo\x1f1690000000\x1fFirst\x1e\n`
    expect(parseGitGraphLog(stdout)).toEqual([
      { hash: hash('a'), parents: [hash('b'), hash('c')], author: 'Ada', time: 1700000000, subject: "Merge branch 'x'" },
      { hash: hash('b'), parents: [], author: 'Bo', time: 1690000000, subject: 'First' },
    ])
  })

  it('reads branches, remote branches and tags, peeling annotated tags and skipping a remote HEAD', () => {
    const line = (object: string, peeled: string, ref: string): string => `${object}\x1f${peeled}\x1f${ref}`
    expect(parseGitGraphRefs([
      line(hash('a'), '', 'refs/heads/main'),
      line(hash('a'), '', 'refs/remotes/origin/main'),
      line(hash('a'), '', 'refs/remotes/origin/HEAD'),
      line(hash('d'), hash('b'), 'refs/tags/v1'),
      line(hash('c'), '', 'refs/tags/light'),
    ].join('\n'))).toEqual([
      { hash: hash('a'), name: 'main', kind: 'branch' },
      { hash: hash('a'), name: 'origin/main', kind: 'remote' },
      { hash: hash('b'), name: 'v1', kind: 'tag' },
      { hash: hash('c'), name: 'light', kind: 'tag' },
    ])
  })

  it('reads name-status output with renames', () => {
    expect(parseGitNameStatus('M\0a.ts\0R100\0old.ts\0new.ts\0A\0b.ts\0')).toEqual([
      { path: 'a.ts', status: 'modified' },
      { path: 'new.ts', from: 'old.ts', status: 'renamed' },
      { path: 'b.ts', status: 'added' },
    ])
  })

  it('names program-choosing settings only when the repository itself sets them', () => {
    const listing = [
      'global', 'credential.helper\nmanager',
      'system', 'core.sshcommand\nssh -i key',
      'local', 'credential.https://example.com.helper\nevil',
      'local', 'remote.origin.uploadpack\nevil',
      'worktree', 'core.sshcommand\nevil',
      'command', 'core.gitproxy\nx',
      'local', 'remote.origin.url\nhttps://example.com/x.git',
    ].join('\0') + '\0'
    expect(repositoryFetchPrograms(listing)).toEqual(['credential.helper', 'remote.<name>.uploadpack', 'core.sshCommand'])
  })

  it('shows what a failed fetch said, without credentials in a URL or control characters', () => {
    expect(fetchErrorMessage({
      code: 128, stdout: '',
      stderr: 'remote: noise\nfatal: unable to access \'https://me:secret@example.com/x.git/\': Could not resolve host\x1b[0m\n',
    })).toBe("Could not fetch: fatal: unable to access 'https://example.com/x.git/': Could not resolve host [0m")
    expect(fetchErrorMessage({ code: 1, stdout: '', stderr: '', launchError: true })).toMatch(/could not start/)
  })
})

const hasPosixGit = await (async () => {
  if (process.platform === 'win32') return false
  try {
    await run('git', ['--version'])
    return true
  } catch {
    return false
  }
})()

const git = (cwd: string, ...args: string[]) =>
  run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd })

describe.skipIf(!hasPosixGit)('Git graph against a real repository', () => {
  let root = ''
  let origin = ''
  let clone = ''
  let session: DirectoryContext

  async function commit(cwd: string, file: string, message: string): Promise<void> {
    await writeFile(join(cwd, file), `${message}\n`)
    await git(cwd, 'add', file)
    await git(cwd, 'commit', '--quiet', '-m', message)
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'mde-git-graph.'))
    origin = join(root, 'origin.git')
    const seed = join(root, 'seed')
    clone = join(root, 'clone')
    await mkdir(seed)
    await git(seed, 'init', '--quiet', '--initial-branch=main')
    await commit(seed, 'a.txt', 'First')
    await commit(seed, 'b.txt', 'Second')
    await git(seed, 'checkout', '--quiet', '-b', 'feature')
    await commit(seed, 'c.txt', 'Feature work')
    await git(seed, 'checkout', '--quiet', 'main')
    await commit(seed, 'd.txt', 'Main work')
    await git(seed, 'merge', '--quiet', '--no-ff', '-m', 'Merge feature', 'feature')
    await git(seed, 'tag', '-a', 'v1', '-m', 'Version one')
    await git(root, 'clone', '--quiet', '--bare', seed, origin)
    await git(root, 'clone', '--quiet', `file://${origin}`, clone)
    session = { id: 'graph', name: 'clone', kind: 'native', path: clone, createdAt: '' }
  })

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('reads every commit with its refs, HEAD and upstream', async () => {
    const graph = await readGitGraphWithRunner(createGitCommandRunner(session), 100, 'all')
    expect(graph.available).toBe(true)
    expect(graph.branch).toBe('main')
    expect(graph.commits.map((c) => c.subject)).toEqual(['Merge feature', 'Main work', 'Feature work', 'Second', 'First'])
    expect(graph.head).toBe(graph.commits[0]!.hash)
    expect(graph.commits[0]!.parents).toHaveLength(2)
    expect(graph.upstream).toEqual({ name: 'origin/main', ahead: 0, behind: 0 })
    expect(graph.remotes).toEqual(['origin'])
    const names = graph.refs.map((ref) => `${ref.kind}:${ref.name}`).sort()
    expect(names).toEqual(['branch:main', 'remote:origin/feature', 'remote:origin/main', 'tag:v1'])
    // The annotated tag points at the merge commit, not at its tag object.
    expect(graph.refs.find((ref) => ref.name === 'v1')?.hash).toBe(graph.head)
    expect(graph.more).toBe(false)
  })

  it('stops at the limit and says more exist', async () => {
    const graph = await readGitGraphWithRunner(createGitCommandRunner(session), 2, 'all')
    expect(graph.commits).toHaveLength(2)
    expect(graph.more).toBe(true)
  })

  it('narrows to local branches or to HEAD', async () => {
    await git(clone, 'checkout', '--quiet', '-b', 'side', 'HEAD~1')
    await commit(clone, 'e.txt', 'Side work')
    await git(clone, 'checkout', '--quiet', 'main')
    const head = await readGitGraphWithRunner(createGitCommandRunner(session), 100, 'head')
    expect(head.commits.map((c) => c.subject)).not.toContain('Side work')
    const local = await readGitGraphWithRunner(createGitCommandRunner(session), 100, 'local')
    expect(local.commits.map((c) => c.subject)).toContain('Side work')
  })

  it('reads one commit with its message and files, a merge against its first parent', async () => {
    const graph = await readGitGraphWithRunner(createGitCommandRunner(session), 100, 'head')
    const merge = await readGitCommitWithRunner(createGitCommandRunner(session), graph.commits[0]!.hash)
    expect(merge.message).toBe('Merge feature')
    expect(merge.files).toEqual([{ path: 'c.txt', status: 'added', additions: 1, deletions: 0, binary: false }])
    const first = graph.commits.find((c) => c.subject === 'First')!
    const root = await readGitCommitWithRunner(createGitCommandRunner(session), first.hash)
    expect(root.parents).toEqual([])
    expect(root.files.map((f) => f.path)).toEqual(['a.txt'])
    await expect(readGitCommitWithRunner(createGitCommandRunner(session), 'f'.repeat(40))).rejects.toThrow(/not in this repository/)
  })

  it('fetches new remote commits and shows the branch behind its upstream', async () => {
    const other = join(root, 'other')
    await git(root, 'clone', '--quiet', `file://${origin}`, other)
    await commit(other, 'f.txt', 'Pushed elsewhere')
    await git(other, 'push', '--quiet', 'origin', 'main')
    const before = await readGitGraphWithRunner(createGitCommandRunner(session), 100, 'all')
    expect(before.commits.map((c) => c.subject)).not.toContain('Pushed elsewhere')

    const result = await fetchGitWithRunners(createGitCommandRunner(session), (dir) => createGitFetchRunner(session, dir))
    expect(result.remotes).toEqual(['origin'])
    const after = await readGitGraphWithRunner(createGitCommandRunner(session), 100, 'all')
    expect(after.commits.map((c) => c.subject)).toContain('Pushed elsewhere')
    expect(after.refs.find((ref) => ref.name === 'origin/main')?.hash)
      .toBe(after.commits.find((c) => c.subject === 'Pushed elsewhere')?.hash)
    expect(after.upstream).toEqual({ name: 'origin/main', ahead: 0, behind: 1 })
  })

  it('refuses to fetch when the repository names a program, and never starts it', async () => {
    const sentinels = join(root, 'sentinels')
    await mkdir(sentinels, { recursive: true })
    const helper = join(root, 'helper.sh')
    await writeFile(helper, `#!/bin/sh\ntouch '${join(sentinels, 'helper')}'\n`, { mode: 0o755 })
    await git(clone, 'config', 'remote.origin.uploadpack', helper)
    try {
      await expect(fetchGitWithRunners(createGitCommandRunner(session), (dir) => createGitFetchRunner(session, dir)))
        .rejects.toThrow(/remote\.<name>\.uploadpack.*Fetch it in a terminal/)
      expect(await readdir(sentinels)).toEqual([])
    } finally {
      await git(clone, 'config', '--unset', 'remote.origin.uploadpack')
    }
  })

  it('denies a remote helper even in a URL the fetch would follow', async () => {
    const sentinels = join(root, 'ext-sentinels')
    await mkdir(sentinels, { recursive: true })
    await git(clone, 'remote', 'add', 'hostile', `ext::sh -c touch% ${join(sentinels, 'ext')}`)
    try {
      await expect(fetchGitWithRunners(createGitCommandRunner(session), (dir) => createGitFetchRunner(session, dir)))
        .rejects.toThrow(/Could not fetch/)
      expect(await readdir(sentinels)).toEqual([])
    } finally {
      await git(clone, 'remote', 'remove', 'hostile')
    }
  })

  it('says a folder is not a repository, and a repository without remotes cannot be fetched', async () => {
    const plain = join(root, 'plain')
    await mkdir(plain)
    const folder: DirectoryContext = { ...session, path: plain }
    expect((await readGitGraphWithRunner(createGitCommandRunner(folder), 10, 'all')).available).toBe(false)
    const lonely = join(root, 'lonely')
    await mkdir(lonely)
    await git(lonely, 'init', '--quiet', '--initial-branch=main')
    const empty = await readGitGraphWithRunner(createGitCommandRunner({ ...session, path: lonely }), 10, 'all')
    expect(empty).toMatchObject({ available: true, head: null, branch: 'main', commits: [], upstream: null })
    await expect(fetchGitWithRunners(createGitCommandRunner({ ...session, path: lonely }), (dir) => createGitFetchRunner(session, dir)))
      .rejects.toThrow(/no remotes/)
  })
})
