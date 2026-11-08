import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildLaunchSpec } from '../src/main/pty/launch'
import { runLaunchProcess } from './helpers/launch-process'
import type { Session } from '../src/shared/types'

const directories: string[] = []
const native: Session = {
  id: 'native', name: 'Mac', kind: 'native',
  shell: '/bin/sh', createdAt: '2026-01-01T00:00:00Z',
}

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(join(tmpdir(), 'mde-native-test-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('native agent command transport', () => {
  it('runs an executable with spaces and literal arguments in the requested directory', async () => {
    const directory = await temporaryDirectory()
    const executable = join(directory, 'agent with spaces')
    await fs.writeFile(executable, '#!/bin/sh\nprintf "%s\\n" "$PWD" "$@"\n', { mode: 0o700 })
    const spec = buildLaunchSpec(native, {
      platform: 'darwin', workingDirectory: directory, agent: { executable, args: ['$(touch sentinel)', 'a; b', ''] },
    })
    const result = await runLaunchProcess(spec.file, spec.args, { cwd: spec.cwd })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('$(touch sentinel)\na; b\n\n')
    await expect(fs.access(join(directory, 'sentinel'))).rejects.toThrow()
    const missing = buildLaunchSpec(native, { platform: 'darwin', agent: { executable: join(directory, 'missing'), args: [] } })
    expect((await runLaunchProcess(missing.file, missing.args)).status).not.toBe(0)
  })

})
