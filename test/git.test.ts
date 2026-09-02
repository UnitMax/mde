import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGitCommandRunner,
  isBinaryGitDiff,
  parseGitAheadCount,
  parseGitBehindCount,
  parseGitNumstat,
  parseGitStatus,
  parseGitLog,
  parseGitWorktreeList,
  readGitInfo,
  readGitInfoWithRunner,
  readGitStatusWithRunner,
  readGitDiffWithRunner,
  type GitCommandResult
} from '../src/main/git'
import { formatGitTimestamp, parseGitDiff, shortGitHash } from '../src/renderer/lib/git'

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  resolveWindowsGitExecutable: vi.fn(),
  runWslCommand: vi.fn()
}))

vi.mock('node:child_process', () => ({ execFile: mocks.execFile }))
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
  '--attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904',
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
  'protocol.ext.allow=never'
]

function hardened(...args: string[]): string[] {
  return [...safetyArgs, ...args]
}

const nativeSession = {
  id: 'native-1',
  projectId: 'project-1',
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

beforeEach(() => {
  mocks.execFile.mockReset()
  mocks.resolveWindowsGitExecutable.mockReset()
  mocks.resolveWindowsGitExecutable.mockResolvedValue('C:\\Program Files\\Git\\cmd\\git.exe')
  mocks.runWslCommand.mockReset()
})

describe('Git history queries', () => {
  it('uses the native session path as the Git cwd', async () => {
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

    await readGitInfo(nativeSession)

    expect(calls).toHaveLength(4)
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

  it('uses the WSL distro and session path for Git commands', async () => {
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

    await readGitInfoWithRunner(createGitCommandRunner(wslSession, 'win32'))

    expect(calls).toHaveLength(4)
    expect(calls.every((call) => call.distro === 'Ubuntu-24.04')).toBe(true)
    expect(calls.every((call) => call.cwd === '/home/me/src/app')).toBe(true)
    expect(calls.every((call) => call.command[0] === 'git')).toBe(true)
  })

  it('preserves Git separators and hostile filenames as direct arguments', async () => {
    const filename = "change 'single' \"double\"; $(touch sentinel) `touch sentinel`\nline.ts"
    mocks.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 })

    const run = createGitCommandRunner(wslSession, 'win32')
    await run(['--no-pager', 'diff', 'HEAD', '--', filename])

    expect(mocks.runWslCommand).toHaveBeenCalledWith(
      'Ubuntu-24.04',
      ['git', ...hardened('--no-pager', 'diff', 'HEAD', '--', filename)],
      { cwd: '/home/me/src/app' }
    )
  })

  it('reads the branch and newest commits through one runner', async () => {
    const calls: string[][] = []
    const run = async (args: string[]): Promise<GitCommandResult> => {
      calls.push(args)
      if (args.includes('rev-parse')) return result('true\n')
      if (args.includes('branch')) return result('main\n')
      if (args.includes('status')) return result('')
      return result(
        '0123456789abcdef\u0000First commit\u0000Max Mustermann\u00002026-08-19T10:00:00+02:00\u0000'
      )
    }

    await expect(readGitInfoWithRunner(run)).resolves.toEqual({
      repository: true,
      branch: 'main',
      commits: [
        {
          hash: '0123456789abcdef',
          message: 'First commit',
          author: 'Max Mustermann',
          timestamp: '2026-08-19T10:00:00+02:00'
        }
      ],
      changes: []
    })
    expect(calls).toContainEqual(['--no-pager', 'rev-parse', '--is-inside-work-tree'])
    expect(calls).toContainEqual(['--no-pager', 'branch', '--show-current'])
    expect(calls).toContainEqual([
      '--no-pager',
      'log',
      '-z',
      '--max-count',
      '50',
      '--format=%H%x00%s%x00%an%x00%cI'
    ])
  })

  it('returns an inline non-repository result for Git’s repository error', async () => {
    const run = async (): Promise<GitCommandResult> =>
      result('', 'fatal: not a git repository (or any of the parent directories): .git', 128)

    await expect(readGitInfoWithRunner(run)).resolves.toEqual({
      repository: false,
      branch: null,
      commits: [],
      changes: []
    })
  })

  it('propagates other Git failures', async () => {
    const run = async (): Promise<GitCommandResult> => result('', 'fatal: permission denied', 128)

    await expect(readGitInfoWithRunner(run)).rejects.toThrow('Could not read Git repository.')
  })

  it('parses empty and NUL-delimited histories', () => {
    expect(parseGitLog('')).toEqual([])
    expect(
      parseGitLog('abc123\u0000Message with a tab\tinside\u0000Ada Lovelace\u00002026-08-19T10:00:00+02:00\u0000')
    ).toEqual([
      {
        hash: 'abc123',
        message: 'Message with a tab\tinside',
        author: 'Ada Lovelace',
        timestamp: '2026-08-19T10:00:00+02:00'
      }
    ])
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
        staged: true,
        unstaged: false
      },
      {
        path: 'src/removed.ts',
        oldPath: null,
        status: 'deleted',
        staged: false,
        unstaged: true
      },
      {
        path: 'src/new name.ts',
        oldPath: 'old name.ts',
        status: 'renamed',
        staged: true,
        unstaged: false
      },
      {
        path: 'new file.ts',
        oldPath: null,
        status: 'untracked',
        staged: false,
        unstaged: true
      },
      {
        path: 'conflict.ts',
        oldPath: null,
        status: 'unmerged',
        staged: true,
        unstaged: true
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
      if (args.includes('branch')) return result('feature/sidebar\n')
      if (args.includes('--verify')) return result('0123456\n')
      if (args.includes('status')) {
        return result('# branch.head feature/sidebar\u0000# branch.upstream origin/feature/sidebar\u0000# branch.ab +2 -1\u0000')
      }
      return result('12\t3\tsrc/changed.ts\u0000-\t-\timage.png\u0000')
    }

    await expect(readGitStatusWithRunner(run)).resolves.toEqual({
      repository: true,
      branch: 'feature/sidebar',
      additions: 12,
      deletions: 3,
      commitsAhead: 2,
      commitsBehind: 1
    })
    expect(calls).toContainEqual([
      '--no-pager',
      'status',
      '--porcelain=v2',
      '--branch',
      '-z',
      '--untracked-files=no'
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
      commitsBehind: null
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
      commitsBehind: null
    })
  })
})

describe('Git worktree summaries', () => {
  it('parses the primary, detached, and prunable worktrees from porcelain output', () => {
    const output = [
      'worktree /home/me/src/app',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree /home/me/src/app-feature',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/feature/sidebar',
      '',
      'worktree /home/me/src/app-old',
      'HEAD 3333333333333333333333333333333333333333',
      'prunable gitdir file points to non-existent location',
      '',
      ''
    ].join('\u0000')

    expect(parseGitWorktreeList(output)).toEqual([
      {
        path: '/home/me/src/app',
        branch: 'main',
        head: '1111111111111111111111111111111111111111',
        primary: true,
        prunable: false
      },
      {
        path: '/home/me/src/app-feature',
        branch: 'feature/sidebar',
        head: '2222222222222222222222222222222222222222',
        primary: false,
        prunable: false
      },
      {
        path: '/home/me/src/app-old',
        branch: null,
        head: '3333333333333333333333333333333333333333',
        primary: false,
        prunable: true
      }
    ])
  })

  it('parses both sides of an upstream divergence', () => {
    expect(parseGitAheadCount('# branch.ab +4 -2\u0000')).toBe(4)
    expect(parseGitBehindCount('# branch.ab +4 -2\u0000')).toBe(2)
    expect(parseGitBehindCount('# branch.head main\u0000')).toBeNull()
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

describe('Git history display helpers', () => {
  it('shortens hashes and preserves invalid timestamps', () => {
    expect(shortGitHash('0123456789abcdef')).toBe('0123456')
    expect(formatGitTimestamp('not-a-timestamp')).toBe('not-a-timestamp')
    expect(formatGitTimestamp('2026-08-19T10:00:00+02:00')).not.toBe('2026-08-19T10:00:00+02:00')
  })

  it('classifies unified diff lines for the renderer', () => {
    expect(parseGitDiff('diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\n context\n')).toEqual([
      { text: 'diff --git a/a.ts b/a.ts', kind: 'metadata' },
      { text: '@@ -1 +1 @@', kind: 'hunk' },
      { text: '-old', kind: 'deletion' },
      { text: '+new', kind: 'addition' },
      { text: ' context', kind: 'context' }
    ])
  })

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

    await readGitInfo(nativeSession)

    expect(calls).not.toHaveLength(0)
    for (const args of calls) {
      expect(args.slice(0, safetyArgs.length)).toEqual(safetyArgs)
      expect(args.indexOf('--no-pager')).toBe(safetyArgs.length)
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
      GIT_ASKPASS: ''
    })
  })

  it('prefixes WSL Git calls with the same safety options', async () => {
    mocks.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 })

    await createGitCommandRunner(wslSession, 'win32')(['--no-pager', 'status'])

    expect(mocks.runWslCommand).toHaveBeenCalledWith(
      'Ubuntu-24.04',
      ['git', ...hardened('--no-pager', 'status')],
      { cwd: '/home/me/src/app' }
    )
  })

  it('retries without attr-source when Git rejects it, then remembers that repository', async () => {
    const calls: string[][] = []
    mocks.execFile.mockImplementation(
      (_file: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        calls.push(args)
        if (args.includes(safetyArgs[0] as string)) {
          const failure = Object.assign(new Error('git failed'), { code: 128 })
          callback(failure, '', 'fatal: bad --attr-source or GIT_ATTR_SOURCE\n')
          return
        }
        callback(null, 'true\n', '')
      }
    )

    const legacySession = { ...nativeSession, path: '/workspace/legacy-git' }
    const run = createGitCommandRunner(legacySession, 'linux')

    await expect(run(['--no-pager', 'status'])).resolves.toMatchObject({ code: 0 })
    await expect(run(['--no-pager', 'status'])).resolves.toMatchObject({ code: 0 })

    expect(calls).toHaveLength(3)
    expect(calls[1]).toEqual(hardened('--no-pager', 'status').slice(1))
    expect(calls[2]).toEqual(hardened('--no-pager', 'status').slice(1))
  })

  it('does not drop attr-source when a command fails for an unrelated reason', async () => {
    const calls: string[][] = []
    mocks.execFile.mockImplementation(
      (_file: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        calls.push(args)
        const failure = Object.assign(new Error('git failed'), { code: 128 })
        callback(failure, '', 'fatal: not a git repository (or any of the parent directories): .git\n')
      }
    )

    const run = createGitCommandRunner({ ...nativeSession, path: '/workspace/plain' }, 'linux')
    await run(['--no-pager', 'status'])
    await run(['--no-pager', 'status'])

    expect(calls).toHaveLength(2)
    expect(calls.every((args) => args[0] === safetyArgs[0])).toBe(true)
  })
})
