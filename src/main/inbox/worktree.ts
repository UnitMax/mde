import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import type {
  InboxFolder,
  InboxGitInfo,
  InboxThread,
  InboxWorktree,
  OpenCodeTarget,
} from '@shared/types'
import {
  createGitCommandRunner,
  createGitMutationRunner,
  readGitRefs,
  readGitTerminalInfoWithRunner,
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

export interface CreatedWorktree {
  /** The directory the thread runs in: the worktree's root, or the folder's own subdirectory in it. */
  directory: string
  worktree: InboxWorktree
}

const defaults: InboxWorktreeDependencies = {
  read: (target, directory) => createGitCommandRunner(targetSession(target, directory), process.platform, directory, 'interactive'),
  mutate: (target, directory) => createGitMutationRunner(targetSession(target, directory), directory),
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
    const terminal = await readGitTerminalInfoWithRunner(run)
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
      const result = await mutate(['worktree', 'add', '--no-track', '-b', branch, '--', root, ref.ref])
      if (result.code === 0) {
        return {
          directory: prefix ? `${root}/${prefix}` : root,
          worktree: { repository: folder.directory, root, branch, base },
        }
      }
      // A clash with an existing branch or folder left nothing of ours behind (and a chosen name that
      // clashes is somebody's own branch, which must stay). Any other failure will fail again, and
      // may have left a partial worktree and the branch we were creating.
      const clash = !result.launchError && /already exists/i.test(result.stderr)
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
    if (threads.some((other) => other.id !== thread.id && other.worktree?.root === worktree.root && sameTarget(other.target, thread.target))) {
      throw new Error('Another thread still uses this worktree.')
    }
    const home = await this.dependencies.home(thread.target)
    const base = `${home.replace(/\/+$/, '')}/${WORKTREES_DIRECTORY}/`
    if (!isPlainAbsolutePath(worktree.root) || !worktree.root.startsWith(base) || !inside(worktree.root, thread.directory)) {
      throw new Error('This worktree is not in MDE’s worktree folder, so MDE will not remove it.')
    }
    const run = this.dependencies.mutate(thread.target, worktree.repository)
    const result = await run(['worktree', 'remove', '--', worktree.root])
    if (result.code === 0) return
    // Already deleted by hand: forget Git's record of it and call it done.
    if (/is not a working tree/i.test(result.stderr)) {
      await run(['worktree', 'prune'])
      return
    }
    throw new Error(`Could not remove the worktree: ${gitMessage(result)}`)
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
