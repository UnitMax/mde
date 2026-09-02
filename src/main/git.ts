import { execFile } from 'node:child_process'
import { posix as posixPath, win32 } from 'node:path'
import type {
  GitChange,
  GitChangeStatus,
  GitDiffResponse,
  GitInfoResponse,
  GitRepository,
  GitRepositorySnapshot,
  GitStatusResponse,
  GitCommit,
  GitWorktreeSnapshot,
  Session
} from '@shared/types'
import { resolveWindowsGitExecutable } from './git-executable'
import { runWslCommand } from './wsl/distros'

const GIT_HISTORY_LIMIT = 50
const GIT_COMMAND_TIMEOUT_MS = 10_000
const GIT_DIFF_CONTEXT_LINES = 80
const GIT_MAX_BUFFER = 8 * 1024 * 1024
const GIT_EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/**
 * A complete working tree carries its own `.git/config`, `.git/hooks`, and
 * `.gitattributes`, and several of those settings name programs Git runs by
 * itself. MDE polls Git automatically, so the user never chose to run them.
 * `core.hooksPath` must be an absolute path that cannot exist: an empty value
 * would make Git look for hooks relative to the untrusted working directory.
 */
const GIT_DISABLED_HOOKS_PATH = '/nonexistent/mde-disabled-git-hooks'

const gitSafetyArgs = [
  '--no-optional-locks',
  '-c',
  'core.fsmonitor=false',
  '-c',
  `core.hooksPath=${GIT_DISABLED_HOOKS_PATH}`,
  '-c',
  'core.askpass=',
  '-c',
  'core.sshCommand=false',
  '-c',
  'credential.helper=',
  '-c',
  'protocol.ext.allow=never'
]

/**
 * Reading attributes from the empty tree instead of the working tree stops an
 * in-tree `.gitattributes` from selecting a `filter`, `textconv`, or diff
 * driver, which Git would otherwise run while diffing. The option needs Git
 * 2.40 and a matching object format, so a repository that rejects it falls
 * back to plain hardening.
 */
const gitAttrSourceArg = `--attr-source=${GIT_EMPTY_TREE}`

const gitEnvironment: NodeJS.ProcessEnv = {
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: ''
}

export interface GitCommandResult {
  stdout: string
  stderr: string
  code: number
  launchError?: boolean
}

export type GitCommandRunner = (args: string[]) => Promise<GitCommandResult>

export type GitTarget = Pick<Session, 'kind' | 'distro' | 'path'>

export interface GitLineChangeCounts {
  additions: number
  deletions: number
}

function runNativeGit(file: string, args: string[], cwd: string): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        cwd,
        env: { ...process.env, ...gitEnvironment },
        encoding: 'utf8',
        timeout: GIT_COMMAND_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        const result = error as (NodeJS.ErrnoException & { code?: number | string }) | null
        resolve({
          stdout: String(stdout),
          stderr: String(stderr),
          code: typeof result?.code === 'number' ? result.code : result ? 1 : 0,
          ...(result && typeof result.code !== 'number' ? { launchError: true } : {})
        })
      }
    )
  })
}

async function runWindowsGit(args: string[], workspaceDirectory: string): Promise<GitCommandResult> {
  try {
    const executable = await resolveWindowsGitExecutable(workspaceDirectory)
    return runNativeGit(
      executable,
      ['-C', workspaceDirectory, ...args],
      win32.dirname(executable)
    )
  } catch {
    return { stdout: '', stderr: '', code: 1, launchError: true }
  }
}

function createTransportRunner(
  target: GitTarget,
  platform: NodeJS.Platform
): GitCommandRunner {
  if (target.kind === 'wsl') {
    if (platform !== 'win32') {
      throw new Error('WSL sessions can only query Git on Windows.')
    }
    if (!target.distro) throw new Error('This WSL Git target has no distro configured.')

    const distro = target.distro
    return async (args) => {
      const result = await runWslCommand(distro, ['git', ...args], { cwd: target.path })
      return { stdout: result.stdout, stderr: result.stderr, code: result.code }
    }
  }

  if (platform === 'win32') return (args) => runWindowsGit(args, target.path)
  return (args) => runNativeGit('git', args, target.path)
}

/**
 * Git installations older than 2.40, and repositories whose object format the
 * hardcoded empty tree does not match, reject `--attr-source`.
 */
function rejectsAttrSource(result: GitCommandResult): boolean {
  return result.code !== 0 && !result.launchError && /attr-source/i.test(result.stderr)
}

const attrSourceUnsupported = new Set<string>()

function attrSourceKey(target: GitTarget): string {
  return `${target.kind}:${target.distro ?? ''}:${target.path}`
}

/**
 * Wraps a transport so every Git call carries the safety options. Hardening
 * lives here rather than at the call sites so no query can omit it.
 */
export function createGitCommandRunner(
  target: GitTarget,
  platform: NodeJS.Platform = process.platform
): GitCommandRunner {
  const run = createTransportRunner(target, platform)
  const key = attrSourceKey(target)

  return async (args) => {
    const hardened = [...gitSafetyArgs, ...args]
    if (attrSourceUnsupported.has(key)) return run(hardened)

    const result = await run([gitAttrSourceArg, ...hardened])
    if (!rejectsAttrSource(result)) return result

    attrSourceUnsupported.add(key)
    return run(hardened)
  }
}

function isNotRepository(result: GitCommandResult): boolean {
  return /not a git repository|not a repository/i.test(result.stderr)
}

function commandError(command: string, result: GitCommandResult): Error {
  if (result.launchError) return new Error(`Could not run Git ${command}.`)
  return new Error(`Could not read Git ${command}.`)
}

function isMissingHead(result: GitCommandResult): boolean {
  return /needed a single revision|ambiguous argument ['"]?HEAD/i.test(result.stderr)
}

export function isBinaryGitDiff(diff: string): boolean {
  return diff.split(/\r?\n/).some((line) =>
    /^Binary files .* differ$/.test(line) || line === 'GIT binary patch'
  )
}

/** Parses the ahead count from a porcelain-v2 branch header. */
export function parseGitAheadCount(output: string): number | null {
  return parseGitAheadBehind(output)?.ahead ?? null
}

export function parseGitBehindCount(output: string): number | null {
  return parseGitAheadBehind(output)?.behind ?? null
}

function parseGitAheadBehind(output: string): { ahead: number; behind: number } | null {
  for (const field of output.split('\u0000')) {
    const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(field.trim())
    if (!match?.[1] || !match[2]) continue
    const ahead = Number(match[1])
    const behind = Number(match[2])
    if (Number.isSafeInteger(ahead) && Number.isSafeInteger(behind)) return { ahead, behind }
  }
  return null
}

/** Parses NUL-delimited `git diff --numstat` records, ignoring binary files. */
export function parseGitNumstat(output: string): GitLineChangeCounts {
  let additions = 0
  let deletions = 0

  for (const record of output.split('\u0000')) {
    const match = /^(\d+|-)\t(\d+|-)\t/.exec(record)
    if (!match) continue
    if (match[1] !== '-') additions += Number(match[1])
    if (match[2] !== '-') deletions += Number(match[2])
  }

  return { additions, deletions }
}

function hasGitStatus(code: string | undefined): boolean {
  return code !== undefined && code !== ' ' && code !== '.' && code !== '?' && code !== '!'
}

function statusFromPorcelain(recordType: string, xy: string): GitChangeStatus {
  if (recordType === '?') return 'untracked'
  if (recordType === 'u' || xy.includes('U')) return 'unmerged'
  if (xy.includes('R')) return 'renamed'
  if (xy.includes('C')) return 'copied'
  if (xy.includes('D')) return 'deleted'
  if (xy.includes('A')) return 'added'
  if (xy.includes('T')) return 'type-changed'
  return 'modified'
}

function parseStatusRecord(
  record: string,
  fields: string[],
  fieldIndex: number
): { change: GitChange; nextFieldIndex: number } {
  const recordType = record[0]
  if (recordType === '?') {
    const path = record.slice(2)
    if (!path) throw new Error('Git returned malformed change status.')
    return {
      change: {
        path,
        oldPath: null,
        status: 'untracked',
        staged: false,
        unstaged: true
      },
      nextFieldIndex: fieldIndex
    }
  }

  if (recordType !== '1' && recordType !== '2' && recordType !== 'u') {
    throw new Error('Git returned malformed change status.')
  }

  const parts = record.split(' ')
  const xy = parts[1]
  const pathStart = recordType === '1' ? 8 : recordType === '2' ? 9 : 10
  const path = parts.slice(pathStart).join(' ')
  if (!xy || !path) throw new Error('Git returned malformed change status.')

  const indexStatus = xy[0]
  const worktreeStatus = xy[1]
  const oldPath = recordType === '2' ? fields[fieldIndex] : undefined
  if (recordType === '2' && !oldPath) throw new Error('Git returned malformed change status.')

  return {
    change: {
      path,
      oldPath: oldPath ?? null,
      status: statusFromPorcelain(recordType, xy),
      staged: hasGitStatus(indexStatus),
      unstaged: hasGitStatus(worktreeStatus)
    },
    nextFieldIndex: recordType === '2' ? fieldIndex + 1 : fieldIndex
  }
}

/** Parses NUL-delimited Git porcelain v2 records. */
export function parseGitStatus(output: string): GitChange[] {
  const fields = output.split('\u0000')
  if (fields.at(-1) === '') fields.pop()

  const changes: GitChange[] = []
  let fieldIndex = 0
  while (fieldIndex < fields.length) {
    const record = fields[fieldIndex]
    if (!record) {
      fieldIndex += 1
      continue
    }
    if (record.startsWith('# ')) {
      fieldIndex += 1
      continue
    }
    const parsed = parseStatusRecord(record, fields, fieldIndex + 1)
    changes.push(parsed.change)
    fieldIndex = parsed.nextFieldIndex
  }
  return changes
}

const gitStatusArgs = [
  '--no-pager',
  'status',
  '--porcelain=v2',
  '-z',
  '--untracked-files=all',
  '--find-renames'
]

const gitStatusSummaryArgs = [
  '--no-pager',
  'status',
  '--porcelain=v2',
  '--branch',
  '-z',
  '--untracked-files=no'
]

const gitWorktreeListArgs = [
  '--no-pager',
  'worktree',
  'list',
  '--porcelain',
  '-z'
]

export interface GitWorktreeEntry {
  path: string
  branch: string | null
  head: string | null
  primary: boolean
  prunable: boolean
}

/** Parses NUL-delimited `git worktree list --porcelain` records. */
export function parseGitWorktreeList(output: string): GitWorktreeEntry[] {
  const entries: Array<Omit<GitWorktreeEntry, 'primary'>> = []
  let current: Omit<GitWorktreeEntry, 'primary'> | null = null

  const finishCurrent = (): void => {
    if (current?.path) entries.push(current)
    current = null
  }

  for (const field of output.split('\u0000')) {
    // With `-z`, every porcelain field is NUL terminated and an additional
    // empty field separates worktrees. A new worktree also safely closes a
    // malformed record that omitted that separator.
    if (!field) {
      finishCurrent()
      continue
    }
    if (field.startsWith('worktree ')) {
      finishCurrent()
      const path = field.slice('worktree '.length)
      if (path) current = { path, branch: null, head: null, prunable: false }
      continue
    }
    if (!current) continue
    if (field.startsWith('HEAD ')) {
      current.head = field.slice('HEAD '.length) || null
    } else if (field.startsWith('branch ')) {
      current.branch = field.slice('branch '.length).replace(/^refs\/heads\//, '') || null
    } else if (field.startsWith('prunable')) {
      current.prunable = true
    }
  }
  finishCurrent()

  return entries.map((entry, index) => ({ ...entry, primary: index === 0 }))
}

export async function readGitWorktreesWithRunner(run: GitCommandRunner): Promise<GitWorktreeEntry[]> {
  const result = await run(gitWorktreeListArgs)
  if (result.code !== 0) throw commandError('worktrees', result)
  const entries = parseGitWorktreeList(result.stdout)
  if (entries.length === 0) throw new Error('Git repository has no working trees.')
  return entries
}

function wslPathBasename(path: string): string {
  const value = path.replace(/\/+$/, '')
  return posixPath.basename(value) || value || 'Repository'
}

function failedRepositorySnapshot(repository: GitRepository, error: unknown): GitRepositorySnapshot {
  return {
    id: repository.id,
    name: wslPathBasename(repository.path),
    rootPath: repository.path,
    distro: repository.distro,
    worktrees: [],
    error: error instanceof Error ? error.message : 'Could not inspect this Git repository.'
  }
}

export async function readGitRepositorySnapshot(
  repository: GitRepository,
  platform: NodeJS.Platform = process.platform
): Promise<GitRepositorySnapshot> {
  const target = repository
  const entries = await readGitWorktreesWithRunner(createGitCommandRunner(target, platform))
  const primary = entries.find((entry) => entry.primary) ?? entries[0]
  if (!primary) throw new Error('Git repository has no working trees.')

  const worktrees = await Promise.all(entries.map(async (entry): Promise<GitWorktreeSnapshot> => {
    if (entry.prunable) {
      return { ...entry, status: null, error: 'Worktree is prunable.' }
    }

    try {
      const status = await readGitStatusWithRunner(
        createGitCommandRunner({ ...target, path: entry.path }, platform)
      )
      if (!status.repository) {
        return { ...entry, status: null, error: 'This worktree is no longer a Git repository.' }
      }
      return { ...entry, status, error: null }
    } catch (error) {
      return {
        ...entry,
        status: null,
        error: error instanceof Error ? error.message : 'Could not read worktree status.'
      }
    }
  }))

  return {
    id: repository.id,
    name: wslPathBasename(primary.path),
    rootPath: primary.path,
    distro: repository.distro,
    worktrees,
    error: null
  }
}

export async function listGitRepositorySnapshots(
  repositories: readonly GitRepository[],
  platform: NodeJS.Platform = process.platform
): Promise<GitRepositorySnapshot[]> {
  return Promise.all(repositories.map(async (repository) => {
    try {
      return await readGitRepositorySnapshot(repository, platform)
    } catch (error) {
      return failedRepositorySnapshot(repository, error)
    }
  }))
}

async function ensureRepository(run: GitCommandRunner): Promise<boolean> {
  const repository = await run(['--no-pager', 'rev-parse', '--is-inside-work-tree'])
  if (repository.launchError) throw commandError('repository', repository)
  if (repository.code !== 0) {
    if (isNotRepository(repository)) return false
    throw commandError('repository', repository)
  }
  return true
}

async function readGitChangesAfterRepository(run: GitCommandRunner): Promise<GitChange[]> {
  const status = await run(gitStatusArgs)
  if (status.code !== 0) throw commandError('status', status)
  return parseGitStatus(status.stdout)
}

/** Parses NUL-delimited `%H`, `%s`, `%an`, `%cI` records from `git log`. */
export function parseGitLog(output: string): GitCommit[] {
  const fields = output.split('\u0000')
  if (fields.at(-1) === '') fields.pop()
  if (fields.length === 0) return []
  if (fields.length % 4 !== 0) throw new Error('Git returned malformed commit history.')

  const commits: GitCommit[] = []
  for (let index = 0; index < fields.length; index += 4) {
    const hash = fields[index]?.trim()
    const message = fields[index + 1]
    const author = fields[index + 2]?.trim()
    const timestamp = fields[index + 3]?.trim()
    if (!hash || message === undefined || !author || !timestamp) {
      throw new Error('Git returned malformed commit history.')
    }
    commits.push({ hash, message, author, timestamp })
  }
  return commits
}

export async function readGitInfoWithRunner(run: GitCommandRunner): Promise<GitInfoResponse> {
  const repository = await ensureRepository(run)
  if (!repository) return { repository: false, branch: null, commits: [], changes: [] }

  const [branch, history, status] = await Promise.all([
    run(['--no-pager', 'branch', '--show-current']),
    run([
      '--no-pager',
      'log',
      '-z',
      '--max-count',
      String(GIT_HISTORY_LIMIT),
      '--format=%H%x00%s%x00%an%x00%cI'
    ]),
    run(gitStatusArgs)
  ])

  if (branch.code !== 0) throw commandError('branch', branch)
  if (history.code !== 0) throw commandError('history', history)
  if (status.code !== 0) throw commandError('status', status)

  return {
    repository: true,
    branch: branch.stdout.trim() || null,
    commits: parseGitLog(history.stdout),
    changes: parseGitStatus(status.stdout)
  }
}

export function readGitInfo(session: Session): Promise<GitInfoResponse> {
  return readGitInfoWithRunner(createGitCommandRunner(session))
}

export async function readGitStatusWithRunner(run: GitCommandRunner): Promise<GitStatusResponse> {
  const repository = await ensureRepository(run)
  if (!repository) {
    return {
      repository: false,
      branch: null,
      additions: 0,
      deletions: 0,
      commitsAhead: null,
      commitsBehind: null
    }
  }

  const [branch, head, status] = await Promise.all([
    run(['--no-pager', 'branch', '--show-current']),
    run(['--no-pager', 'rev-parse', '--verify', 'HEAD']),
    run(gitStatusSummaryArgs)
  ])

  if (branch.code !== 0) throw commandError('branch', branch)
  if (head.launchError) throw commandError('HEAD', head)
  if (head.code !== 0 && !isMissingHead(head)) throw commandError('HEAD', head)
  if (status.code !== 0) throw commandError('status', status)

  const baseline = head.code === 0 ? 'HEAD' : GIT_EMPTY_TREE
  const diff = await run([
    '--no-pager',
    'diff',
    '--numstat',
    '--no-ext-diff',
    '--no-textconv',
    '--no-color',
    '--find-renames',
    '-z',
    baseline,
    '--'
  ])
  if (diff.code !== 0) throw commandError('diff', diff)

  const counts = parseGitNumstat(diff.stdout)
  return {
    repository: true,
    branch: branch.stdout.trim() || null,
    ...counts,
    commitsAhead: parseGitAheadCount(status.stdout),
    commitsBehind: parseGitBehindCount(status.stdout)
  }
}

export function readGitStatus(session: Session): Promise<GitStatusResponse> {
  return readGitStatusWithRunner(createGitCommandRunner(session))
}

export async function readGitDiffWithRunner(
  run: GitCommandRunner,
  path: string,
  nullDevice = '/dev/null'
): Promise<GitDiffResponse> {
  if (!path) throw new Error('Invalid Git diff path.')
  if (!(await ensureRepository(run))) throw new Error('This session folder is not a Git repository.')

  const changes = await readGitChangesAfterRepository(run)
  const change = changes.find((entry) => entry.path === path)
  if (!change) throw new Error('The selected Git change is no longer available.')

  const head = await run(['--no-pager', 'rev-parse', '--verify', 'HEAD'])
  if (head.launchError) throw commandError('HEAD', head)
  if (head.code !== 0 && !isMissingHead(head)) throw commandError('HEAD', head)
  const baseline = head.code === 0 ? 'HEAD' : GIT_EMPTY_TREE

  const paths = [change.path, ...(change.oldPath ? [change.oldPath] : [])]
  const args = change.status === 'untracked'
    ? [
        '--no-pager',
        'diff',
        '--no-index',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        `--unified=${GIT_DIFF_CONTEXT_LINES}`,
        '--',
        nullDevice,
        change.path
      ]
    : [
        '--no-pager',
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        '--find-renames',
        '--find-copies',
        `--unified=${GIT_DIFF_CONTEXT_LINES}`,
        baseline,
        '--',
        ...paths
      ]
  const result = await run(args)
  const expectedNoIndexDifference = change.status === 'untracked' && result.code === 1
  if (result.code !== 0 && !expectedNoIndexDifference) throw commandError('diff', result)

  return {
    path: change.path,
    diff: result.stdout,
    binary: isBinaryGitDiff(result.stdout)
  }
}

export function readGitDiff(session: Session, path: string): Promise<GitDiffResponse> {
  const nullDevice = session.kind === 'wsl' || process.platform !== 'win32' ? '/dev/null' : 'NUL'
  return readGitDiffWithRunner(createGitCommandRunner(session), path, nullDevice)
}
