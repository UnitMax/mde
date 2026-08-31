import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, win32 } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createWindowsGitExecutableResolver,
  type WindowsGitResolverDependencies
} from '../src/main/git-executable'

const systemRoot = 'C:\\Windows'
const processExecutable = 'C:\\Program Files\\MDE\\mde.exe'
const workspace = 'C:\\Projects\\Hostile'
const trustedGit = 'C:\\Program Files\\Git\\cmd\\git.exe'

function runExecutable(file: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd, encoding: 'utf8', windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      resolve(String(stdout))
    })
  })
}

function dependencies(
  overrides: Partial<WindowsGitResolverDependencies> = {}
): WindowsGitResolverDependencies {
  return {
    environment: { SystemRoot: systemRoot },
    processExecutable,
    runWhere: vi.fn(async (_whereExecutable, name) => (
      name === 'git.exe' ? `${trustedGit}\r\n` : ''
    )),
    canonicalize: vi.fn(async (path) => path),
    readStats: vi.fn(async () => ({ isFile: () => true })),
    ...overrides
  }
}

describe('trusted Windows Git executable resolution', () => {
  it('ignores project-local git.exe and git.com and returns an absolute PATH candidate', async () => {
    const runWhere = vi.fn(async (_whereExecutable: string, name: string) => (
      name === 'git.exe'
        ? `${workspace}\\git.exe\r\n${trustedGit}\r\n`
        : `${workspace}\\git.com\r\n`
    ))
    const resolveGit = createWindowsGitExecutableResolver(dependencies({ runWhere }))

    await expect(resolveGit(workspace)).resolves.toBe(trustedGit)
    expect(runWhere).toHaveBeenCalledTimes(2)
    expect(runWhere).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\where.exe',
      'git.exe',
      'C:\\Program Files\\MDE'
    )
    expect(runWhere).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\where.exe',
      'git.com',
      'C:\\Program Files\\MDE'
    )
  })

  it('rejects workspace candidates case-insensitively and fails closed', async () => {
    const runWhere = vi.fn(async (_whereExecutable: string, name: string) => (
      name === 'git.exe' ? 'c:\\projects\\hostile\\GIT.EXE\r\n' : ''
    ))
    const resolveGit = createWindowsGitExecutableResolver(dependencies({ runWhere }))

    await expect(resolveGit(`${workspace}\\`)).rejects.toThrow(
      'Refusing to run a Git executable from inside the active workspace.'
    )
  })

  it('rejects a candidate whose canonical path resolves inside the workspace', async () => {
    const linkedGit = 'C:\\Tools\\git.exe'
    const canonicalize = vi.fn(async (path: string) => (
      path === linkedGit ? `${workspace}\\bin\\git.exe` : path
    ))
    const resolveGit = createWindowsGitExecutableResolver(dependencies({
      runWhere: vi.fn(async (_whereExecutable, name) => name === 'git.exe' ? `${linkedGit}\r\n` : ''),
      canonicalize
    }))

    await expect(resolveGit(workspace)).rejects.toThrow(
      'Refusing to run a Git executable from inside the active workspace.'
    )
  })

  it('ignores relative, wrongly named, missing, and directory candidates', async () => {
    const missingGit = 'C:\\Missing\\git.exe'
    const directoryGit = 'C:\\Directory\\git.exe'
    const readStats = vi.fn(async (path: string) => ({
      isFile: () => path !== directoryGit
    }))
    const canonicalize = vi.fn(async (path: string) => {
      if (path === missingGit) throw new Error('missing')
      return path
    })
    const runWhere = vi.fn(async (_whereExecutable: string, name: string) => (
      name === 'git.exe'
        ? `git.exe\r\nC:\\Tools\\not-git.exe\r\n${missingGit}\r\n${directoryGit}\r\n${trustedGit}\r\n`
        : ''
    ))
    const resolveGit = createWindowsGitExecutableResolver(dependencies({
      canonicalize,
      readStats,
      runWhere
    }))

    await expect(resolveGit(workspace)).resolves.toBe(trustedGit)
  })

  it('discovers candidates once and validates each active workspace', async () => {
    const runWhere = vi.fn(async (_whereExecutable: string, name: string) => (
      name === 'git.exe' ? `${trustedGit}\r\n` : ''
    ))
    const resolveGit = createWindowsGitExecutableResolver(dependencies({ runWhere }))

    await expect(resolveGit(workspace)).resolves.toBe(trustedGit)
    await expect(resolveGit('D:\\Other Project')).resolves.toBe(trustedGit)
    expect(runWhere).toHaveBeenCalledTimes(2)
  })

  it('rejects untrusted lookup configuration without invoking a helper', async () => {
    const runWhere = vi.fn()
    const resolveGit = createWindowsGitExecutableResolver(dependencies({
      environment: {},
      runWhere
    }))

    await expect(resolveGit(workspace)).rejects.toThrow('Windows SystemRoot is unavailable')
    expect(runWhere).not.toHaveBeenCalled()
  })

  it.runIf(process.platform === 'win32')(
    'ignores planted executables and runs real Git status and diff on Windows',
    async () => {
      const temporaryRoot = await mkdtemp(join(tmpdir(), 'mde-git-resolution-'))
      const project = join(temporaryRoot, 'project with spaces')

      try {
        await mkdir(project)
        await writeFile(join(project, 'git.exe'), 'This planted executable must never run.\n')
        await writeFile(join(project, 'git.com'), 'This planted executable must never run.\n')

        const resolveGit = createWindowsGitExecutableResolver()
        const executable = await resolveGit(project)
        const projectRelativeExecutable = relative(project, executable)
        expect(
          projectRelativeExecutable === ''
          || (!projectRelativeExecutable.startsWith('..') && !win32.isAbsolute(projectRelativeExecutable))
        ).toBe(false)

        const trustedCwd = dirname(executable)
        await runExecutable(executable, ['-C', project, 'init', '--quiet'], trustedCwd)
        await writeFile(join(project, 'tracked.txt'), 'original\n')
        await runExecutable(executable, ['-C', project, 'add', '--', 'tracked.txt'], trustedCwd)
        await runExecutable(executable, [
          '-C',
          project,
          '-c',
          'user.name=MDE Test',
          '-c',
          'user.email=mde-test@example.invalid',
          'commit',
          '--quiet',
          '-m',
          'Initial test commit'
        ], trustedCwd)
        await writeFile(join(project, 'tracked.txt'), 'changed\n')

        const status = await runExecutable(
          executable,
          ['-C', project, 'status', '--porcelain'],
          trustedCwd
        )
        const diff = await runExecutable(
          executable,
          ['-C', project, 'diff', '--', 'tracked.txt'],
          trustedCwd
        )
        expect(status).toContain('tracked.txt')
        expect(diff).toContain('-original')
        expect(diff).toContain('+changed')
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true })
      }
    }
  )
})
