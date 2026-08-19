import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGitCommandRunner,
  parseGitLog,
  readGitInfo,
  readGitInfoWithRunner,
  type GitCommandResult
} from '../src/main/git'
import { formatGitTimestamp, shortGitHash } from '../src/renderer/lib/git'

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

    expect(calls).toHaveLength(3)
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

    expect(calls).toHaveLength(3)
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
      ]
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
      commits: []
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
})

describe('Git history display helpers', () => {
  it('shortens hashes and preserves invalid timestamps', () => {
    expect(shortGitHash('0123456789abcdef')).toBe('0123456')
    expect(formatGitTimestamp('not-a-timestamp')).toBe('not-a-timestamp')
    expect(formatGitTimestamp('2026-08-19T10:00:00+02:00')).not.toBe('2026-08-19T10:00:00+02:00')
  })
})
