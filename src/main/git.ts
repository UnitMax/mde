import { execFile } from 'node:child_process'
import type { GitInfoResponse, GitCommit, Session } from '@shared/types'
import { runWsl } from './wsl/distros'

const GIT_HISTORY_LIMIT = 50
const GIT_COMMAND_TIMEOUT_MS = 10_000

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

/** Parses NUL-delimited `%H`, `%s`, `%cI` records from `git log`. */
export function parseGitLog(output: string): GitCommit[] {
  const fields = output.split('\u0000')
  if (fields.at(-1) === '') fields.pop()
  if (fields.length === 0) return []
  if (fields.length % 3 !== 0) throw new Error('Git returned malformed commit history.')

  const commits: GitCommit[] = []
  for (let index = 0; index < fields.length; index += 3) {
    const hash = fields[index]?.trim()
    const message = fields[index + 1]
    const timestamp = fields[index + 2]?.trim()
    if (!hash || message === undefined || !timestamp) {
      throw new Error('Git returned malformed commit history.')
    }
    commits.push({ hash, message, timestamp })
  }
  return commits
}

export async function readGitInfoWithRunner(run: GitCommandRunner): Promise<GitInfoResponse> {
  const repository = await run(['--no-pager', 'rev-parse', '--is-inside-work-tree'])
  if (repository.launchError) throw commandError('repository', repository)
  if (repository.code !== 0) {
    if (isNotRepository(repository)) {
      return { repository: false, branch: null, commits: [] }
    }
    throw commandError('repository', repository)
  }

  const [branch, history] = await Promise.all([
    run(['--no-pager', 'branch', '--show-current']),
    run([
      '--no-pager',
      'log',
      '-z',
      '--max-count',
      String(GIT_HISTORY_LIMIT),
      '--format=%H%x00%s%x00%cI'
    ])
  ])

  if (branch.code !== 0) throw commandError('branch', branch)
  if (history.code !== 0) throw commandError('history', history)

  return {
    repository: true,
    branch: branch.stdout.trim() || null,
    commits: parseGitLog(history.stdout)
  }
}

export function readGitInfo(session: Session): Promise<GitInfoResponse> {
  return readGitInfoWithRunner(createGitCommandRunner(session))
}
