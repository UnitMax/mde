import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { readGitDiff, readGitInfo, readGitTerminalInfo } from '../src/main/git'
import type { Session } from '../src/shared/types'

const run = promisify(execFile)
const roots: string[] = []
const hasGit = process.platform !== 'win32' && await run('git', ['--version']).then(() => true, () => false)
const gitTests = hasGit ? describe : describe.skip

async function repository(): Promise<Session> {
  const root = await mkdtemp(join(tmpdir(), 'mde-terminal-git-'))
  roots.push(root)
  await run('git', ['init', '--quiet', '--initial-branch=main', root])
  return { id: 'session', projectId: 'project', name: 'App', kind: 'native', path: root, createdAt: '2026-01-01' }
}

async function git(session: Session, args: string[]): Promise<void> {
  await run('git', ['-C', session.path, ...args])
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

gitTests('Git for a terminal current directory', () => {
  it('reviews the whole checkout from a subfolder and resolves literal paths at the repository root', async () => {
    const session = await repository()
    await mkdir(join(session.path, 'src'))
    await writeFile(join(session.path, 'root.txt'), 'original\n')
    await writeFile(join(session.path, 'src', 'file[1].ts'), 'old\n')
    await git(session, ['add', '.'])
    await git(session, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'Initial'])
    await writeFile(join(session.path, 'root.txt'), 'original\nadded\n')
    await writeFile(join(session.path, 'src', 'file[1].ts'), 'new\n')
    await writeFile(join(session.path, 'untracked.txt'), 'new file\n')
    const directory = join(session.path, 'src')
    const current = { ...session, path: directory }
    const header = await readGitTerminalInfo(session, directory)
    expect(header).toMatchObject({ repository: true, branch: 'main', worktree: session.path, directory, additions: 2, deletions: 1, changedFiles: 3 })
    const info = await readGitInfo(current)
    expect(info.changes.map((change) => change.path).sort()).toEqual(['root.txt', 'src/file[1].ts', 'untracked.txt'])
    const rootDiff = await readGitDiff(current, 'root.txt')
    expect(rootDiff.diff).toContain('+added')
    const literalDiff = await readGitDiff(current, 'src/file[1].ts')
    expect(literalDiff.diff).toContain('+new')
    const untrackedDiff = await readGitDiff(current, 'untracked.txt')
    expect(untrackedDiff.diff).toContain('+new file')
    await expect(readGitDiff(current, '../outside.txt')).rejects.toThrow('no longer available')
  })

  it('shows untracked entries and diffs before the first commit', async () => {
    const session = await repository()
    await writeFile(join(session.path, 'first.txt'), 'first\n')
    expect(await readGitTerminalInfo(session, session.path)).toMatchObject({ branch: 'main', changedFiles: 1, additions: 0, deletions: 0 })
    expect(await readGitInfo(session)).toMatchObject({ repository: true, commits: [], changes: [{ path: 'first.txt', status: 'untracked' }] })
    expect((await readGitDiff(session, 'first.txt')).diff).toContain('+first')
  })
})
