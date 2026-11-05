import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildLaunchSpec } from '../src/main/pty/launch'
import { metadataQueryLaunch, parseMetadataOutput } from '../src/main/opencode/sessions'
import { runLaunchProcess } from './helpers/launch-process'
import type { Session } from '../src/shared/types'

const directories: string[] = []
const native: Session = {
  id: 'native', projectId: 'project', name: 'Mac', kind: 'native',
  path: '/tmp', shell: '/bin/sh', createdAt: '2026-01-01T00:00:00Z',
}

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(join(tmpdir(), 'mde-native-test-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('native OpenCode command transport', () => {
  it('runs an executable with spaces and literal arguments in the requested directory', async () => {
    const directory = await temporaryDirectory()
    const executable = join(directory, 'agent with spaces')
    await fs.writeFile(executable, '#!/bin/sh\nprintf "%s\\n" "$PWD" "$@"\n', { mode: 0o700 })
    const spec = buildLaunchSpec({ ...native, path: directory }, {
      platform: 'darwin', agent: { executable, args: ['$(touch sentinel)', 'a; b', ''] },
    })
    const result = await runLaunchProcess(spec.file, spec.args, { cwd: spec.cwd })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('$(touch sentinel)\na; b\n\n')
    await expect(fs.access(join(directory, 'sentinel'))).rejects.toThrow()
    const missing = buildLaunchSpec(native, { platform: 'darwin', agent: { executable: join(directory, 'missing'), args: [] } })
    expect((await runLaunchProcess(missing.file, missing.args)).status).not.toBe(0)
  })

  it('uses the native API command and frames JSON after banners', async () => {
    const directory = await temporaryDirectory()
    const executable = join(directory, 'metadata cli')
    await fs.writeFile(executable, [
      '#!/bin/sh',
      '[ "$1" = api ] && [ "$2" = session.get ] && [ "$3" = --param ] && [ "$4" = sessionID=ses_test ] || exit 22',
      'printf \'{"data":{"id":"ses_test","title":"Saved"}}\\n\'',
    ].join('\n'), { mode: 0o700 })
    const request = { operation: 'session.get', params: { sessionID: 'ses_test' } } as const
    const { spec, begin, end } = metadataQueryLaunch(native, executable, request, 'fixture')
    expect(spec.file).toBe('/bin/sh')
    const result = await runLaunchProcess(spec.file, spec.args, { cwd: spec.cwd })
    expect(result.status).toBe(0)
    expect(parseMetadataOutput(result.stdout, begin, end)).toEqual({ data: { id: 'ses_test', title: 'Saved' } })
    expect(() => parseMetadataOutput(`${begin}\ninvalid\n${end}`, begin, end)).toThrow('invalid')
  })

  it('returns to a shell after the agent exits in the same directory', async () => {
    const directory = await temporaryDirectory()
    const executable = join(directory, 'agent')
    await fs.writeFile(executable, '#!/bin/sh\nprintf "AGENT_DONE\\n"\n', { mode: 0o700 })
    const spec = buildLaunchSpec({ ...native, path: directory }, {
      platform: 'darwin', agent: { executable, args: [] }, returnToShell: true,
    })
    const result = await runLaunchProcess(spec.file, spec.args, {
      cwd: directory, input: 'printf "SHELL_RETURNED\\n"\npwd\nexit\n',
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('AGENT_DONE\nSHELL_RETURNED\n')
    expect(result.stdout).toContain(directory)
  })
})
