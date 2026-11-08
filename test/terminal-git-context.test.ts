import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { readGitTerminalInfo } from '../src/main/git'
import type { DirectoryContext } from '../src/shared/types'

const run = promisify(execFile)
const roots: string[] = []
const hasGit = process.platform !== 'win32' && await run('git', ['--version']).then(() => true, () => false)
const gitTests = hasGit ? describe : describe.skip

async function repository(): Promise<DirectoryContext> {
  const root = await mkdtemp(join(tmpdir(), 'mde-terminal-git-'))
  roots.push(root)
  await run('git', ['init', '--quiet', '--initial-branch=main', root])
  return { id: 'session', name: 'App', kind: 'native', path: root, createdAt: '2026-01-01' }
}

async function git(session: DirectoryContext, args: string[]): Promise<void> {
  await run('git', ['-C', session.path, ...args])
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

gitTests('Git for a terminal current directory', () => {
  it('summarizes the whole checkout from a terminal subfolder', async () => {
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
    const header = await readGitTerminalInfo(session, directory)
    expect(header).toMatchObject({ repository: true, branch: 'main', worktree: session.path, directory, additions: 2, deletions: 1, changedFiles: 3 })
  })

  it('counts untracked entries before the first commit', async () => {
    const session = await repository()
    await writeFile(join(session.path, 'first.txt'), 'first\n')
    expect(await readGitTerminalInfo(session, session.path)).toMatchObject({ branch: 'main', changedFiles: 1, additions: 0, deletions: 0 })
  })
})
