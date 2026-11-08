import { execFile } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { InboxWorktrees } from '../src/main/inbox/worktree'
import type { GitCommandResult, GitCommandRunner } from '../src/main/git'
import type { InboxFolder, InboxThread, InboxWorktree } from '../src/shared/types'

const run = promisify(execFile)

/**
 * Worktree creation and removal are only meaningful against real Git, so that suite is skipped
 * where Git is unavailable. The WSL transport is covered by argument-level tests in `git.test.ts`.
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
const describeGit = hasPosixGit ? describe : describe.skip

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd })
  return stdout.trim()
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false)
}

function folderFor(directory: string, name = 'app'): InboxFolder {
  return { id: 'fld_0123456789abcdef', name, directory, target: { kind: 'native' }, createdAt: 1, lastUsedAt: 1 }
}

function threadFor(id: string, directory: string, worktree?: InboxWorktree): InboxThread {
  return {
    id, title: 'Thread', directory, target: { kind: 'native' }, branch: null, status: 'idle',
    createdAt: 1, lastActivityAt: 1, readAt: 1, archived: false, folderId: 'fld_0123456789abcdef',
    ...(worktree ? { worktree } : {}),
  }
}

describeGit('Inbox worktrees against real Git', () => {
  let root = ''
  let home = ''
  let origin = ''
  let clone = ''
  let plain = ''
  let ids: string[] = []
  const service = (): InboxWorktrees => new InboxWorktrees({
    home: async () => home,
    randomId: () => ids.shift() ?? Math.random().toString(16).slice(2, 10).padEnd(8, '0'),
  })

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'mde-inbox-worktree.'))
    home = join(root, 'home')
    origin = join(root, 'origin')
    clone = join(root, 'clone')
    plain = join(root, 'plain')
    await mkdir(home)
    await mkdir(plain)
    await mkdir(origin)
    await git(origin, 'init', '--quiet', '--initial-branch=main')
    await writeFile(join(origin, 'README.md'), 'one\n')
    await git(origin, 'add', '.')
    await git(origin, 'commit', '--quiet', '-m', 'One')
    await git(origin, 'branch', 'before-packages')
    await mkdir(join(origin, 'packages', 'app'), { recursive: true })
    await writeFile(join(origin, 'packages', 'app', 'index.ts'), 'export {}\n')
    await git(origin, 'add', '.')
    await git(origin, 'commit', '--quiet', '-m', 'Add the app package')
    await git(root, 'clone', '--quiet', origin, clone)
    await git(clone, 'branch', 'feature')
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('lists local branches before remote ones and leaves out the remote HEAD', async () => {
    const info = await service().info(folderFor(clone))
    expect(info.repository).toBe(true)
    expect(info.branch).toBe('main')
    const names = info.branches.map((branch) => branch.name)
    expect(names).toEqual(expect.arrayContaining(['main', 'feature', 'origin/main', 'origin/before-packages']))
    expect(names).not.toContain('origin/HEAD')
    const firstRemote = info.branches.findIndex((branch) => branch.remote)
    expect(info.branches.slice(0, firstRemote).every((branch) => !branch.remote)).toBe(true)
    expect(info.branches.slice(firstRemote).every((branch) => branch.remote)).toBe(true)
  })

  it('reports a folder that is not a repository', async () => {
    expect(await service().info(folderFor(plain))).toEqual({ repository: false, branch: null, branches: [] })
  })

  it('creates a worktree on a new, untracked branch cut from a local branch', async () => {
    ids = ['aaaaaaaa']
    const created = await service().create(folderFor(clone), 'feature')
    const rootPath = join(home, '.mde', 'worktrees', 'app-01234567', 'aaaaaaaa')
    expect(created).toEqual({
      directory: rootPath,
      worktree: { repository: clone, root: rootPath, branch: 'mde/aaaaaaaa', base: 'feature' },
    })
    expect(await git(rootPath, 'branch', '--show-current')).toBe('mde/aaaaaaaa')
    expect(await readFile(join(rootPath, 'README.md'), 'utf8')).toBe('one\n')
    expect(await git(clone, 'rev-parse', 'refs/heads/mde/aaaaaaaa')).toBe(await git(clone, 'rev-parse', 'feature'))
    // `git config --get-regexp` exits 1 when nothing matches, which `git()` reports as a rejection.
    await expect(git(clone, 'config', '--get-regexp', '^branch\\.mde/aaaaaaaa\\.')).rejects.toThrow()
  })

  it('creates a worktree from a remote-tracking branch without making the new branch track it', async () => {
    ids = ['bbbbbbbb']
    const created = await service().create(folderFor(clone), 'origin/main')
    expect(await git(created.directory, 'rev-parse', 'HEAD')).toBe(await git(clone, 'rev-parse', 'refs/remotes/origin/main'))
    await expect(git(clone, 'config', '--get', 'branch.mde/bbbbbbbb.remote')).rejects.toThrow()
  })

  it('runs in the same subfolder of the worktree as the folder is in the repository', async () => {
    ids = ['cccccccc']
    const created = await service().create(folderFor(join(clone, 'packages', 'app'), 'App Package!'), 'main')
    const rootPath = join(home, '.mde', 'worktrees', 'App-Package-01234567', 'cccccccc')
    expect(created.worktree.root).toBe(rootPath)
    expect(created.directory).toBe(join(rootPath, 'packages', 'app'))
    expect(await exists(join(created.directory, 'index.ts'))).toBe(true)
  })

  it('falls back to the worktree root when the base branch lacks the folder', async () => {
    ids = ['dddddddd']
    const created = await service().create(folderFor(join(clone, 'packages', 'app')), 'origin/before-packages')
    expect(created.directory).toBe(created.worktree.root)
  })

  it('uses the branch name the person chose instead of a generated one, still in a path made from the id', async () => {
    ids = ['12121212']
    const created = await service().create(folderFor(clone), 'main', 'topic/dark-mode')
    const rootPath = join(home, '.mde', 'worktrees', 'app-01234567', '12121212')
    expect(created).toEqual({
      directory: rootPath,
      worktree: { repository: clone, root: rootPath, branch: 'topic/dark-mode', base: 'main' },
    })
    expect(await git(rootPath, 'branch', '--show-current')).toBe('topic/dark-mode')
    await expect(git(clone, 'config', '--get-regexp', '^branch\\.topic/dark-mode\\.')).rejects.toThrow()
    // Removing the worktree later still keeps the branch, whatever its name.
    await service().remove(threadFor('ses_named', created.directory, created.worktree), [])
    expect(await git(clone, 'branch', '--list', 'topic/dark-mode')).toContain('topic/dark-mode')
  })

  it('does not count a branch that exists only on the remote as taken', async () => {
    ids = ['13131313']
    const created = await service().create(folderFor(clone), 'main', 'before-packages')
    expect(created.worktree.branch).toBe('before-packages')
    expect(await git(clone, 'rev-parse', 'refs/heads/before-packages')).toBe(await git(clone, 'rev-parse', 'main'))
  })

  it('refuses a name that is taken, and leaves the existing branch and the worktree list as they were', async () => {
    const tip = await git(clone, 'rev-parse', 'refs/heads/feature')
    const before = await git(clone, 'worktree', 'list')
    await expect(service().create(folderFor(clone), 'main', 'feature')).rejects.toThrow('A branch named feature already exists. Choose another name.')
    await expect(service().create(folderFor(clone), 'main', 'main')).rejects.toThrow(/already exists/)
    expect(await git(clone, 'rev-parse', 'refs/heads/feature')).toBe(tip)
    expect(await git(clone, 'worktree', 'list')).toBe(before)
  })

  it('refuses names Git would not take, or that could pass for an option, before running anything', async () => {
    const before = await git(clone, 'worktree', 'list')
    for (const name of ['-f', '--force', 'two words', 'a..b', 'a//b', 'x.lock', 'HEAD', '']) {
      await expect(service().create(folderFor(clone), 'main', name)).rejects.toThrow(/\S/)
    }
    expect(await git(clone, 'worktree', 'list')).toBe(before)
  })

  it('explains a name that would sit inside, or on top of, an existing branch, and creates nothing', async () => {
    const tip = await git(clone, 'rev-parse', 'refs/heads/feature')
    const before = await git(clone, 'worktree', 'list')
    ids = ['14141414']
    // `feature` is a branch, so `feature/sub` cannot be one.
    await expect(service().create(folderFor(clone), 'main', 'feature/sub')).rejects.toThrow('A branch named feature already exists, so feature/sub cannot be created. Choose another name.')
    // `topic/dark-mode` exists from an earlier test, so `topic` cannot be a branch.
    await expect(service().create(folderFor(clone), 'main', 'topic')).rejects.toThrow('Branches under topic/ already exist, so topic cannot be a branch. Choose another name.')
    expect(await git(clone, 'rev-parse', 'refs/heads/feature')).toBe(tip)
    expect(await git(clone, 'worktree', 'list')).toBe(before)
    expect(await exists(join(home, '.mde', 'worktrees', 'app-01234567', '14141414'))).toBe(false)
  })

  it('retries with a new id when the branch already exists', async () => {
    ids = ['aaaaaaaa', 'eeeeeeee']
    const created = await service().create(folderFor(clone), 'main')
    expect(created.worktree.branch).toBe('mde/eeeeeeee')
  })

  it('only accepts a base that Git lists, so a flag or a stray ref never reaches Git', async () => {
    const before = await git(clone, 'worktree', 'list')
    for (const base of ['--force', 'HEAD', 'refs/heads/main', 'nope', '', 'main ', '../../etc']) {
      await expect(service().create(folderFor(clone), base)).rejects.toThrow('Choose a branch from the list.')
    }
    expect(await git(clone, 'worktree', 'list')).toBe(before)
  })

  it('fails clearly for a folder that is not a repository', async () => {
    await expect(service().create(folderFor(plain), 'main')).rejects.toThrow(/Could not read Git branches/)
  })

  it('removes a clean worktree and keeps its branch', async () => {
    ids = ['f0f0f0f0']
    const { directory, worktree } = await service().create(folderFor(clone), 'main')
    await service().remove(threadFor('ses_one', directory, worktree), [])
    expect(await exists(worktree.root)).toBe(false)
    expect(await git(clone, 'branch', '--list', worktree.branch)).toContain(worktree.branch)
  })

  it('refuses to remove a worktree with uncommitted changes', async () => {
    ids = ['f1f1f1f1']
    const { directory, worktree } = await service().create(folderFor(clone), 'main')
    await writeFile(join(directory, 'scratch.txt'), 'unsaved\n')
    await expect(service().remove(threadFor('ses_one', directory, worktree), []))
      .rejects.toThrow(/Could not remove the worktree: .*(modified or untracked|--force)/)
    expect(await exists(join(directory, 'scratch.txt'))).toBe(true)
  })

  it('refuses to remove a worktree another thread still uses, and one without a marker', async () => {
    ids = ['f2f2f2f2']
    const { directory, worktree } = await service().create(folderFor(clone), 'main')
    const mine = threadFor('ses_one', directory, worktree)
    await expect(service().remove(mine, [mine, threadFor('ses_two', directory, worktree)])).rejects.toThrow('Another thread still uses this worktree.')
    await expect(service().remove(threadFor('ses_three', clone), [])).rejects.toThrow('This thread has no worktree.')
    expect(await exists(worktree.root)).toBe(true)
  })

  it('will not remove anything outside MDE’s worktree folder', async () => {
    const outside: InboxWorktree = { repository: clone, root: plain, branch: 'mde/x', base: 'main' }
    await expect(service().remove(threadFor('ses_one', plain, outside), [])).rejects.toThrow(/not in MDE/)
    const dotted: InboxWorktree = { ...outside, root: `${home}/.mde/worktrees/../../plain` }
    await expect(service().remove(threadFor('ses_one', dotted.root, dotted), [])).rejects.toThrow(/not in MDE/)
    expect(await exists(plain)).toBe(true)
  })

  it('treats a worktree already deleted by hand as removed', async () => {
    ids = ['f3f3f3f3']
    const { directory, worktree } = await service().create(folderFor(clone), 'main')
    await rm(worktree.root, { recursive: true })
    await service().remove(threadFor('ses_one', directory, worktree), [])
    expect(await git(clone, 'worktree', 'list')).not.toContain('f3f3f3f3')
  })

  it('discards a fresh worktree together with its branch', async () => {
    ids = ['f4f4f4f4']
    const { worktree } = await service().create(folderFor(clone), 'main')
    await service().discard({ kind: 'native' }, worktree)
    expect(await exists(worktree.root)).toBe(false)
    expect(await git(clone, 'branch', '--list', worktree.branch)).toBe('')
  })
})

describe('Inbox worktrees with a fake runner', () => {
  const ok = (stdout = ''): GitCommandResult => ({ stdout, stderr: '', code: 0 })
  const folder = folderFor('/home/me/app')

  function setup(handler: (args: string[]) => GitCommandResult) {
    const reads: string[][] = []
    const mutations: string[][] = []
    const read: GitCommandRunner = async (args) => { reads.push(args); return handler(args) }
    const mutate: GitCommandRunner = async (args) => { mutations.push(args); return handler(args) }
    const service = new InboxWorktrees({ read: () => read, mutate: () => mutate, home: async () => '/home/me', randomId: () => 'abcd1234' })
    return { service, reads, mutations }
  }

  const refs = 'refs/heads/main\nrefs/remotes/origin/HEAD\nrefs/remotes/origin/main\n'

  it('passes the full ref, a generated branch and a terminator, with no renderer text in the path', async () => {
    const { service, mutations } = setup((args) => (args.includes('for-each-ref') ? ok(refs) : ok()))
    const created = await service.create(folder, 'origin/main')
    expect(mutations).toEqual([
      ['worktree', 'add', '--no-checkout', '--no-track', '-b', 'mde/abcd1234', '--', '/home/me/.mde/worktrees/app-01234567/abcd1234', 'refs/remotes/origin/main'],
      ['-C', '/home/me/.mde/worktrees/app-01234567/abcd1234', 'reset', '--hard', '--no-recurse-submodules', 'HEAD'],
    ])
    expect(created.worktree).toEqual({
      repository: '/home/me/app', root: '/home/me/.mde/worktrees/app-01234567/abcd1234', branch: 'mde/abcd1234', base: 'origin/main',
    })
  })

  it('cleans up after a failure that is not a name clash, and says why', async () => {
    const { service, mutations } = setup((args) => {
      if (args.includes('for-each-ref')) return ok(refs)
      if (args.includes('add')) return { stdout: '', stderr: 'fatal: could not write the checkout\nmore detail\n', code: 128 }
      return ok()
    })
    await expect(service.create(folder, 'main')).rejects.toThrow('Could not create the worktree: could not write the checkout')
    expect(mutations.map((args) => args.slice(0, 2).join(' '))).toEqual(['worktree add', 'worktree remove', 'worktree prune', 'branch -D'])
  })

  it('reports the fatal line, not the progress Git prints before it', async () => {
    const { service } = setup((args) => {
      if (args.includes('for-each-ref')) return ok(refs)
      if (args.includes('add')) return { stdout: '', stderr: "Preparing worktree (new branch 'x')\nfatal: cannot lock ref 'refs/heads/x': disk full\n", code: 255 }
      return ok()
    })
    await expect(service.create(folder, 'main')).rejects.toThrow("Could not create the worktree: cannot lock ref 'refs/heads/x': disk full")
  })

  it('cleans up a failed checkout even when its error says a file already exists', async () => {
    const { service, mutations } = setup((args) => {
      if (args.includes('for-each-ref')) return ok(refs)
      if (args.includes('reset')) return { stdout: '', stderr: 'fatal: target file already exists', code: 128 }
      return ok()
    })
    await expect(service.create(folder, 'main')).rejects.toThrow('target file already exists')
    expect(mutations.at(-1)).toEqual(['branch', '-D', '--', 'mde/abcd1234'])
    expect(mutations.filter((args) => args[0] === 'worktree' && args[1] === 'add')).toHaveLength(1)
  })

  it('gives up after three clashes without touching what already exists', async () => {
    const { service, mutations } = setup((args) => {
      if (args.includes('for-each-ref')) return ok(refs)
      if (args.includes('add')) return { stdout: '', stderr: "fatal: a branch named 'mde/abcd1234' already exists", code: 128 }
      return ok()
    })
    await expect(service.create(folder, 'main')).rejects.toThrow(/already exists/)
    expect(mutations).toHaveLength(3)
    expect(mutations.every((args) => args[1] === 'add')).toBe(true)
  })

  describe('with a chosen branch name', () => {
    const missing: GitCommandResult = { stdout: '', stderr: '', code: 1 }
    const clash: GitCommandResult = { stdout: '', stderr: "fatal: a branch named 'feature/x' already exists", code: 128 }

    it('asks for the exact ref first and then creates the branch under that name', async () => {
      const { service, reads, mutations } = setup((args) => (args.includes('for-each-ref') ? ok(refs) : args[0] === 'show-ref' ? missing : ok()))
      const created = await service.create(folder, 'main', 'feature/x')
      expect(reads).toContainEqual(['show-ref', '--verify', '--quiet', 'refs/heads/feature/x'])
      expect(mutations).toEqual([
        ['worktree', 'add', '--no-checkout', '--no-track', '-b', 'feature/x', '--', '/home/me/.mde/worktrees/app-01234567/abcd1234', 'refs/heads/main'],
        ['-C', '/home/me/.mde/worktrees/app-01234567/abcd1234', 'reset', '--hard', '--no-recurse-submodules', 'HEAD'],
      ])
      expect(created.worktree.branch).toBe('feature/x')
    })

    it('stops at a taken name without creating anything', async () => {
      const { service, mutations } = setup((args) => (args.includes('for-each-ref') ? ok(refs) : ok()))
      await expect(service.create(folder, 'main', 'feature/x')).rejects.toThrow('A branch named feature/x already exists. Choose another name.')
      expect(mutations).toEqual([])
    })

    it('does not ask Git about a name that is not valid', async () => {
      const { service, reads, mutations } = setup((args) => (args.includes('for-each-ref') ? ok(refs) : ok()))
      await expect(service.create(folder, 'main', '--force')).rejects.toThrow('A branch name cannot start with -.')
      expect(reads.some((args) => args[0] === 'show-ref')).toBe(false)
      expect(mutations).toEqual([])
    })

    it('neither retries nor deletes anything when someone creates the branch in the meantime', async () => {
      const { service, mutations } = setup((args) => {
        if (args.includes('for-each-ref')) return ok(refs)
        if (args[0] === 'show-ref') return missing
        return args.includes('add') ? clash : ok()
      })
      await expect(service.create(folder, 'main', 'feature/x')).rejects.toThrow(/already exists/)
      expect(mutations.map((args) => args[1])).toEqual(['add'])
    })

    it('cleans up the branch it was creating when Git fails for another reason', async () => {
      const { service, mutations } = setup((args) => {
        if (args.includes('for-each-ref')) return ok(refs)
        if (args[0] === 'show-ref') return missing
        return args.includes('add') ? { stdout: '', stderr: 'fatal: could not write the checkout', code: 128 } : ok()
      })
      await expect(service.create(folder, 'main', 'feature/x')).rejects.toThrow('could not write the checkout')
      expect(mutations.map((args) => args.slice(0, 2).join(' '))).toEqual(['worktree add', 'worktree remove', 'worktree prune', 'branch -D'])
      expect(mutations.at(-1)).toEqual(['branch', '-D', '--', 'feature/x'])
    })
  })

  it('never lets a failed cleanup escape', async () => {
    const mutate = vi.fn(async () => { throw new Error('gone') })
    const service = new InboxWorktrees({ mutate: () => mutate, home: async () => '/home/me' })
    await expect(service.discard({ kind: 'native' }, { repository: '/home/me/app', root: '/home/me/.mde/worktrees/a/b', branch: 'mde/b', base: 'main' })).resolves.toBeUndefined()
  })
})
