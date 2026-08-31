import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createGitCommandRunner,
  readGitDiffWithRunner,
  readGitStatusWithRunner
} from '../src/main/git'
import { listDistros, runWslCommand, type WslResult } from '../src/main/wsl/distros'
import type { Session } from '../src/shared/types'

/**
 * Opt in on Windows or from inside WSL with MDE_WSL_INTEGRATION=1.
 * MDE_WSL_DISTRO may select a particular installed WSL 2 distro; Windows
 * otherwise uses the first available distro and WSL uses its current distro.
 */
const isWslHost = process.platform === 'linux' && Boolean(process.env.WSL_DISTRO_NAME)
const describeWindowsWsl =
  (process.platform === 'win32' || isWslHost) && process.env.MDE_WSL_INTEGRATION === '1'
    ? describe
    : describe.skip
const SAFE_TEMP_ROOT = /^\/tmp\/mde-sec-002\.[A-Za-z0-9]+$/

describeWindowsWsl('SEC-002 Windows/WSL direct execution', () => {
  let distro = ''
  let root = ''
  let specialDirectory = ''
  let pathSentinel = ''
  let repository = ''
  let gitFilename = ''
  let gitSentinel = ''
  let session: Session

  async function successful(
    command: readonly string[],
    cwd?: string
  ): Promise<WslResult> {
    const result = await runWslCommand(distro, command, { cwd, timeoutMs: 30_000 })
    expect(result.code, result.stderr).toBe(0)
    return result
  }

  async function expectAbsent(path: string): Promise<void> {
    const result = await runWslCommand(distro, ['test', '-e', path])
    expect(result.code, `Unexpected sentinel created at ${path}`).not.toBe(0)
  }

  beforeAll(async () => {
    const requested = process.env.MDE_WSL_DISTRO
    if (isWslHost) {
      distro = requested ?? process.env.WSL_DISTRO_NAME ?? ''
    } else {
      const distros = await listDistros()
      const selected = requested
        ? distros.find((candidate) => candidate.name === requested)
        : distros[0]
      if (!selected) {
        throw new Error(
          requested
            ? `WSL 2 distro "${requested}" is not available.`
            : 'No WSL 2 distro is available.'
        )
      }
      distro = selected.name
    }
    if (!distro) throw new Error('Could not determine the WSL distro to test.')

    const temporary = await successful(['mktemp', '-d', '/tmp/mde-sec-002.XXXXXX'])
    const temporaryRoot = temporary.stdout.trim()
    if (!SAFE_TEMP_ROOT.test(temporaryRoot)) {
      throw new Error(`Refusing unexpected WSL test directory: "${temporaryRoot}".`)
    }
    root = temporaryRoot

    pathSentinel = `${root}/PATH_SENTINEL`
    specialDirectory =
      `${root}/folder with space 'single' "double"; touch ${pathSentinel}; ` +
      '$(printf substitution) `printf backtick`\nline'
    await successful(['mkdir', '-p', '--', specialDirectory])

    repository = `${root}/repository`
    await successful(['mkdir', '--', repository])
    await successful(['git', 'init', '--quiet'], repository)

    gitFilename =
      "change with space 'single' \"double\"; touch SEC002_SENTINEL; " +
      '$(printf substitution) `printf backtick`\nline.txt'
    gitSentinel = `${repository}/SEC002_SENTINEL`
    await successful(['cp', '--', '/etc/hostname', gitFilename], repository)

    session = {
      id: 'sec-002-wsl',
      projectId: 'sec-002-project',
      name: 'SEC-002 fixture',
      kind: 'wsl',
      distro,
      path: repository,
      createdAt: new Date(0).toISOString()
    }
  }, 60_000)

  afterAll(async () => {
    if (!distro || !SAFE_TEMP_ROOT.test(root)) return
    await runWslCommand(distro, ['rm', '-rf', '--', root], { timeoutMs: 30_000 })
  }, 60_000)

  it('validates a hostile directory without running its shell syntax', async () => {
    await successful(['test', '-d', specialDirectory])
    await expectAbsent(pathSentinel)
  }, 30_000)

  it('reads Git status and diff without evaluating the filename', async () => {
    const run = createGitCommandRunner(session, 'win32')

    await expect(readGitStatusWithRunner(run)).resolves.toMatchObject({ repository: true })
    await expectAbsent(gitSentinel)

    await expect(readGitDiffWithRunner(run, gitFilename)).resolves.toMatchObject({
      path: gitFilename,
      binary: false
    })
    await expectAbsent(gitSentinel)
  }, 60_000)
})
