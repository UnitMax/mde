import { execFile } from 'node:child_process'
import type {
  GitChange,
  GitChangeStatus,
  GitDiffResponse,
  GitInfoResponse,
  GitCommit,
  Session
} from '@shared/types'
import { runWsl } from './wsl/distros'

const GIT_HISTORY_LIMIT = 50
const GIT_COMMAND_TIMEOUT_MS = 10_000
const GIT_DIFF_CONTEXT_LINES = 80
const GIT_MAX_BUFFER = 8 * 1024 * 1024
const GIT_EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

export interface GitCommandResult {
  stdout: string
  stderr: string
  code: number
  launchError?: boolean
}

export type GitCommandRunner = (args: string[]) => Promise<GitCommandResult>

function runNativeGit(args: string[], cwd: string): Promise<GitCommandResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd,
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

export function createGitCommandRunner(
  session: Session,
  platform: NodeJS.Platform = process.platform
): GitCommandRunner {
  if (session.kind === 'wsl') {
    if (platform !== 'win32') {
      throw new Error('WSL sessions can only query Git on Windows.')
    }
    if (!session.distro) throw new Error('This WSL session has no distro configured.')

    const distro = session.distro
    return async (args) => {
      const result = await runWsl([
        '-d',
        distro,
        '--cd',
        session.path,
        '--',
        'git',
        ...args
      ])
      return { stdout: result.stdout, stderr: result.stderr, code: result.code }
    }
  }

  return (args) => runNativeGit(args, session.path)
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
