import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../src/shared/types'

const fixture = vi.hoisted(() => ({ directory: '', path: '' }))
vi.mock('../src/main/native-environment', () => ({
  nativeLoginEnvironment: async () => ({ ...process.env, PATH: fixture.path }),
  nativeOpenCodeConfigDirectory: async () => fixture.directory,
}))
import { OpenCodeTokenRatePluginManager, TOKEN_RATE_PLUGIN_ENV } from '../src/main/opencode/token-rate'

const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('native Mac token-rate plugin', () => {
  it('uses the login PATH, preserves user configuration, and removes only its own registration', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const directory = await fs.mkdtemp(join(tmpdir(), 'mde-native-token-'))
    directories.push(directory)
    fixture.directory = join(directory, 'config space')
    fixture.path = join(directory, 'bin')
    await fs.mkdir(fixture.directory)
    await fs.mkdir(fixture.path)
    await fs.writeFile(join(fixture.path, 'opencode'), '#!/bin/sh\nprintf "1.19.0\\n"\n', { mode: 0o700 })
    const config = join(fixture.directory, 'tui.json')
    await fs.writeFile(config, '{\n  // Preserve this setting.\n  "plugin": ["user-plugin"],\n  "theme": "dark"\n}\n')
    const target = { kind: 'native' } as const
    const manager = new OpenCodeTokenRatePluginManager()
    expect(await manager.installPlugin(target)).toMatchObject({ status: 'installed', registered: true, opencodeVersion: '1.19.0' })
    const installed = await fs.readFile(config, 'utf8')
    expect(installed).toContain('// Preserve this setting.')
    expect(installed).toContain('user-plugin')
    expect(installed).toContain('mde-token-rate.tsx')
    expect(installed).toContain('config%20space')
    expect(await manager.removePlugin(target)).toMatchObject({ status: 'not-installed', registered: false })
    expect(await fs.readFile(config, 'utf8')).toContain('user-plugin')
    expect(await fs.readFile(config, 'utf8')).not.toContain('mde-token-rate.tsx')
    await fs.writeFile(join(fixture.directory, 'plugins', 'mde-token-rate.tsx'), 'export default {}')
    await expect(manager.installPlugin(target)).rejects.toThrow('Refusing to overwrite')
    await expect(manager.removePlugin(target)).rejects.toThrow('Refusing to remove')
    const session: Session = { id: 'session', projectId: 'project', name: 'Mac', kind: 'native', path: '/tmp', createdAt: '2026-01-01T00:00:00Z' }
    expect(manager.prepare('terminal', session)).toEqual({ [TOKEN_RATE_PLUGIN_ENV]: '1' })
    await fs.rm(join(fixture.path, 'opencode'))
    expect((await manager.pluginState(target)).status).toBe('unavailable')
  })
})
