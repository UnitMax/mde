import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import type {
  InboxFolder,
  InboxGitInfo,
  InboxThread,
  InboxWorktree,
  InboxWorktreeEntry,
  OpenCodeTarget,
} from '@shared/types'
import {
  createGitCommandRunner,
  createGitMutationRunner,
  readGitRefs,
  readGitBranchInfoWithRunner,
  type GitCommandResult,
  type GitCommandRunner,
} from '../git'
import { worktreeBranchConflict, worktreeBranchProblem } from '@shared/worktree-branch'
import { targetSession } from '../opencode/service/discovery'
import { isPlainAbsolutePath } from '../wsl/paths'
import { assertWslLinuxPath, readWslShellValue } from '../wsl/shell-value'

/** Where MDE puts the worktrees it creates, below the home directory of the folder's own target. */
const WORKTREES_DIRECTORY = '.mde/worktrees'
const CREATE_ATTEMPTS = 3
const MESSAGE_MAX_LENGTH = 200
/** How many Git commands the worktree list runs at once. */
const LIST_CONCURRENCY = 4

export interface InboxWorktreeDependencies {
  /** A read-only runner for queries about the folder's repository. */
  read(target: OpenCodeTarget, directory: string): GitCommandRunner
  /** A runner for commands that create or remove a worktree. */
  mutate(target: OpenCodeTarget, directory: string): GitCommandRunner
  /** The home directory of the target, in the target's own format. */
  home(target: OpenCodeTarget): Promise<string>
  /** A fresh eight-character lowercase hex id for a worktree and its branch. */
  randomId(): string
}

/** What MDE itself recorded about a worktree: on a thread that runs in it, or on its folder entry. */
export interface WorktreeRecord {
  target: OpenCodeTarget
  repository: string
  root: string
  branch?: string
  base?: string
  createdAt?: number
}

/** One entry of `git worktree list --porcelain`. */
interface ListedWorktree {
  root: string
  branch: string | null
  prunable: boolean
}

export function parseWorktreeList(output: string): ListedWorktree[] {
  const result: ListedWorktree[] = []
  for (const block of output.split(/\n\s*\n/)) {
    const lines = block.split('\n')
    const head = lines.find((line) => line.startsWith('worktree '))
    if (!head) continue
    const branch = lines.find((line) => line.startsWith('branch refs/heads/'))
    result.push({
      root: head.slice('worktree '.length),
      branch: branch ? branch.slice('branch refs/heads/'.length) : null,
      prunable: lines.some((line) => line === 'prunable' || line.startsWith('prunable ')),
    })
  }
  return result
}

function targetKey(target: OpenCodeTarget): string {
  return target.kind === 'native' ? 'native' : `wsl:${target.distro}`
}

/** Runs `work` over `items`, at most `limit` at a time, keeping their order. */
async function pooled<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await work(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
  return results
}

export interface CreatedWorktree {
  /** The directory the thread runs in: the worktree's root, or the folder's own subdirectory in it. */
  directory: string
  worktree: InboxWorktree
}

const defaults: InboxWorktreeDependencies = {
  read: (target, directory) => createGitCommandRunner({ ...targetSession(target), path: directory }, process.platform, directory, 'interactive'),
  mutate: (target, directory) => createGitMutationRunner({ ...targetSession(target), path: directory }, directory),
  home: async (target) => {
    if (target.kind === 'native') return homedir()
    const value = await readWslShellValue(target.distro, '"$HOME"')
    if (value.value === null) throw new Error(`Could not read the home directory of ${target.distro}.`)
    return assertWslLinuxPath(value.value, 'home directory')
  },
  randomId: () => randomBytes(4).toString('hex'),
}

/**
 * What went wrong, from Git's error output: its `fatal:` or `error:` line, without the prefix (Git
 * may print progress such as "Preparing worktree" before it), short enough for a dialog.
 */
function gitMessage(result: GitCommandResult): string {
  if (result.launchError) return 'Git could not be run.'
  const lines = result.stderr.split('\n').map((item) => item.trim()).filter(Boolean)
  const line = lines.find((item) => /^(?:fatal|error):/i.test(item)) ?? lines[0] ?? 'Git failed.'
  const message = line.replace(/^(?:fatal|error):\s*/i, '')
  return message.length > MESSAGE_MAX_LENGTH ? `${message.slice(0, MESSAGE_MAX_LENGTH - 1)}…` : message
}

/** A readable, path-safe stand-in for a folder name: nothing but letters, digits, dot, dash and underscore. */
function slug(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+|-+$/g, '').slice(0, 40) || 'folder'
}

function folderSuffix(folderId: string): string {
  return folderId.replace(/^fld_/, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8)
}

function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`)
}

function sameTarget(a: OpenCodeTarget, b: OpenCodeTarget): boolean {
  return a.kind === b.kind && (a.kind === 'native' || (b.kind === 'wsl' && a.distro === b.distro))
}

/**
 * Git worktrees for Inbox threads: the branches a thread can start from, creating a worktree on
 * a new branch, and removing it again. The renderer never names a path or a branch to create:
 * the base must be one of the refs Git itself lists, every path is made here from a random id, and
 * a branch name is either generated or a validated name of the person's own.
 */
export class InboxWorktrees {
  private readonly dependencies: InboxWorktreeDependencies

  constructor(dependencies: Partial<InboxWorktreeDependencies> = {}) {
    this.dependencies = { ...defaults, ...dependencies }
  }

  async info(folder: InboxFolder): Promise<InboxGitInfo> {
    const run = this.dependencies.read(folder.target, folder.directory)
    const terminal = await readGitBranchInfoWithRunner(run)
    if (!terminal.repository) return { repository: false, branch: null, branches: [] }
    const refs = await readGitRefs(run)
    return {
      repository: true,
      branch: terminal.branch,
      branches: refs.map(({ name, remote }) => ({ name, remote })),
    }
  }

  /**
   * Creates a worktree on a new branch cut from `base`. The branch is named `mde/<id>` unless the
   * person chose a name, which must be valid and must not be taken: a branch that already exists is
   * never reused, and never deleted by the cleanup after a failure.
   */
  async create(folder: InboxFolder, base: string, chosenBranch?: string): Promise<CreatedWorktree> {
    const read = this.dependencies.read(folder.target, folder.directory)
    const refs = await readGitRefs(read)
    const ref = refs.find((item) => item.name === base)
    if (!ref) throw new Error('Choose a branch from the list.')
    if (chosenBranch !== undefined) {
      const problem = worktreeBranchProblem(chosenBranch) ??
        worktreeBranchConflict(chosenBranch, refs.filter((item) => !item.remote).map((item) => item.name))
      if (problem) throw new Error(problem)
      // The list is capped, so ask Git about this exact name too.
      const taken = await read(['show-ref', '--verify', '--quiet', `refs/heads/${chosenBranch}`])
      if (taken.code === 0) throw new Error(`A branch named ${chosenBranch} already exists. Choose another name.`)
    }

    const home = await this.dependencies.home(folder.target)
    const parent = `${home.replace(/\/+$/, '')}/${WORKTREES_DIRECTORY}/${slug(folder.name)}-${folderSuffix(folder.id)}`
    if (!isPlainAbsolutePath(parent)) throw new Error('The worktree folder is not a plain absolute path.')

    const prefix = await this.folderPrefix(read, ref.ref)
    const mutate = this.dependencies.mutate(folder.target, folder.directory)
    // A chosen name cannot be retried with another id: if it clashes, the person has to pick again.
    const attempts = chosenBranch === undefined ? CREATE_ATTEMPTS : 1
    for (let attempt = 1; ; attempt++) {
      const id = this.dependencies.randomId()
      const branch = chosenBranch ?? `mde/${id}`
      const root = `${parent}/${id}`
      // Establish the new HEAD before inspecting filters for checkout: onbranch
      // includes can expose drivers that do not exist in the original checkout.
      const added = await mutate(['worktree', 'add', '--no-checkout', '--no-track', '-b', branch, '--', root, ref.ref])
      let result = added
      if (added.code === 0) {
        try {
          result = await mutate(['-C', root, 'reset', '--hard', '--no-recurse-submodules', 'HEAD'])
        } catch (error) {
          await this.discard(folder.target, { repository: folder.directory, root, branch, base })
          throw error
        }
      }
      if (result.code === 0) {
        return {
          directory: prefix ? `${root}/${prefix}` : root,
          worktree: { repository: folder.directory, root, branch, base },
        }
      }
      // A clash with an existing branch or folder left nothing of ours behind (and a chosen name that
      // clashes is somebody's own branch, which must stay). Any other failure will fail again, and
      // may have left a partial worktree and the branch we were creating.
      const clash = added.code !== 0 && !result.launchError && /already exists/i.test(result.stderr)
      if (clash && attempt < attempts) continue
      if (!clash) await this.discard(folder.target, { repository: folder.directory, root, branch, base })
      throw new Error(`Could not create the worktree: ${gitMessage(result)}`)
    }
  }

  /**
   * Removes a worktree that was only just created, together with its branch, because the thread
   * that was to use it could not be started. Nothing has run in it, so nothing can be lost, and it
   * never fails: whatever cannot be undone is left for the user.
   */
  async discard(target: OpenCodeTarget, worktree: InboxWorktree): Promise<void> {
    try {
      const run = this.dependencies.mutate(target, worktree.repository)
      await run(['worktree', 'remove', '--force', '--', worktree.root])
      await run(['worktree', 'prune'])
      await run(['branch', '-D', '--', worktree.branch])
    } catch {
      // Best effort only.
    }
  }

  /**
   * Removes a thread's worktree, keeping its branch. Git refuses while the worktree has uncommitted
   * changes and that refusal is passed on; nothing is forced.
   */
  async remove(thread: InboxThread, threads: readonly InboxThread[]): Promise<void> {
    const worktree = thread.worktree
    if (!worktree) throw new Error('This thread has no worktree.')
    if (threads.some((other) => other.id !== thread.id && !other.worktreeRemovedAt && other.worktree?.root === worktree.root && sameTarget(other.target, thread.target))) {
      throw new Error('Another thread still uses this worktree.')
    }
    if (!inside(worktree.root, thread.directory)) throw new Error('This worktree is not in MDE’s worktree folder, so MDE will not remove it.')
    await this.removeRoot(thread.target, worktree.repository, worktree.root)
  }

  /**
   * Removes the worktree at `root`, which must be in MDE's own worktree folder, keeping its branch. With
   * `force`, uncommitted changes in it are thrown away; without, Git's refusal is passed on.
   */
  async removeRoot(target: OpenCodeTarget, repository: string, root: string, options: { force?: boolean } = {}): Promise<void> {
    const base = await this.worktreesFolder(target)
    if (!isPlainAbsolutePath(root) || !root.startsWith(base) || root.length <= base.length) {
      throw new Error('This worktree is not in MDE’s worktree folder, so MDE will not remove it.')
    }
    const run = this.dependencies.mutate(target, repository)
    // A missing target has no config to inspect and no files to remove. Prune
    // its stale registration before asking the guarded removal runner to enter it.
    const read = this.dependencies.read(target, repository)
    const exists = await read(['-C', root, 'rev-parse', '--is-inside-work-tree'])
    if (exists.code !== 0) {
      await run(['worktree', 'prune'])
      const listed = await read(['worktree', 'list', '--porcelain'])
      if (listed.code === 0 && !parseWorktreeList(listed.stdout).some((item) => item.root === root)) return
      throw new Error('Could not inspect the worktree before removing it.')
    }
    const result = await run(['worktree', 'remove', ...(options.force ? ['--force'] : []), '--', root])
    if (result.code === 0) return
    // Already deleted by hand: forget Git's record of it and call it done.
    if (/is not a working tree/i.test(result.stderr)) {
      await run(['worktree', 'prune'])
      return
    }
    throw new Error(`Could not remove the worktree: ${gitMessage(result)}`)
  }

  /** Deletes a worktree's branch, unmerged commits and all. Returns why Git refused, or null once it is gone. */
  async deleteBranch(target: OpenCodeTarget, repository: string, branch: string): Promise<string | null> {
    const result = await this.dependencies.mutate(target, repository)(['branch', '-D', '--', branch])
    return result.code === 0 ? null : `Could not delete the branch ${branch}: ${gitMessage(result)}`
  }

  /**
   * The worktrees MDE made: those it recorded, and those Git lists for each repository that are in MDE's
   * worktree folder, which finds one whose threads are all gone. With `status`, each says what is in it:
   * uncommitted files and commits no other branch has. Nothing here changes anything.
   */
  async list(repositories: readonly { target: OpenCodeTarget; directory: string }[], records: readonly WorktreeRecord[], options: { status?: boolean } = {}): Promise<InboxWorktreeEntry[]> {
    const folders = new Map<string, string | null>()
    const folderOf = async (target: OpenCodeTarget): Promise<string | null> => {
      const key = targetKey(target)
      if (!folders.has(key)) folders.set(key, await this.worktreesFolder(target).catch(() => null))
      return folders.get(key) ?? null
    }
    const places = new Map<string, { target: OpenCodeTarget; directory: string }>()
    for (const place of [...repositories, ...records.map((record) => ({ target: record.target, directory: record.repository }))]) {
      places.set(`${targetKey(place.target)}\0${place.directory}`, place)
    }
    const entries = new Map<string, InboxWorktreeEntry & { listed: boolean }>()
    const listed = await pooled([...places.values()], LIST_CONCURRENCY, async (place) => {
      const folder = await folderOf(place.target)
      if (!folder) return []
      const result = await this.dependencies.read(place.target, place.directory)(['worktree', 'list', '--porcelain']).catch(() => null)
      if (!result || result.code !== 0) return []
      return parseWorktreeList(result.stdout)
        .filter((item) => item.root.startsWith(folder) && item.root.length > folder.length && isPlainAbsolutePath(item.root))
        .map((item) => ({ ...item, place }))
    })
    for (const item of listed.flat()) {
      const key = `${targetKey(item.place.target)}\0${item.root}`
      if (entries.has(key)) continue
      entries.set(key, {
        target: item.place.target,
        root: item.root,
        repository: item.place.directory,
        branch: item.branch,
        missing: item.prunable,
        changes: null,
        unmerged: null,
        listed: true,
      })
    }
    for (const record of records) {
      const key = `${targetKey(record.target)}\0${record.root}`
      const known = entries.get(key)
      if (known) {
        // MDE's record says where it was cut from and when; Git says what is there now.
        known.repository = record.repository
        if (record.base && !known.base) known.base = record.base
        if (record.createdAt !== undefined && (known.createdAt === undefined || record.createdAt < known.createdAt)) known.createdAt = record.createdAt
        continue
      }
      const folder = await folderOf(record.target)
      if (!folder || !record.root.startsWith(folder)) continue
      // Recorded but not listed by Git: deleted by hand, and perhaps pruned too.
      entries.set(key, {
        target: record.target,
        root: record.root,
        repository: record.repository,
        branch: record.branch ?? null,
        ...(record.base ? { base: record.base } : {}),
        ...(record.createdAt !== undefined ? { createdAt: record.createdAt } : {}),
        missing: true,
        changes: null,
        unmerged: null,
        listed: false,
      })
    }
    const result = [...entries.values()]
    if (options.status) {
      await pooled(result, LIST_CONCURRENCY, async (entry) => {
        const read = this.dependencies.read(entry.target, entry.repository)
        if (!entry.missing) {
          const status = await read(['-C', entry.root, 'status', '--porcelain', '--untracked-files=normal']).catch(() => null)
          if (status?.code === 0) entry.changes = status.stdout.split('\n').filter(Boolean).length
          else if (status && !status.launchError) entry.missing = true
        }
        if (entry.branch && entry.listed) {
          // The commits only this branch has: what deleting it would lose.
          const count = await read(['rev-list', '--count', `refs/heads/${entry.branch}`, '--not', `--exclude=${entry.branch}`, '--branches', '--remotes']).catch(() => null)
          const value = count?.code === 0 ? Number.parseInt(count.stdout.trim(), 10) : Number.NaN
          if (Number.isFinite(value)) entry.unmerged = value
        }
      })
    }
    return result.map(({ listed: _listed, ...entry }) => entry)
  }

  /** MDE's worktree folder for a target, ending in a slash. */
  private async worktreesFolder(target: OpenCodeTarget): Promise<string> {
    const home = await this.dependencies.home(target)
    return `${home.replace(/\/+$/, '')}/${WORKTREES_DIRECTORY}/`
  }

  /**
   * The folder's place inside its repository (`packages/app`), which the new worktree should
   * keep, or '' for the repository root or when the base branch has no such directory.
   */
  private async folderPrefix(run: GitCommandRunner, ref: string): Promise<string> {
    const shown = await run(['rev-parse', '--show-prefix'])
    const prefix = shown.code === 0 ? shown.stdout.replace(/\n$/, '').replace(/\/$/, '') : ''
    if (!prefix || /[\u0000-\u001f\u007f]/.test(prefix) || prefix.split('/').some((segment) => segment === '.' || segment === '..')) return ''
    const exists = await run(['rev-parse', '--verify', '--quiet', `${ref}:${prefix}`])
    return exists.code === 0 ? prefix : ''
  }
}
