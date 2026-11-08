import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGitCommandRunner,
  createGitMutationRunner,
  isBinaryGitDiff,
  parseGitRefs,
  readGitRefs,
  parseGitAheadCount,
  parseGitNumstat,
  parseGitStatus,
  readGitTerminalInfo,
  readGitTerminalInfoWithRunner,
  readGitStatusWithRunner,
  readGitDiffWithRunner,
  type GitCommandResult
} from '../src/main/git'

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  resolveWindowsGitExecutable: vi.fn(),
  runWslCommand: vi.fn()
}))

// Filter discovery is tested against real Git and in git-filters.test.ts.
vi.mock('../src/main/git-filters', () => ({ gitFilterSafetyArgs: async () => [] }))
vi.mock('../src/main/exec-host', () => ({ execFile: mocks.execFile }))
vi.mock('../src/main/git-executable', () => ({
  resolveWindowsGitExecutable: mocks.resolveWindowsGitExecutable
}))
vi.mock('../src/main/wsl/distros', () => ({ runWslCommand: mocks.runWslCommand }))

function result(stdout = '', stderr = '', code = 0): GitCommandResult {
  return { stdout, stderr, code }
}

/**
 * Repeated rather than imported: the hardening SEC-008 relies on must not be
 * able to change without a deliberate test update.
 */
const safetyArgs = [
  '--no-pager',
  '--no-optional-locks',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.hooksPath=/nonexistent/mde-disabled-git-hooks',
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

function hardened(...args: string[]): string[] {
  return [...safetyArgs, ...args]
}

const wslGit = (...args: string[]): string[] => [
  '/usr/bin/env', '-u', 'GIT_CONFIG',
  'GIT_OPTIONAL_LOCKS=0', 'GIT_TERMINAL_PROMPT=0', 'GIT_ASKPASS=',
  'GIT_NO_LAZY_FETCH=1', 'GIT_ALLOW_PROTOCOL=', 'GIT_PROTOCOL_FROM_USER=0', 'LC_ALL=C',
  'git', ...args,
]

const nativeSession = {
  id: 'native-1',
  name: 'Native app',
  kind: 'native' as const,
  path: '/workspace/native',
  createdAt: '2026-01-01T00:00:00.000Z'
}

const wslSession = {
  ...nativeSession,
  id: 'wsl-1',
  kind: 'wsl' as const,
  distro: 'Ubuntu-24.04',
  path: '/home/me/src/app'
}

// These unit fixtures model POSIX sessions; Windows transport has explicit cases below.
beforeEach(() => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  mocks.execFile.mockReset()
  mocks.resolveWindowsGitExecutable.mockReset()
  mocks.resolveWindowsGitExecutable.mockResolvedValue('C:\\Program Files\\Git\\cmd\\git.exe')
  mocks.runWslCommand.mockReset()
})

afterEach(() => vi.restoreAllMocks())

describe('Git process concurrency', () => {
  /** Holds every spawned process until the test releases it, recording how many overlap. */
  function holdProcesses() {
    const held: Array<() => void> = []
    const order: string[] = []
    const state = { running: 0, peak: 0 }
    mocks.execFile.mockImplementation(
      (_file: string, args: string[], _options: { cwd?: string }, callback: (error: null, stdout: string, stderr: string) => void) => {
        state.running += 1
        state.peak = Math.max(state.peak, state.running)
        order.push(args.at(-1) ?? '')
        held.push(() => {
          state.running -= 1
          callback(null, 'true\n', '')
        })
      }
    )
    const releaseAll = async (): Promise<void> => {
      for (let guard = 0; guard < 200; guard += 1) {
        const release = held.shift()
        if (release) release()
        else if (state.running === 0) return
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
    return { state, order, releaseAll }
  }

  it('starts at most three Git processes at once, however many sessions refresh together', async () => {
    const processes = holdProcesses()
    const pending = Array.from({ length: 10 }, (_, index) =>
      createGitCommandRunner({ ...nativeSession, id: `session-${index}` }, 'linux', nativeSession.path, 'background')(['--no-pager', 'status'])
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(processes.state.running).toBe(3)

    await processes.releaseAll()
    await Promise.all(pending)
    expect(processes.state.peak).toBe(3)
  })

  it('lets a request the user made overtake queued background polling', async () => {
    const processes = holdProcesses()
    const background = createGitCommandRunner(nativeSession, 'linux', nativeSession.path, 'background')
    const interactive = createGitCommandRunner(nativeSession, 'linux', nativeSession.path, 'interactive')

    const polls = ['poll-1', 'poll-2', 'poll-3', 'poll-4', 'poll-5'].map((name) => background([name]))
    const diff = interactive(['diff'])
    await new Promise((resolve) => setTimeout(resolve, 0))
    await processes.releaseAll()
    await Promise.all([...polls, diff])

    // Three polls took the free slots; the requested diff was then next, ahead of poll-4 and poll-5.
    expect(processes.order.slice(0, 4)).toEqual(['poll-1', 'poll-2', 'poll-3', 'diff'])
  })
})

describe('Git command transport and status parsing', () => {
  it('uses the explicit native folder as the Git cwd', async () => {
    const calls: Array<{ file: string; args: string[]; cwd?: string }> = []
    mocks.execFile.mockImplementation(
      (file: string, args: string[], options: { cwd?: string }, callback: (error: null, stdout: string, stderr: string) => void) => {
        calls.push({ file, args, cwd: options.cwd })
        const stdout = args.includes('rev-parse')
          ? 'true\n'
          : args.includes('branch')
            ? 'main\n'
            : ''
        callback(null, stdout, '')
      }
    )

    await readGitTerminalInfo(nativeSession, nativeSession.path)

    expect(calls).toHaveLength(6)
    expect(calls.every((call) => call.file === 'git' && call.cwd === nativeSession.path)).toBe(true)
  })

  it('uses an absolute trusted Git executable and -C for native Windows sessions', async () => {
    const session = {
      ...nativeSession,
      path: 'C:\\Projects\\hostile'
    }
    const calls: Array<{ file: string; args: string[]; cwd?: string }> = []
    mocks.execFile.mockImplementation(
      (file: string, args: string[], options: { cwd?: string }, callback: (error: null, stdout: string, stderr: string) => void) => {
        calls.push({ file, args, cwd: options.cwd })
        callback(null, args.includes('rev-parse') ? 'true\n' : '', '')
      }
    )

    const run = createGitCommandRunner(session, 'win32')
    await run(['--no-pager', 'status'])

    expect(mocks.resolveWindowsGitExecutable).toHaveBeenCalledWith(session.path)
    expect(calls).toEqual([{
      file: 'C:\\Program Files\\Git\\cmd\\git.exe',
      args: ['-C', session.path, ...hardened('--no-pager', 'status')],
      cwd: 'C:\\Program Files\\Git\\cmd'
    }])
  })

  it('fails closed when trusted Windows Git resolution fails', async () => {
    mocks.resolveWindowsGitExecutable.mockRejectedValue(new Error('Only workspace Git was found.'))

    const run = createGitCommandRunner({
      ...nativeSession,
      path: 'C:\\Projects\\hostile'
    }, 'win32')

    await expect(run(['status'])).resolves.toEqual({
      stdout: '',
      stderr: '',
      code: 1,
      launchError: true
    })
    expect(mocks.execFile).not.toHaveBeenCalled()
  })

  it('uses the WSL distro and explicit folder for Git commands', async () => {
    const calls: Array<{ distro: string; command: readonly string[]; cwd?: string }> = []
    mocks.runWslCommand.mockImplementation(async (
      distro: string,
      command: readonly string[],
      options: { cwd?: string } = {}
    ) => {
      calls.push({ distro, command, cwd: options.cwd })
      const stdout = command.includes('rev-parse')
        ? 'true\n'
        : command.includes('branch')
          ? 'main\n'
          : ''
      return { stdout, stderr: '', code: 0 }
    })

    await readGitStatusWithRunner(createGitCommandRunner(wslSession, 'win32'))

    expect(calls).toHaveLength(5)
    expect(calls.every((call) => call.distro === 'Ubuntu-24.04')).toBe(true)
    expect(calls.every((call) => call.cwd === '/home/me/src/app')).toBe(true)
    expect(calls.every((call) => call.command[0] === '/usr/bin/env' && call.command.includes('git'))).toBe(true)
  })

  it('preserves Git separators and hostile filenames as direct arguments', async () => {
    const filename = "change 'single' \"double\"; $(touch sentinel) `touch sentinel`\nline.ts"
    mocks.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 })

    const run = createGitCommandRunner(wslSession, 'win32')
    await run(['--no-pager', 'diff', 'HEAD', '--', filename])

    expect(mocks.runWslCommand).toHaveBeenCalledWith(
      'Ubuntu-24.04',
      wslGit(...hardened('--no-pager', 'diff', 'HEAD', '--', filename)),
      { cwd: '/home/me/src/app' }
    )
  })

  it('parses ahead counts and ignores missing upstream headers', () => {
    expect(parseGitAheadCount('# branch.head main\u0000# branch.upstream origin/main\u0000# branch.ab +3 -1\u0000')).toBe(3)
    expect(parseGitAheadCount('# branch.head main\u0000')).toBeNull()
    expect(parseGitAheadCount('# branch.head (detached)\u0000')).toBeNull()
  })

  it('aggregates numeric numstat records and skips binary files', () => {
    expect(parseGitNumstat('12\t3\tsrc/changed.ts\u0000-\t-\timage.png\u00004\t0\tnew name.ts\u0000')).toEqual({
      additions: 16,
      deletions: 3
    })
  })

  it('parses Git status records including renames and untracked files', () => {
    expect(
      parseGitStatus(
        [
          '1 M. N... 100644 100644 100644 abc123 abc123 src/changed.ts',
          '1 .D N... 100644 000000 000000 abc123 0000000000000000000000000000000000000000 src/removed.ts',
          '2 R. N... 100644 100644 100644 abc123 def456 R100 src/new name.ts',
          'old name.ts',
          '? new file.ts',
          'u UU N... 100644 100644 100644 100644 abc123 def456 ghi789 conflict.ts'
        ].join('\u0000') + '\u0000'
      )
    ).toEqual([
      {
        path: 'src/changed.ts',
        oldPath: null,
        status: 'modified',
      },
      {
        path: 'src/removed.ts',
        oldPath: null,
        status: 'deleted',
      },
      {
        path: 'src/new name.ts',
        oldPath: 'old name.ts',
        status: 'renamed',
      },
      {
        path: 'new file.ts',
        oldPath: null,
        status: 'untracked',
      },
      {
        path: 'conflict.ts',
        oldPath: null,
        status: 'unmerged',
      }
    ])
  })
})

describe('Git status summaries', () => {
  it('reads branch, tracked line changes, and commits ahead of upstream', async () => {
    const calls: string[][] = []
    const run = async (args: string[]): Promise<GitCommandResult> => {
      calls.push(args)
      if (args.includes('--is-inside-work-tree')) return result('true\n')
      if (args.includes('branch')) return result('feature/terminal\n')
      if (args.includes('--verify')) return result('0123456\n')
      if (args.includes('status')) {
        return result('# branch.head feature/terminal\u0000# branch.upstream origin/feature/terminal\u0000# branch.ab +2 -1\u0000')
      }
      return result('12\t3\tsrc/changed.ts\u0000-\t-\timage.png\u0000')
    }

    await expect(readGitStatusWithRunner(run)).resolves.toEqual({
      repository: true,
      branch: 'feature/terminal',
      additions: 12,
      deletions: 3,
      commitsAhead: 2,
      changedFiles: 0,
    })
    expect(calls).toContainEqual([
      '--no-pager',
      'status',
      '--porcelain=v2',
      '--branch',
      '-z',
      '--untracked-files=normal'
    ])
    expect(calls).toContainEqual([
      '--no-pager',
      'diff',
      '--numstat',
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--find-renames',
      '-z',
      'HEAD',
      '--'
    ])
  })

  it('uses the empty tree for a repository without a HEAD and leaves ahead unset', async () => {
    const calls: string[][] = []
    const run = async (args: string[]): Promise<GitCommandResult> => {
      calls.push(args)
      if (args.includes('--is-inside-work-tree')) return result('true\n')
      if (args.includes('branch')) return result('main\n')
      if (args.includes('--verify')) return result('', 'fatal: Needed a single revision', 128)
      if (args.includes('status')) return result('# branch.head main\u0000')
      return result('5\t0\tnew.ts\u0000')
    }

    await expect(readGitStatusWithRunner(run)).resolves.toMatchObject({
      repository: true,
      branch: 'main',
      additions: 5,
      deletions: 0,
      commitsAhead: null,
      changedFiles: 0,
    })
    expect(calls.at(-1)).toContain('4b825dc642cb6eb9a060e54bf8d69288fbee4904')
  })

  it('returns a quiet empty status for non-repositories', async () => {
    const run = async (): Promise<GitCommandResult> =>
      result('', 'fatal: not a git repository (or any of the parent directories): .git', 128)

    await expect(readGitStatusWithRunner(run)).resolves.toEqual({
      repository: false,
      branch: null,
      additions: 0,
      deletions: 0,
      commitsAhead: null,
      changedFiles: 0,
    })
  })
})

describe('terminal Git identity queries', () => {
  it('uses the native terminal directory for every Git command', async () => {
    const calls: Array<{ args: string[]; cwd?: string }> = []
    mocks.execFile.mockImplementation(
      (_file: string, args: string[], options: { cwd?: string }, callback: (error: null, stdout: string, stderr: string) => void) => {
        calls.push({ args, cwd: options.cwd })
        const stdout = args.includes('status') || args.includes('diff') ? '' : args.includes('--is-inside-work-tree')
          ? 'true\n'
          : args.includes('branch')
            ? 'feature/native\n'
            : '/workspace/other-repo\n'
        callback(null, stdout, '')
      }
    )

    await expect(readGitTerminalInfo(nativeSession, '/workspace/other-repo')).resolves.toEqual({
      repository: true,
      branch: 'feature/native',
      worktree: '/workspace/other-repo',
      directory: '/workspace/other-repo',
      additions: 0, deletions: 0, commitsAhead: null, changedFiles: 0
    })
    expect(calls).toHaveLength(6)
    expect(calls.every((call) => call.cwd === '/workspace/other-repo')).toBe(true)
  })

  it('reads the branch and worktree from the terminal directory', async () => {
    const calls: string[][] = []
    const run = async (args: string[]): Promise<GitCommandResult> => {
      calls.push(args)
      if (args.includes('--is-inside-work-tree')) return result('true\n')
      if (args.includes('branch')) return result('feature/terminal\n')
      if (args.includes('--show-toplevel')) return result('/workspace/other-repo\n')
      return result('')
    }

    await expect(readGitTerminalInfoWithRunner(run)).resolves.toEqual({
      repository: true,
      branch: 'feature/terminal',
      worktree: '/workspace/other-repo',
      additions: 0, deletions: 0, commitsAhead: null, changedFiles: 0
    })
    expect(calls).toContainEqual(['--literal-pathspecs', '-C', '/workspace/other-repo', '--no-pager', 'branch', '--show-current'])
    expect(calls).toContainEqual(['--no-pager', 'rev-parse', '--show-toplevel'])
  })

  it('keeps the worktree when HEAD is detached', async () => {
    const run = async (args: string[]): Promise<GitCommandResult> => {
      if (args.includes('--is-inside-work-tree')) return result('true\n')
      if (args.includes('status') || args.includes('diff')) return result('')
      if (args.includes('branch')) return result('\n')
      return result('/workspace/repo\n')
    }

    await expect(readGitTerminalInfoWithRunner(run)).resolves.toEqual({
      repository: true,
      branch: null,
      worktree: '/workspace/repo',
      additions: 0, deletions: 0, commitsAhead: null, changedFiles: 0
    })
  })

  it('returns a quiet empty result outside a repository', async () => {
    const run = async (): Promise<GitCommandResult> =>
      result('', 'fatal: not a git repository (or any of the parent directories): .git', 128)

    await expect(readGitTerminalInfoWithRunner(run)).resolves.toEqual({
      repository: false,
      branch: null,
      worktree: null,
      additions: 0, deletions: 0, commitsAhead: null, changedFiles: 0
    })
  })

  it('uses the live WSL terminal directory for Git commands', async () => {
    const calls: Array<{ cwd?: string; command: readonly string[] }> = []
    mocks.runWslCommand.mockImplementation(async (
      _distro: string,
      command: readonly string[],
      options: { cwd?: string } = {}
    ) => {
      calls.push({ cwd: options.cwd, command })
      if (command.includes('--is-inside-work-tree')) return { stdout: 'true\n', stderr: '', code: 0 }
      if (command.includes('status') || command.includes('diff')) return { stdout: '', stderr: '', code: 0 }
      if (command.includes('branch')) return { stdout: 'feature/live\n', stderr: '', code: 0 }
      return { stdout: '/home/me/other-repo\n', stderr: '', code: 0 }
    })

    await expect(
      readGitTerminalInfoWithRunner(
        createGitCommandRunner(wslSession, 'win32', '/home/me/other-repo')
      )
    ).resolves.toEqual({
      repository: true,
      branch: 'feature/live',
      worktree: '/home/me/other-repo',
      additions: 0, deletions: 0, commitsAhead: null, changedFiles: 0
    })

    expect(calls).toHaveLength(6)
    expect(calls.every((call) => call.cwd === '/home/me/other-repo')).toBe(true)
  })
})

describe('Git diff queries', () => {
  it('validates a changed path and reads its tracked diff against HEAD', async () => {
    const calls: string[][] = []
    const run = async (args: string[]): Promise<GitCommandResult> => {
      calls.push(args)
      if (args.includes('rev-parse')) return result('true\n')
      if (args.includes('status')) return result('1 M. N... 100644 100644 100644 abc123 def456 src/changed.ts\u0000')
      return result('diff --git a/src/changed.ts b/src/changed.ts\n@@ -1 +1 @@\n-old\n+new\n')
    }

    await expect(readGitDiffWithRunner(run, 'src/changed.ts')).resolves.toEqual({
      path: 'src/changed.ts',
      diff: 'diff --git a/src/changed.ts b/src/changed.ts\n@@ -1 +1 @@\n-old\n+new\n',
      binary: false
    })
    expect(calls).toContainEqual([
      '--no-pager',
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--find-renames',
      '--find-copies',
      '--unified=80',
      'HEAD',
      '--',
      'src/changed.ts'
    ])
  })

  it('reads untracked files with no-index and accepts its expected difference exit code', async () => {
    const calls: string[][] = []
    const run = async (args: string[]): Promise<GitCommandResult> => {
      calls.push(args)
      if (args.includes('rev-parse')) return result('true\n')
      if (args.includes('status')) return result('? new file.ts\u0000')
      return result('diff --git a/new file.ts b/new file.ts\n+new\n', '', 1)
    }

    await expect(readGitDiffWithRunner(run, 'new file.ts')).resolves.toMatchObject({
      path: 'new file.ts',
      binary: false
    })
    expect(calls).toContainEqual([
      '--no-pager',
      'diff',
      '--no-index',
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--unified=80',
      '--',
      '/dev/null',
      'new file.ts'
    ])
  })

  it('uses the empty tree when a repository has no HEAD yet', async () => {
    const calls: string[][] = []
    const run = async (args: string[]): Promise<GitCommandResult> => {
      calls.push(args)
      if (args.includes('--verify')) return result('', 'fatal: Needed a single revision', 128)
      if (args.includes('rev-parse')) return result('true\n')
      if (args.includes('status')) return result('1 A. N... 100644 100644 100644 abc123 abc123 staged.ts\u0000')
      return result('diff --git a/staged.ts b/staged.ts\n+new\n')
    }

    await expect(readGitDiffWithRunner(run, 'staged.ts')).resolves.toMatchObject({
      path: 'staged.ts',
      binary: false
    })
    expect(calls.at(-1)).toContain('4b825dc642cb6eb9a060e54bf8d69288fbee4904')
  })

  it('rejects paths that are no longer listed as changes', async () => {
    const run = async (args: string[]): Promise<GitCommandResult> => {
      if (args.includes('rev-parse')) return result('true\n')
      return result('')
    }

    await expect(readGitDiffWithRunner(run, 'missing.ts')).rejects.toThrow(
      'The selected Git change is no longer available.'
    )
  })
})

describe('Git diff binary detection', () => {
  it('detects only standalone Git binary markers', () => {
    expect(isBinaryGitDiff('diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\n')).toBe(true)
    expect(isBinaryGitDiff('diff --git a/image.png b/image.png\nGIT binary patch\n')).toBe(true)
    expect(
      isBinaryGitDiff(
        'diff --git a/src/main/git.ts b/src/main/git.ts\n@@ -1 +1 @@\n+const text = "Binary files .* differ"\n+const patch = "GIT binary patch"\n'
      )
    ).toBe(false)
  })
})

describe('Git command hardening (SEC-008)', () => {
  it('prefixes every native Git call with the safety options', async () => {
    const calls: string[][] = []
    mocks.execFile.mockImplementation(
      (_file: string, args: string[], _options: unknown, callback: (error: null, stdout: string, stderr: string) => void) => {
        calls.push(args)
        callback(null, args.includes('rev-parse') ? 'true\n' : '', '')
      }
    )

    await readGitTerminalInfo(nativeSession, nativeSession.path)

    expect(calls).not.toHaveLength(0)
    for (const args of calls) {
      expect(args.slice(0, safetyArgs.length)).toEqual(safetyArgs)
      expect(args[0]).toBe('--no-pager')
    }
  })

  it('runs native Git with locks, prompts, and askpass disabled in the environment', async () => {
    let environment: NodeJS.ProcessEnv | undefined
    mocks.execFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        options: { env?: NodeJS.ProcessEnv },
        callback: (error: null, stdout: string, stderr: string) => void
      ) => {
        environment = options.env
        callback(null, 'true\n', '')
      }
    )

    await createGitCommandRunner(nativeSession, 'linux')(['--no-pager', 'status'])

    expect(environment).toMatchObject({
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '',
      GIT_NO_LAZY_FETCH: '1',
      GIT_ALLOW_PROTOCOL: '',
      GIT_PROTOCOL_FROM_USER: '0',
    })
  })

  it('does not let GIT_CONFIG redirect only the filter-inspection command', async () => {
    vi.stubEnv('GIT_CONFIG', '/fixture/other-config')
    vi.stubEnv('git_config', '/fixture/other-config')
    vi.stubEnv('git_allow_protocol', 'https')
    try {
      mocks.execFile.mockImplementation(
        (_file: string, _args: string[], options: { env: NodeJS.ProcessEnv }, callback: (error: null, stdout: string, stderr: string) => void) => {
          expect(options.env.GIT_CONFIG).toBeUndefined()
          expect(options.env.git_config).toBeUndefined()
          expect(options.env.git_allow_protocol).toBeUndefined()
          callback(null, '', '')
        }
      )
      await createGitCommandRunner(nativeSession, 'linux')(['status'])
    } finally { vi.unstubAllEnvs() }
  })

  it('prefixes WSL Git calls with the same safety options', async () => {
    mocks.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 })

    await createGitCommandRunner(wslSession, 'win32')(['--no-pager', 'status'])

    expect(mocks.runWslCommand).toHaveBeenCalledWith(
      'Ubuntu-24.04',
      wslGit(...hardened('--no-pager', 'status')),
      { cwd: '/home/me/src/app' }
    )
  })
})

describe('Git branch listing', () => {
  it('lists local branches first, then remote-tracking ones, and skips a remote HEAD', () => {
    const output = [
      'refs/remotes/origin/HEAD',
      'refs/remotes/origin/main',
      'refs/heads/feature/login',
      'refs/remotes/upstream/dev',
      'refs/heads/main',
      'refs/tags/v1',
      'refs/heads/',
      'refs/remotes/orphan',
      ''
    ].join('\n')

    expect(parseGitRefs(output)).toEqual([
      { name: 'feature/login', remote: false, ref: 'refs/heads/feature/login' },
      { name: 'main', remote: false, ref: 'refs/heads/main' },
      { name: 'origin/main', remote: true, ref: 'refs/remotes/origin/main' },
      { name: 'upstream/dev', remote: true, ref: 'refs/remotes/upstream/dev' }
    ])
  })

  it('stops at a fixed number of branches', () => {
    const output = Array.from({ length: 400 }, (_, index) => `refs/heads/b${index}`).join('\n')
    expect(parseGitRefs(output)).toHaveLength(300)
  })

  it('asks for refs only and reports a failed listing', async () => {
    const calls: string[][] = []
    const ok = async (args: string[]): Promise<GitCommandResult> => {
      calls.push(args)
      return result('refs/heads/main\n')
    }
    await expect(readGitRefs(ok)).resolves.toEqual([{ name: 'main', remote: false, ref: 'refs/heads/main' }])
    expect(calls[0]).toEqual([
      '--no-pager', 'for-each-ref', '--format=%(refname)', '--sort=-committerdate', 'refs/heads', 'refs/remotes'
    ])
    await expect(readGitRefs(async () => result('', 'fatal: not a git repository', 128)))
      .rejects.toThrow('Could not read Git branches.')
  })
})

describe('Git mutation runner', () => {
  it('keeps every safety option and the longer timeout for worktree checkout', async () => {
    const calls: Array<{ file: string; args: string[]; options: { cwd: string; timeout: number } }> = []
    mocks.execFile.mockImplementation(
      (file: string, args: string[], options: { cwd: string; timeout: number }, callback: (error: null, stdout: string, stderr: string) => void) => {
        calls.push({ file, args, options })
        callback(null, '', '')
      }
    )

    const run = createGitMutationRunner(nativeSession, '/workspace/native', undefined, 'linux')
    await run(['worktree', 'add', '--', '/workspace/wt', 'refs/heads/main'])

    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.file).toBe('git')
    expect(call?.args).toEqual([...safetyArgs, 'worktree', 'add', '--', '/workspace/wt', 'refs/heads/main'])
    expect(call?.args.some((arg) => arg.startsWith('--attr-source'))).toBe(false)
    expect(call?.options.cwd).toBe('/workspace/native')
    expect(call?.options.timeout).toBe(120_000)
  })

  it('runs a WSL distro command directly with the longer timeout', async () => {
    mocks.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 })

    const run = createGitMutationRunner(wslSession, '/home/me/src/app', 90_000, 'win32')
    await run(['worktree', 'remove', '--', '/home/me/.mde/worktrees/app-01234567/abcd1234'])

    expect(mocks.runWslCommand).toHaveBeenCalledWith(
      'Ubuntu-24.04',
      wslGit(...safetyArgs, 'worktree', 'remove', '--', '/home/me/.mde/worktrees/app-01234567/abcd1234'),
      { cwd: '/home/me/src/app', timeoutMs: 90_000 }
    )
  })

  it('leaves ordinary queries on the short timeout', async () => {
    mocks.execFile.mockImplementation(
      (_file: string, _args: string[], options: { timeout: number }, callback: (error: null, stdout: string, stderr: string) => void) => {
        expect(options.timeout).toBe(10_000)
        callback(null, '', '')
      }
    )
    await createGitCommandRunner(nativeSession, 'linux')(['--no-pager', 'status'])
    expect(mocks.execFile).toHaveBeenCalled()
  })
})
