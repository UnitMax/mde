import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverOpenCodeService, SERVICE_UNAVAILABLE } from '../src/main/opencode/service/discovery'

afterEach(() => vi.unstubAllEnvs())

describe.skipIf(process.platform === 'win32')('native OpenCode service discovery', () => {
  it('starts the configured executable and reads only its framed local service state', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'mde-discovery-test-'))
    try {
      const executable = join(directory, 'service cli;literal')
      const stateDirectory = join(directory, 'opencode')
      const stateFile = join(stateDirectory, 'service.json')
      const state = { url: 'http://127.0.0.1:49374', password: 'test-password' }
      await fs.mkdir(stateDirectory)
      await fs.writeFile(stateFile, JSON.stringify(state))
      await fs.writeFile(executable, '#!/bin/sh\n[ "$1" = service ] && [ "$2" = start ]\n', { mode: 0o700 })
      vi.stubEnv('SHELL', '/bin/sh')
      vi.stubEnv('XDG_STATE_HOME', directory)

      expect(await discoverOpenCodeService({ kind: 'native' }, executable)).toEqual(state)
      await fs.writeFile(stateFile, 'invalid JSON')
      await expect(discoverOpenCodeService({ kind: 'native' }, executable)).rejects.toThrow(SERVICE_UNAVAILABLE)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
