import { execFile } from './exec-host'
import { win32 } from 'node:path'
import type {
  InboxChangesResponse,
  InboxChangeDiff,
  GitChangeStatus,
  GitDiffResponse,
  GitStatusResponse,
  GitTerminalInfoResponse,
  DirectoryContext,
  Session
} from '@shared/types'
import { resolveWindowsGitExecutable } from './git-executable'
import { createSpawnLimiter, type SpawnPriority } from './spawn-limiter'
import { runWslCommand } from './wsl/distros'
import { gitFilterSafetyArgs } from './git-filters'
import { randomBytes } from 'node:crypto'
import {
  commandLineLength, fillGitBatchCommand, GIT_BATCH_BASE, GIT_BATCH_FILTERS_TOO_MANY, GIT_BATCH_SCRIPT, gitBatchArguments,
  parseGitBatchOutput, usesGitBatchHead, type GitBatchCommand,
} from './git-batch'

const GIT_COMMAND_TIMEOUT_MS = 10_000
/** A checkout writes a whole working tree, so it gets far longer than a status query. */
const GIT_MUTATION_TIMEOUT_MS = 120_000
const GIT_REF_LIMIT = 300
export const GIT_DIFF_CONTEXT_LINES = 80
const GIT_MAX_BUFFER = 8 * 1024 * 1024
const GIT_EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/**
 * Git processes allowed at once across terminal headers and Inbox changes. Background
 * refreshes yield to requests the user makes, such as opening an Inbox diff.
 */
const GIT_SPAWN_LIMIT = 3
const gitSpawns = createSpawnLimiter(GIT_SPAWN_LIMIT)

/**
 * A complete working tree carries its own `.git/config`, `.git/hooks`, and
 * `.gitattributes`, and several of those settings name programs Git runs by
 * itself. MDE polls Git automatically, so the user never chose to run them.
 * `core.hooksPath` must be an absolute path that cannot exist: an empty value
 * would make Git look for hooks relative to the untrusted working directory.
 */
const GIT_DISABLED_HOOKS_PATH = '/nonexistent/mde-disabled-git-hooks'

const gitSafetyArgs = [
  '--no-pager',
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
  'protocol.allow=never',
  '-c',
  'protocol.ext.allow=never',
  '-c',
  'submodule.recurse=false',
  '-c',
  'diff.ignoreSubmodules=all',
  '-c',
  'diff.submodule=short',
  '-c',
  'status.submoduleSummary=false',
  '-c',
  'maintenance.auto=false',
  '-c',
  'gc.auto=0',
]

const gitEnvironment = {
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
  GIT_NO_LAZY_FETCH: '1',
  // An empty allowlist overrides even protocol.<name>.allow=always and
  // prevents arbitrary remote helpers on Git versions predating no-lazy-fetch.
  GIT_ALLOW_PROTOCOL: '',
  GIT_PROTOCOL_FROM_USER: '0',
  LC_ALL: 'C',
}

export interface GitCommandResult {
  stdout: string
  stderr: string
  code: number
  launchError?: boolean
}

/** The frames of one batched reading of a checkout; see `git-batch.ts`. */
export interface GitBatchFrames {
  root: GitCommandResult
  head: GitCommandResult | null
  /** The filter probe: exit code 0 when every filter driver could be switched off. */
  filters: GitCommandResult | null
  results: GitCommandResult[]
}

export interface GitCommandRunner {
  (args: string[]): Promise<GitCommandResult>
  /**
   * Runs the commands of one reading in a single process, where starting a process is what costs
   * (WSL). Absent elsewhere; `runGitCheckoutBatch` then runs the same commands one by one.
   */
  batch?: (commands: string[][], wantHead: boolean) => Promise<GitBatchFrames>
}

export interface GitLineChangeCounts {
  additions: number
  deletions: number
}

function runNativeGit(
  file: string,
  args: string[],
  cwd: string,
  timeoutMs = GIT_COMMAND_TIMEOUT_MS,
  policy: Record<string, string> = gitEnvironment
): Promise<GitCommandResult> {
  const environment: NodeJS.ProcessEnv = { ...process.env }
  // GIT_CONFIG only affects `git config`: inheriting it would make the filter
  // probe inspect another file while the subsequent operation reads the repo.
  const replaced = new Set(['GIT_CONFIG', ...Object.keys(policy)].map((key) => key.toUpperCase()))
  for (const key of Object.keys(environment)) {
    if (replaced.has(key.toUpperCase())) delete environment[key]
  }
  Object.assign(environment, policy)
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        cwd,
        env: environment,
        encoding: 'utf8',
        timeout: timeoutMs,
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

async function runWindowsGit(
  args: string[],
  workspaceDirectory: string,
  timeoutMs?: number,
  policy?: Record<string, string>
): Promise<GitCommandResult> {
  try {
    const executable = await resolveWindowsGitExecutable(workspaceDirectory)
    return runNativeGit(
      executable,
      ['-C', workspaceDirectory, ...args],
      win32.dirname(executable),
      timeoutMs,
      policy
    )
  } catch {
    return { stdout: '', stderr: '', code: 1, launchError: true }
  }
}

function createTransportRunner(
  session: DirectoryContext,
  workspaceDirectory: string,
  platform: NodeJS.Platform,
  timeoutMs?: number,
  policy: Record<string, string> = gitEnvironment
): GitCommandRunner {
  if (session.kind === 'wsl') {
    if (platform !== 'win32') {
      throw new Error('WSL sessions can only query Git on Windows.')
    }
    if (!session.distro) throw new Error('This WSL session has no distro configured.')

    const distro = session.distro
    return async (args) => {
      // Host env overrides are not automatically inherited inside WSL. Apply
      // this policy distro-side with direct argv, without a login shell.
      const result = await runWslCommand(distro, [
        '/usr/bin/env',
        '-u', 'GIT_CONFIG',
        ...Object.entries(policy).map(([key, value]) => `${key}=${value}`),
        'git',
        ...args,
      ], {
        cwd: workspaceDirectory,
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      })
      return { stdout: result.stdout, stderr: result.stderr, code: result.code }
    }
  }

  if (platform === 'win32') return (args) => runWindowsGit(args, workspaceDirectory, timeoutMs, policy)
  return (args) => runNativeGit('git', args, workspaceDirectory, timeoutMs, policy)
}

function createSafeGitRunner(
  transport: GitCommandRunner,
  priority: SpawnPriority,
): GitCommandRunner {
  const run: GitCommandRunner = (args) => gitSpawns.run(priority, () => transport([...gitSafetyArgs, ...args]))
  return async (args) => {
    const filters = await gitFilterSafetyArgs(run, args)
    const result = await run([...filters, ...args])
    if (filters.length && result.code !== 0 && /(?:clean|smudge) filter .* failed/.test(result.stderr)) {
      const worktree = args.indexOf('worktree')
      return {
        ...result,
        stderr: worktree >= 0 && args[worktree + 1] === 'remove'
          ? 'This worktree needs Git filters. Remove it in a terminal, then remove its Inbox entry.'
          : 'This checkout needs Git filters. Create the worktree in a terminal, then add its folder to the Inbox.',
      }
    }
    return result
  }
}

/**
 * Wraps a transport so every Git call carries the safety options. Hardening
 * lives here rather than at the call sites so no query can omit it. Calls share
 * one bounded pool of process slots; `background` polling yields to `interactive`
 * requests such as opening an Inbox diff.
 */
export function createGitCommandRunner(
  session: DirectoryContext,
  platform: NodeJS.Platform = process.platform,
  workspaceDirectory = session.path,
  priority: SpawnPriority = 'interactive'
): GitCommandRunner {
  const run = createSafeGitRunner(createTransportRunner(session, workspaceDirectory, platform), priority)
  if (session.kind === 'wsl' && session.distro) run.batch = createWslBatchRunner(session.distro, workspaceDirectory, priority)
  return run
}

/** Room for the commands of one batch on a Windows command line, which holds 32,767 characters. */
const WSL_BATCH_COMMAND_LINE = 30_000
const failedToRun: GitCommandResult = { stdout: '', stderr: '', code: 1, launchError: true }

/** `status` and `diff` convert file contents, so they run with the filter drivers switched off (`git-filters.ts`). */
function batchCommand(args: string[]): GitBatchCommand {
  const name = args.find((arg) => !arg.startsWith('-'))
  return { args, converts: name === 'status' || name === 'diff' }
}

/**
 * One `wsl.exe` for a whole reading: the commands run inside the distro by the script in
 * `git-batch.ts`, with the same safety options and environment as a single command. Commands that
 * would not fit on one command line are spread over as many round trips as it takes.
 */
function createWslBatchRunner(
  distro: string,
  workspaceDirectory: string,
  priority: SpawnPriority,
): NonNullable<GitCommandRunner['batch']> {
  const environment = ['/usr/bin/env', '-u', 'GIT_CONFIG', ...Object.entries(gitEnvironment).map(([key, value]) => `${key}=${value}`)]
  const roundTrip = async (commands: GitBatchCommand[], wantHead: boolean): Promise<GitBatchFrames> => {
    const boundary = randomBytes(16).toString('hex')
    const wantFilters = commands.some((command) => command.converts)
    const result = await gitSpawns.run(priority, () => runWslCommand(distro, [
      ...environment, 'bash', '-c', GIT_BATCH_SCRIPT,
      ...gitBatchArguments(boundary, GIT_EMPTY_TREE, gitSafetyArgs, wantHead, commands),
    ], { cwd: workspaceDirectory, maxBuffer: GIT_MAX_BUFFER * 2 }))
    const frames = parseGitBatchOutput(boundary, result.stdout, result.stderr)
    // A frame that is missing belongs to a step that did not run: the batch stopped, or was cut off.
    const next = (): GitCommandResult => frames.shift() ?? failedToRun
    return {
      root: next(),
      head: wantHead ? next() : null,
      filters: wantFilters ? next() : null,
      results: commands.map(next),
    }
  }
  return async (commands, wantHead) => {
    const fixed = commandLineLength([...environment, GIT_BATCH_SCRIPT, ...gitSafetyArgs, workspaceDirectory]) + 400
    const groups: GitBatchCommand[][] = [[]]
    let length = fixed
    for (const command of commands.map(batchCommand)) {
      const size = commandLineLength(command.args) + 10
      if (groups.at(-1)!.length && length + size > WSL_BATCH_COMMAND_LINE) {
        groups.push([])
        length = fixed
      }
      groups.at(-1)!.push(command)
      length += size
    }
    let first: GitBatchFrames | null = null
    const results: GitCommandResult[] = []
    for (const group of groups) {
      const frames = await roundTrip(group, wantHead)
      first ??= frames
      const stopped = frames.root.code !== 0 || (frames.filters !== null && frames.filters.code !== 0)
      // The steps before the commands are reported once; a later round trip they fail in ran nothing.
      results.push(...(stopped && frames !== first ? group.map(() => failedToRun) : frames.results))
      if (frames === first && stopped) break
    }
    return { ...first!, results }
  }
}

/** The steps every reading of a checkout starts with, and the results of its commands. */
export interface GitCheckoutBatch {
  /** The top folder of the checkout; the commands ran there. */
  root: string
  /** The commit `HEAD` names, when a command asked for it (`GIT_BATCH_BASE`, `GIT_BATCH_HEAD`) and there is one. */
  head: string | null
  results: GitCommandResult[]
}

const checkoutRootArgs = ['--no-pager', 'rev-parse', '--is-inside-work-tree', '--show-toplevel']

/** The checkout root from `rev-parse --is-inside-work-tree --show-toplevel`; null outside a repository. */
function checkoutRoot(result: GitCommandResult): string | null {
  if (result.launchError) throw commandError('repository', result)
  if (result.code !== 0) {
    if (isNotRepository(result)) return null
    throw commandError('repository', result)
  }
  const line = result.stdout.indexOf('\n')
  const root = line < 0 ? '' : result.stdout.slice(line + 1).trim()
  if (!root) throw commandError('worktree', result)
  return root
}

/**
 * Reads a checkout: finds its top folder, then runs the commands there, with literal pathspecs. A
 * command may name `GIT_BATCH_BASE` or `GIT_BATCH_HEAD` where the answer depends on whether the
 * repository has a commit yet. Null outside a repository.
 *
 * In WSL all of it is one round trip. Elsewhere the same steps run as separate processes, the
 * commands side by side.
 */
export async function runGitCheckoutBatch(run: GitCommandRunner, commands: string[][]): Promise<GitCheckoutBatch | null> {
  const wantHead = commands.some(usesGitBatchHead)
  const headOf = (result: GitCommandResult | null): string | null => {
    if (!result) return null
    if (result.launchError || (result.code !== 0 && !isMissingHead(result))) throw commandError('HEAD', result)
    return result.code === 0 ? result.stdout.trim() || null : null
  }
  if (run.batch) {
    const frames = await run.batch(commands, wantHead)
    const root = checkoutRoot(frames.root)
    if (!root) return null
    const head = headOf(frames.head)
    if (frames.filters && frames.filters.code !== 0) {
      throw new Error(frames.filters.code === GIT_BATCH_FILTERS_TOO_MANY
        ? 'Too many Git filters to inspect safely.'
        : 'Could not inspect Git filters safely.')
    }
    return { root, head, results: frames.results }
  }
  const root = checkoutRoot(await run(checkoutRootArgs))
  if (!root) return null
  const rooted: GitCommandRunner = (args) => run(['--literal-pathspecs', '-C', root, ...args])
  const head = headOf(wantHead ? await rooted(['--no-pager', 'rev-parse', '--verify', 'HEAD']) : null)
  const results = await Promise.all(commands.map((args) => rooted(fillGitBatchCommand(args, head !== null, GIT_EMPTY_TREE))))
  return { root, head, results }
}

/**
 * A runner for the few commands that change a repository, such as creating or removing a worktree.
 * It keeps every safety option and native attribute conversions (text/eol/ident),
 * but refuses a checkout/removal that needs an external filter. No helper or
 * remote fetch is permitted, even when Git configuration explicitly allows it.
 * The timeout is long because a checkout writes a whole working tree.
 */
export function createGitMutationRunner(
  session: DirectoryContext,
  workspaceDirectory = session.path,
  timeoutMs = GIT_MUTATION_TIMEOUT_MS,
  platform: NodeJS.Platform = process.platform
): GitCommandRunner {
  const transport = createTransportRunner(session, workspaceDirectory, platform, timeoutMs)
  return createSafeGitRunner(transport, 'interactive')
}

/**
 * The protocols a fetch the person asked for may use. `ext::` and other remote helpers stay
 * denied, so a remote URL cannot name a program to run.
 */
export const GIT_FETCH_PROTOCOLS = 'file:git:http:https:ssh'
const GIT_FETCH_TIMEOUT_MS = 120_000

const gitFetchEnvironment = {
  ...gitEnvironment,
  GIT_ALLOW_PROTOCOL: GIT_FETCH_PROTOCOLS,
}

/**
 * The options every fetch carries. They match the ordinary safety options except that the
 * network is allowed, along with the person's own credential helper and SSH command. Hooks,
 * fsmonitor, submodules and automatic maintenance stay off.
 */
const gitFetchSafetyArgs = [
  '--no-pager',
  '--no-optional-locks',
  '-c',
  'core.fsmonitor=false',
  '-c',
  `core.hooksPath=${GIT_DISABLED_HOOKS_PATH}`,
  '-c',
  'core.askpass=',
  '-c',
  'submodule.recurse=false',
  '-c',
  'fetch.recurseSubmodules=false',
  '-c',
  'maintenance.auto=false',
  '-c',
  'gc.auto=0',
]

/**
 * Settings that make Git run a program during a fetch. They are honored only from the person's
 * own (global or system) configuration: a repository can be someone else's, so its own
 * configuration must not choose a program for MDE to start.
 */
const FETCH_PROGRAM_KEYS: Array<[RegExp, string]> = [
  [/^credential\.(?:.+\.)?helper$/, 'credential.helper'],
  [/^core\.sshcommand$/, 'core.sshCommand'],
  [/^core\.gitproxy$/, 'core.gitProxy'],
  // Run through the shell when the repository borrows objects from another (`objects/info/alternates`).
  [/^core\.alternaterefscommand$/, 'core.alternateRefsCommand'],
  [/^remote\..+\.uploadpack$/, 'remote.<name>.uploadpack'],
  [/^remote\..+\.receivepack$/, 'remote.<name>.receivepack'],
  [/^remote\..+\.vcs$/, 'remote.<name>.vcs'],
]

/**
 * Parses `git config --list --show-scope -z` output and names the program-choosing settings that
 * come from the repository itself (its own configuration, files it includes, or a worktree's).
 */
export function repositoryFetchPrograms(stdout: string): string[] {
  const found = new Set<string>()
  const fields = stdout.split('\0')
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const scope = fields[index]!
    if (scope !== 'local' && scope !== 'worktree') continue
    const key = (fields[index + 1]!.split('\n', 1)[0] ?? '').toLowerCase()
    const match = FETCH_PROGRAM_KEYS.find(([pattern]) => pattern.test(key))
    if (match) found.add(match[1])
  }
  return [...found]
}

/**
 * A runner for `git fetch`, the one Git command MDE lets reach the network, and only when the
 * person asks for it. It shares the process pool at interactive priority.
 */
export function createGitFetchRunner(
  session: DirectoryContext,
  workspaceDirectory = session.path,
  platform: NodeJS.Platform = process.platform
): GitCommandRunner {
  const transport = createTransportRunner(session, workspaceDirectory, platform, GIT_FETCH_TIMEOUT_MS, gitFetchEnvironment)
  return (args) => gitSpawns.run('interactive', () => transport([...gitFetchSafetyArgs, ...args]))
}

export interface GitRef {
  /** The name to show and to match: `main`, or `origin/main` for a remote-tracking branch. */
  name: string
  remote: boolean
  /** The full refname, which cannot be mistaken for a tag or a path. */
  ref: string
}

/**
 * Parses `for-each-ref --format=%(refname)` output. Local branches come first, then
 * remote-tracking ones, each most recently committed first; a remote's `HEAD` pointer is not a
 * branch.
 */
export function parseGitRefs(stdout: string): GitRef[] {
  const local: GitRef[] = []
  const remote: GitRef[] = []
  for (const line of stdout.split('\n')) {
    const ref = line.trim()
    if (ref.startsWith('refs/heads/') && ref.length > 'refs/heads/'.length) {
      local.push({ name: ref.slice('refs/heads/'.length), remote: false, ref })
    } else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) {
      const name = ref.slice('refs/remotes/'.length)
      if (name.includes('/')) remote.push({ name, remote: true, ref })
    }
  }
  return [...local, ...remote].slice(0, GIT_REF_LIMIT)
}

export async function readGitRefs(run: GitCommandRunner): Promise<GitRef[]> {
  const result = await run([
    '--no-pager',
    'for-each-ref',
    '--format=%(refname)',
    '--sort=-committerdate',
    'refs/heads',
    'refs/remotes'
  ])
  if (result.code !== 0) throw commandError('branches', result)
  return parseGitRefs(result.stdout)
}

/** Metadata only: branch pickers must not scan files or require missing blobs. */
export async function readGitBranchInfoWithRunner(
  run: GitCommandRunner,
): Promise<{ repository: boolean; branch: string | null }> {
  if (!(await ensureRepository(run))) return { repository: false, branch: null }
  const result = await run(['--no-pager', 'symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (result.code === 1 && !result.launchError) return { repository: true, branch: null }
  if (result.code !== 0) throw commandError('branch', result)
  return { repository: true, branch: result.stdout.trim() || null }
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
  for (const field of output.split('\u0000')) {
    const match = /^# branch\.ab \+(\d+) -\d+$/.exec(field.trim())
    if (!match?.[1]) continue
    const ahead = Number(match[1])
    if (Number.isSafeInteger(ahead)) return ahead
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

/** Paths and status needed to summarize changes and read checkout diffs. */
interface GitChange {
  path: string
  oldPath: string | null
  status: GitChangeStatus
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
        status: 'untracked'
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

  const oldPath = recordType === '2' ? fields[fieldIndex] : undefined
  if (recordType === '2' && !oldPath) throw new Error('Git returned malformed change status.')

  return {
    change: {
      path,
      oldPath: oldPath ?? null,
      status: statusFromPorcelain(recordType, xy)
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
  '--untracked-files=normal'
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

const numstatArgs = [
  '--no-pager', 'diff', '--numstat', '--no-ext-diff', '--no-textconv', '--no-color', '--find-renames', '-z',
  GIT_BATCH_BASE, '--',
]

const notRepository = { repository: false, branch: null, additions: 0, deletions: 0, commitsAhead: null, changedFiles: 0 }

async function readCheckoutStatus(
  run: GitCommandRunner
): Promise<(GitStatusResponse & { changedFiles: number; root: string }) | null> {
  const batch = await runGitCheckoutBatch(run, [
    ['--no-pager', 'branch', '--show-current'],
    gitStatusSummaryArgs,
    numstatArgs,
  ])
  if (!batch) return null
  const [branch, status, diff] = batch.results as [GitCommandResult, GitCommandResult, GitCommandResult]
  if (branch.code !== 0) throw commandError('branch', branch)
  if (status.code !== 0) throw commandError('status', status)
  if (diff.code !== 0) throw commandError('diff', diff)
  return {
    repository: true,
    branch: branch.stdout.trim() || null,
    ...parseGitNumstat(diff.stdout),
    commitsAhead: parseGitAheadCount(status.stdout),
    changedFiles: parseGitStatus(status.stdout).length,
    root: batch.root,
  }
}

export async function readGitTerminalInfoWithRunner(
  run: GitCommandRunner
): Promise<Omit<GitTerminalInfoResponse, 'directory'>> {
  const status = await readCheckoutStatus(run)
  if (!status) return { ...notRepository, worktree: null }
  const { root, ...info } = status
  return { ...info, worktree: root }
}

export async function readGitTerminalInfo(
  session: Session,
  directory: string
): Promise<GitTerminalInfoResponse> {
  const info = await readGitTerminalInfoWithRunner(
    createGitCommandRunner({ ...session, path: directory }, process.platform, directory, 'background')
  )
  return { ...info, directory }
}

export async function readGitStatusWithRunner(run: GitCommandRunner): Promise<GitStatusResponse & { changedFiles: number }> {
  const status = await readCheckoutStatus(run)
  if (!status) return { ...notRepository }
  const { root: _root, ...info } = status
  return info
}

/**
 * One file's change in the checkout. The path must be one `git status` lists, so no other file can
 * be asked for. The diff of a tracked file is read along with the status, so the usual case is one
 * reading; an untracked or renamed file takes a second.
 */
export async function readGitDiffWithRunner(
  run: GitCommandRunner,
  path: string,
  nullDevice = '/dev/null'
): Promise<GitDiffResponse> {
  if (!path) throw new Error('Invalid Git diff path.')
  const tracked = (paths: string[]): string[] => [
    '--no-pager', 'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--find-renames', '--find-copies',
    `--unified=${GIT_DIFF_CONTEXT_LINES}`, GIT_BATCH_BASE, '--', ...paths,
  ]
  const first = await runGitCheckoutBatch(run, [gitStatusArgs, tracked([path])])
  if (!first) throw new Error('This folder is not a Git repository.')
  const [status, guess] = first.results as [GitCommandResult, GitCommandResult]
  if (status.code !== 0) throw commandError('status', status)
  const change = parseGitStatus(status.stdout).find((entry) => entry.path === path)
  if (!change) throw new Error('The selected Git change is no longer available.')

  let result = guess
  if (change.status === 'untracked' || change.oldPath) {
    const second = await runGitCheckoutBatch(run, [change.status === 'untracked'
      ? [
          '--no-pager', 'diff', '--no-index', '--no-ext-diff', '--no-textconv', '--no-color',
          `--unified=${GIT_DIFF_CONTEXT_LINES}`, '--', nullDevice, change.path,
        ]
      : tracked([change.path, change.oldPath!])])
    if (!second) throw new Error('This folder is not a Git repository.')
    result = second.results[0]!
  }
  const expectedNoIndexDifference = change.status === 'untracked' && result.code === 1 && !result.launchError
  if (result.code !== 0 && !expectedNoIndexDifference) throw commandError('diff', result)

  return {
    path: change.path,
    diff: result.stdout,
    binary: isBinaryGitDiff(result.stdout)
  }
}

/** Untracked files whose line counts are read; the rest are listed without counts. */
export const INBOX_UNTRACKED_COUNT_LIMIT = 50
export const INBOX_DIFF_PREVIEW_BYTES = 64 * 1024

/** Per-file NUL-delimited numstat, including Git's three-field rename records. */
export function parseGitFileNumstat(output: string): Map<string, GitLineChangeCounts & { binary: boolean }> {
  const fields = output.split('\0')
  const files = new Map<string, GitLineChangeCounts & { binary: boolean }>()
  for (let index = 0; index < fields.length; index += 1) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(fields[index]!)
    if (!match) continue
    let path = match[3]!
    if (!path) {
      index += 2 // Empty path is followed by the old and new names.
      path = fields[index] ?? ''
    }
    if (path) files.set(path, {
      additions: match[1] === '-' ? 0 : Number(match[1]),
      deletions: match[2] === '-' ? 0 : Number(match[2]),
      binary: match[1] === '-' || match[2] === '-'
    })
  }
  return files
}

/** Always run from the checkout root: porcelain paths are relative to that root. */
export async function checkoutRunner(run: GitCommandRunner): Promise<{ root: string; run: GitCommandRunner } | null> {
  const root = checkoutRoot(await run(checkoutRootArgs))
  if (!root) return null
  return { root, run: (args) => run(['--literal-pathspecs', '-C', root, ...args]) }
}

export async function readGitCheckoutChangesWithRunner(
  source: GitCommandRunner,
  nullDevice = '/dev/null'
): Promise<InboxChangesResponse> {
  const batch = await runGitCheckoutBatch(source, [
    ['--no-pager', 'branch', '--show-current'],
    gitStatusArgs,
    numstatArgs,
  ])
  if (!batch) return {
    available: false, reason: 'This folder is not a Git repository.', branch: null, worktree: null,
    additions: 0, deletions: 0, fileCount: 0, files: []
  }
  const [branch, status, stats] = batch.results as [GitCommandResult, GitCommandResult, GitCommandResult]
  if (branch.code !== 0) throw commandError('branch', branch)
  if (status.code !== 0) throw commandError('status', status)
  if (stats.code !== 0) throw commandError('diff', stats)
  const changes = parseGitStatus(status.stdout)
  const counts = parseGitFileNumstat(stats.stdout)
  // Untracked files are absent from `git diff HEAD`, so each one costs a command. A folder full of
  // them (an ignored-by-nobody build directory) must not queue thousands of them on every poll.
  const untracked = changes.filter((change) => change.status === 'untracked')
  const counted = untracked.slice(0, INBOX_UNTRACKED_COUNT_LIMIT).map((change) => change.path)
  const uncounted = untracked.length - counted.length
  if (counted.length) {
    const second = await runGitCheckoutBatch(source, counted.map((path) => [
      '--no-pager', 'diff', '--no-index', '--numstat', '-z', '--no-ext-diff', '--no-textconv',
      '--no-color', '--', nullDevice, path
    ]))
    if (!second) throw new Error('Could not read Git diff.')
    second.results.forEach((diff, index) => {
      if (diff.launchError || (diff.code !== 0 && diff.code !== 1)) throw commandError('diff', diff)
      const numbers = parseGitFileNumstat(diff.stdout).get(counted[index]!)
      if (numbers) counts.set(counted[index]!, numbers)
      else counts.delete(counted[index]!)
    })
  }
  const files = changes.map((change) => ({
    path: change.path, status: change.status, ...(counts.get(change.path) ?? { additions: 0, deletions: 0, binary: false })
  }))
  return {
    available: true,
    branch: branch.stdout.trim() || null,
    worktree: batch.root,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    fileCount: files.length,
    ...(uncounted > 0 ? { uncounted } : {}),
    files
  }
}

export async function readGitCheckoutDiffWithRunner(
  source: GitCommandRunner,
  path: string,
  nullDevice = '/dev/null'
): Promise<InboxChangeDiff> {
  const result = await readGitDiffWithRunner(source, path, nullDevice)
  return { ...result, ...diffPreview(result.diff) }
}

/** A diff cut to the preview size, and whether it was cut. */
export function diffPreview(diff: string): { diff: string; truncated: boolean } {
  const bytes = Buffer.from(diff, 'utf8')
  const truncated = bytes.length > INBOX_DIFF_PREVIEW_BYTES
  // Cutting inside a multi-byte character leaves one replacement character at the end; drop it.
  // A diff that fits is returned as it is.
  return { diff: truncated ? bytes.subarray(0, INBOX_DIFF_PREVIEW_BYTES).toString('utf8').replace(/\ufffd$/, '') : diff, truncated }
}
