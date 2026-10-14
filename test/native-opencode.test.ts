import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileFunction, constants } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nativeLoginEnvironment, openCodeConfigDirectory } from '../src/main/native-environment'
import { buildLaunchSpec } from '../src/main/pty/launch'
import { metadataQueryLaunch, parseMetadataOutput } from '../src/main/opencode/sessions'
import {
  decodeTuiStatusSnapshot,
  OpenCodeTuiStatusManager,
  probeMacTuiProcess,
  TUI_STATUS_PLUGIN_SOURCE,
  TUI_STATUS_PLUGIN_VERSION,
  TUI_STATUS_STALE_MS,
} from '../src/main/opencode/tui-status'
import { runLaunchProcess } from './helpers/launch-process'
import type { Session } from '../src/shared/types'

const directories: string[] = []
const managers: OpenCodeTuiStatusManager[] = []
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
  managers.splice(0).forEach((manager) => manager.disposeAll())
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe('native OpenCode configuration', () => {
  it('respects config overrides, XDG paths, and the default global directory', () => {
    expect(openCodeConfigDirectory({ OPENCODE_CONFIG_DIR: '/tmp/config space/' }, '/home/me')).toBe('/tmp/config space')
    expect(openCodeConfigDirectory({ XDG_CONFIG_HOME: '/tmp/xdg' }, '/home/me')).toBe('/tmp/xdg/opencode')
    expect(openCodeConfigDirectory({ XDG_CONFIG_HOME: 'relative' }, '/home/me')).toBe('/home/me/.config/opencode')
    expect(() => openCodeConfigDirectory({ OPENCODE_CONFIG_DIR: 'relative' }, '/home/me')).toThrow('absolute')
  })

  it.skipIf(process.platform === 'win32')('reads values from a login shell past startup banners without evaluating them', async () => {
    const directory = await temporaryDirectory()
    const shell = join(directory, 'fixture-shell')
    await fs.writeFile(shell, '#!/bin/sh\nprintf "startup banner\\n"\nexport OPENCODE_CONFIG_DIR=\'/tmp/config $(literal)\'\nexport XDG_CONFIG_HOME=/tmp/xdg\nshift\nexec /bin/sh -c "$@"\n', { mode: 0o700 })
    const env = await nativeLoginEnvironment(shell, { PATH: '/usr/bin:/bin' })
    expect(env.OPENCODE_CONFIG_DIR).toBe('/tmp/config $(literal)')
    expect(env.XDG_CONFIG_HOME).toBe('/tmp/xdg')
    await expect(nativeLoginEnvironment(join(directory, 'missing'))).rejects.toThrow('login environment')
  })
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

  it('uses the native metadata command and frames JSON after banners', async () => {
    const directory = await temporaryDirectory()
    const executable = join(directory, 'metadata cli')
    await fs.writeFile(executable, '#!/bin/sh\nprintf \'[{"id":"ses_test","title":"Saved"}]\\n\'\n', { mode: 0o700 })
    const { spec, begin, end } = metadataQueryLaunch(native, executable, 'SELECT fixture', 'fixture')
    expect(spec.file).toBe('/bin/sh')
    const result = await runLaunchProcess(spec.file, spec.args, { cwd: spec.cwd })
    expect(result.status).toBe(0)
    expect(parseMetadataOutput(result.stdout, begin, end)).toEqual([{ id: 'ses_test', title: 'Saved' }])
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

describe('native status plugin management', () => {
  it.skipIf(process.platform === 'win32')('publishes real plugin events, heartbeat identity, and shutdown without leaking event contents', async () => {
    const root = await temporaryDirectory()
    const file = join(root, 'status.json')
    const factory = compileFunction(TUI_STATUS_PLUGIN_SOURCE.replace('export const MdeTuiStatus =', 'return'), ['process'], {
      importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
    })
    const plugin = factory({
      platform: process.platform, pid: process.pid,
      env: { ...process.env, MDE_OPENCODE_STATUS_FILE: file, MDE_OPENCODE_STATUS_ROOT: root, MDE_OPENCODE_STATUS_PROTOCOL: '1' },
    })
    const hooks = await plugin()
    const read = async () => JSON.parse(await fs.readFile(file, 'utf8'))
    try {
      await vi.waitFor(async () => expect(await read()).toMatchObject({ status: 'idle' }))
      await hooks.event({ event: { type: 'session.created', properties: { info: { id: 'ses_test', title: 'Task title' } } } })
      await hooks.event({ event: { type: 'session.status', properties: { sessionID: 'ses_test', status: { type: 'busy' }, secret: 'private prompt' } } })
      await vi.waitFor(async () => expect(await read()).toMatchObject({ status: 'working', title: 'Task title' }))
      await hooks.event({ event: { type: 'permission.asked', properties: { sessionID: 'ses_test', requestID: 'request' } } })
      await vi.waitFor(async () => expect(await read()).toMatchObject({ status: 'attention', attentionReason: 'permission' }))
      await hooks.event({ event: { type: 'permission.replied', properties: { requestID: 'request' } } })
      await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'ses_test' } } })
      await vi.waitFor(async () => expect(await read()).toMatchObject({ status: 'completed' }))
      expect(await fs.readFile(file, 'utf8')).not.toContain('private prompt')
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
    } finally {
      await hooks.dispose()
    }
    expect(await read()).toMatchObject({ closed: true })
    if (process.platform === 'darwin') expect((await read()).processStartedAt).toBeTruthy()
  })

  it('installs, updates, and removes only MDE-owned source in the selected config directory', async () => {
    const config = await temporaryDirectory()
    const manager = new OpenCodeTuiStatusManager({ onStatus: vi.fn(), onInstances: vi.fn() }, {
      platform: 'darwin', nativeConfigDirectory: async () => config,
    })
    const target = { kind: 'native' } as const
    expect((await manager.pluginState(target)).status).toBe('not-installed')
    expect(await manager.installPlugin(target)).toMatchObject({ target, status: 'installed', currentVersion: TUI_STATUS_PLUGIN_VERSION })
    const file = join(config, 'plugins', 'mde-status.js')
    await fs.writeFile(file, TUI_STATUS_PLUGIN_SOURCE.replace(`version: ${TUI_STATUS_PLUGIN_VERSION}`, 'version: 0.0.1'))
    expect((await manager.pluginState(target)).status).toBe('outdated')
    expect((await manager.installPlugin(target)).status).toBe('installed')
    expect((await manager.removePlugin(target)).status).toBe('not-installed')
    await fs.writeFile(file, 'export const Unrelated = () => ({})')
    await expect(manager.installPlugin(target)).rejects.toThrow('Refusing to overwrite')
    await expect(manager.removePlugin(target)).rejects.toThrow('Refusing to remove')
    expect(await fs.readFile(file, 'utf8')).toContain('Unrelated')
  })

  it.skipIf(process.platform === 'win32')('tracks multiple Mac instances and clears a stale process after PID reuse', async () => {
    const config = await temporaryDirectory()
    let now = Date.now()
    const onInstances = vi.fn()
    const probeNativeProcess = vi.fn(async () => 'absent' as const)
    const manager = new OpenCodeTuiStatusManager({ onStatus: vi.fn(), onInstances }, {
      platform: 'darwin', nativeConfigDirectory: async () => config, now: () => now, probeNativeProcess,
    })
    managers.push(manager)
    await manager.configure(config)
    await manager.setEnabled(true)
    const first = manager.prepare('first', native)!
    const second = manager.prepare('second', native)!
    expect(first.MDE_OPENCODE_STATUS_FILE).not.toBe(second.MDE_OPENCODE_STATUS_FILE)
    expect((await fs.stat(first.MDE_OPENCODE_STATUS_ROOT!)).mode & 0o777).toBe(0o700)
    const startedAt = 'Wed Oct 14 12:00:00 2026'
    for (const env of [first, second]) {
      await fs.writeFile(env.MDE_OPENCODE_STATUS_FILE!, JSON.stringify({
        protocol: 1, status: 'working', title: 'A task', revision: 1, updatedAt: now,
        processId: 42, processStartedAt: startedAt,
      }))
    }
    const internals = manager as unknown as { poll(terminalId: string): Promise<void> }
    await internals.poll('first')
    await internals.poll('second')
    expect(onInstances.mock.calls.at(-1)?.[0].instances).toHaveLength(2)
    now += TUI_STATUS_STALE_MS + 1
    await internals.poll('first')
    expect(probeNativeProcess).toHaveBeenCalledWith(42, startedAt)
    expect(onInstances.mock.calls.at(-1)?.[0].instances).toHaveLength(1)
    await fs.writeFile(second.MDE_OPENCODE_STATUS_FILE!, JSON.stringify({
      protocol: 1, status: 'idle', revision: 2, updatedAt: now, processId: 42, processStartedAt: startedAt, closed: true,
    }))
    await internals.poll('second')
    expect(onInstances.mock.calls.at(-1)?.[0].instances).toHaveLength(0)
    await manager.setEnabled(false)
    expect(manager.prepare('disabled', native)).toBeUndefined()
  })

  it('validates Mac process identities while retaining legacy snapshot support', () => {
    const snapshot = { protocol: 1, status: 'idle', revision: 0, updatedAt: Date.now() }
    expect(decodeTuiStatusSnapshot(snapshot)).not.toBeNull()
    expect(decodeTuiStatusSnapshot({ ...snapshot, processId: 42, processStartTicks: 5 })).not.toBeNull()
    expect(decodeTuiStatusSnapshot({ ...snapshot, processId: 42, processStartedAt: 'Wed Oct 14 12:00:00 2026' })).not.toBeNull()
    expect(decodeTuiStatusSnapshot({ ...snapshot, processId: 42, processStartedAt: 'bad' })).toBeNull()
    expect(decodeTuiStatusSnapshot({ ...snapshot, processId: 42 })).toBeNull()
  })

  it.skipIf(process.platform !== 'darwin')('checks the real Mac process start time rather than just its PID', async () => {
    const startedAt = execFileSync('/bin/ps', ['-p', String(process.pid), '-o', 'lstart='], {
      encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' },
    }).trim().replace(/\s+/g, ' ')
    expect(await probeMacTuiProcess(process.pid, startedAt)).toBe('alive')
    expect(await probeMacTuiProcess(process.pid, 'Wed Oct 14 00:00:00 2000')).toBe('absent')
    expect(await probeMacTuiProcess(0, startedAt)).toBe('unknown')
  })
})
