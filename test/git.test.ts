import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGitCommandRunner,
  isBinaryGitDiff,
  parseGitStatus,
  parseGitLog,
  readGitInfo,
  readGitInfoWithRunner,
  readGitDiffWithRunner,
  type GitCommandResult
} from '../src/main/git'
import { formatGitTimestamp, parseGitDiff, shortGitHash } from '../src/renderer/lib/git'

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  runWsl: vi.fn()
}))

vi.mock('node:child_process', () => ({ execFile: mocks.execFile }))
vi.mock('../src/main/wsl/distros', () => ({ runWsl: mocks.runWsl }))

function result(stdout = '', stderr = '', code = 0): GitCommandResult {
  return { stdout, stderr, code }
}

const nativeSession = {
  id: 'native-1',
  projectId: 'project-1',
  name: 'Native app',
  mode: 'terminal' as const,
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
  mocks.runWsl.mockReset()
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

  it('uses the WSL distro and session path for Git commands', async () => {
    const calls: string[][] = []
    mocks.runWsl.mockImplementation(async (args: string[]) => {
      calls.push(args)
      const stdout = args.includes('rev-parse')
        ? 'true\n'
        : args.includes('branch')
          ? 'main\n'
          : ''
      return { stdout, stderr: '', code: 0 }
    })

    await readGitInfoWithRunner(createGitCommandRunner(wslSession, 'win32'))

    expect(calls).toHaveLength(4)
    expect(calls.every((args) =>
      args.slice(0, 5).every((value, index) => value === ['-d', 'Ubuntu-24.04', '--cd', '/home/me/src/app', '--'][index])
    )).toBe(true)
    expect(calls.every((args) => args.includes('git'))).toBe(true)
  })

  it('reads the branch and newest commits through one runner', async () => {
    const calls: string[][] = []
    const run = async (args: string[]): Promise<GitCommandResult> => {
      calls.push(args)
      if (args.includes('rev-parse')) return result('true\n')
      if (args.includes('branch')) return result('main\n')
      if (args.includes('status')) return result('')
      return result(
        '0123456789abcdef\u0000First commit\u00002026-08-19T10:00:00+02:00\u0000'
      )
    }

    await expect(readGitInfoWithRunner(run)).resolves.toEqual({
      repository: true,
      branch: 'main',
      commits: [
        {
          hash: '0123456789abcdef',
          message: 'First commit',
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
      '--format=%H%x00%s%x00%cI'
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
      parseGitLog('abc123\u0000Message with a tab\tinside\u00002026-08-19T10:00:00+02:00\u0000')
    ).toEqual([
      {
        hash: 'abc123',
        message: 'Message with a tab\tinside',
        timestamp: '2026-08-19T10:00:00+02:00'
      }
    ])
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
