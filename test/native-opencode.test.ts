import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nativeLoginEnvironment, openCodeConfigDirectory } from '../src/main/native-environment'
import { buildLaunchSpec } from '../src/main/pty/launch'
import { metadataQueryLaunch, parseMetadataOutput } from '../src/main/opencode/sessions'
import {
  decodeTuiStatusSnapshot,
  OpenCodeTuiStatusManager,
  probeMacTuiProcess,
  TUI_STATUS_PLUGIN_MARKER,
  TUI_STATUS_PLUGIN_VERSION,
  TUI_STATUS_SERVER_SOURCE,
  TUI_STATUS_STALE_MS,
  TUI_STATUS_TUI_SOURCE,
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
    expect(openCodeConfigDirectory({ XDG_CONFIG_HOME: '/tmp/xdg' }, '/home/me')).toBe(join('/tmp/xdg', 'opencode'))
    expect(openCodeConfigDirectory({ XDG_CONFIG_HOME: 'relative' }, '/home/me')).toBe(join('/home/me', '.config', 'opencode'))
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

interface PluginHarness {
  file: string
  emit(type: string, data: Record<string, unknown>): void
  read(): Promise<Record<string, unknown>>
  setRoute(sessionID?: string): void
  stop(): Promise<void>
}

/** Runs the real plugin source against a stand-in for OpenCode's terminal plugin context. */
async function startStatusPlugin(sessions: Record<string, { parentID?: string; title?: string }>): Promise<PluginHarness> {
  const root = await temporaryDirectory()
  const file = join(root, 'status.json')
  const module = join(await temporaryDirectory(), 'tui.mjs')
  await fs.writeFile(module, TUI_STATUS_TUI_SOURCE)
  vi.stubEnv('MDE_OPENCODE_STATUS_FILE', file)
  vi.stubEnv('MDE_OPENCODE_STATUS_ROOT', root)
  vi.stubEnv('MDE_OPENCODE_STATUS_PROTOCOL', '1')
  const plugin = (await import(/* @vite-ignore */ pathToFileURL(module).href)).default
  const handlers = new Map<string, Array<(event: unknown) => void>>()
  let route: { type: string; sessionID?: string } = { type: 'home' }
  const rootOf = (id: string): string => {
    let current = id
    while (sessions[current]?.parentID) current = sessions[current]!.parentID!
    return current
  }
  const cleanup = await plugin.setup({
    data: {
      on: (type: string, handler: (event: unknown) => void) => {
        handlers.set(type, [...(handlers.get(type) ?? []), handler])
        return () => handlers.set(type, (handlers.get(type) ?? []).filter((item) => item !== handler))
      },
      session: {
        root: rootOf,
        get: (id: string) => sessions[id] && { id, ...sessions[id] },
        status: () => 'running',
        permission: { list: () => undefined },
        form: { list: () => undefined },
      },
    },
    // The tab list holds every root session of a directory, so the plugin must not read it.
    ui: {
      router: { current: () => route },
      tabs: { enabled: () => true, list: () => Object.keys(sessions).map((sessionID) => ({ sessionID })) },
    },
  })
  return {
    file,
    emit: (type, data) => (handlers.get(type) ?? []).forEach((handler) => handler({ type, data })),
    read: async () => JSON.parse(await fs.readFile(file, 'utf8')),
    setRoute: (sessionID) => { route = sessionID ? { type: 'session', sessionID } : { type: 'home' } },
    stop: async () => { await cleanup() },
  }
}

describe('native status plugin management', () => {
  afterEach(() => vi.unstubAllEnvs())

  it.skipIf(process.platform === 'win32')('publishes real plugin events, heartbeat identity, and shutdown without leaking event contents', async () => {
    const plugin = await startStatusPlugin({ ses_root: { title: '  Task\n title ' }, ses_child: { parentID: 'ses_root' } })
    const { read } = plugin
    try {
      await vi.waitFor(async () => expect(await read()).toMatchObject({ status: 'idle' }))
      plugin.setRoute('ses_root')
      plugin.emit('session.execution.started', { sessionID: 'ses_root', secret: 'private prompt' })
      await vi.waitFor(async () => expect(await read()).toMatchObject({ status: 'working', title: 'Task title' }))
      plugin.emit('permission.asked', { id: 'request', sessionID: 'ses_child', metadata: { secret: 'private prompt' } })
      await vi.waitFor(async () => expect(await read()).toMatchObject({ status: 'attention', attentionReason: 'permission' }))
      plugin.emit('permission.replied', { requestID: 'request', sessionID: 'ses_child' })
      await vi.waitFor(async () => expect(await read()).toMatchObject({ status: 'working' }))
      plugin.emit('form.created', { form: { id: 'form', sessionID: 'ses_root', title: 'private prompt' } })
      await vi.waitFor(async () => expect(await read()).toMatchObject({ status: 'attention', attentionReason: 'question' }))
      plugin.emit('form.replied', { id: 'form', sessionID: 'ses_root', answer: { value: 'private prompt' } })
      plugin.emit('session.execution.succeeded', { sessionID: 'ses_root' })
      await vi.waitFor(async () => expect(await read()).toMatchObject({ status: 'completed' }))
      plugin.emit('session.execution.started', { sessionID: 'ses_root' })
      plugin.emit('session.execution.failed', { sessionID: 'ses_root', error: { message: 'private prompt' } })
      await vi.waitFor(async () => expect(await read()).toMatchObject({ status: 'error' }))
      expect(await fs.readFile(plugin.file, 'utf8')).not.toContain('private prompt')
      expect((await fs.stat(plugin.file)).mode & 0o777).toBe(0o600)
    } finally {
      await plugin.stop()
    }
    expect(await read()).toMatchObject({ closed: true })
    if (process.platform === 'darwin') expect((await read()).processStartedAt).toBeTruthy()
  })

  it.skipIf(process.platform === 'win32')('ignores sessions this terminal never showed, even when the service reports them', async () => {
    const plugin = await startStatusPlugin({ ses_mine: {}, ses_other: {} })
    try {
      await vi.waitFor(async () => expect(await plugin.read()).toMatchObject({ status: 'idle' }))
      // Another terminal's work reaches every terminal through OpenCode's shared service.
      plugin.emit('session.execution.started', { sessionID: 'ses_other' })
      plugin.emit('permission.asked', { id: 'foreign', sessionID: 'ses_other' })
      plugin.emit('form.created', { form: { id: 'foreign-form', sessionID: 'ses_other' } })
      await new Promise((resolve) => setTimeout(resolve, 1300))
      expect(await plugin.read()).toMatchObject({ status: 'idle', revision: 0 })
      // Showing the session adopts what is already running there.
      plugin.setRoute('ses_other')
      await vi.waitFor(async () => expect(await plugin.read()).toMatchObject({ status: 'attention', attentionReason: 'permission' }), { timeout: 3000 })
      plugin.emit('permission.replied', { requestID: 'foreign' })
      plugin.emit('form.cancelled', { id: 'foreign-form', sessionID: 'ses_other' })
      await vi.waitFor(async () => expect(await plugin.read()).toMatchObject({ status: 'working' }))
      plugin.setRoute('ses_mine')
      plugin.emit('session.deleted', { sessionID: 'ses_other' })
      await vi.waitFor(async () => expect(await plugin.read()).toMatchObject({ status: 'completed' }), { timeout: 3000 })
    } finally {
      await plugin.stop()
    }
  })

  it('stays inert without the MDE environment', async () => {
    vi.stubEnv('MDE_OPENCODE_STATUS_FILE', '')
    const module = join(await temporaryDirectory(), 'tui.mjs')
    await fs.writeFile(module, TUI_STATUS_TUI_SOURCE)
    const plugin = (await import(/* @vite-ignore */ pathToFileURL(module).href)).default
    const on = vi.fn()
    expect(await plugin.setup({ data: { on } })).toBeUndefined()
    expect(on).not.toHaveBeenCalled()
  })

  it('installs, updates, and removes only MDE-owned plugin files in the selected config directory', async () => {
    const config = await temporaryDirectory()
    const manager = new OpenCodeTuiStatusManager({ onStatus: vi.fn(), onInstances: vi.fn() }, {
      platform: 'darwin', nativeConfigDirectory: async () => config,
    })
    const target = { kind: 'native' } as const
    const directory = join(config, 'plugins', 'mde-status')
    const tui = join(directory, 'tui.js')
    expect((await manager.pluginState(target)).status).toBe('not-installed')
    expect(await manager.installPlugin(target)).toMatchObject({ target, status: 'installed', currentVersion: TUI_STATUS_PLUGIN_VERSION })
    expect(await fs.readFile(tui, 'utf8')).toBe(TUI_STATUS_TUI_SOURCE)
    expect(await fs.readFile(join(directory, 'index.js'), 'utf8')).toBe(TUI_STATUS_SERVER_SOURCE)
    await fs.writeFile(tui, TUI_STATUS_TUI_SOURCE.replace(`version: ${TUI_STATUS_PLUGIN_VERSION}`, 'version: 0.0.1'))
    expect(await manager.pluginState(target)).toMatchObject({ status: 'outdated', installedVersion: '0.0.1' })
    expect((await manager.installPlugin(target)).status).toBe('installed')
    await fs.rm(join(directory, 'index.js'))
    expect((await manager.pluginState(target)).status).toBe('outdated')
    expect((await manager.installPlugin(target)).status).toBe('installed')
    expect((await manager.removePlugin(target)).status).toBe('not-installed')
    await expect(fs.access(directory)).rejects.toThrow()

    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(tui, 'export default { id: "unrelated", setup() {} }')
    expect((await manager.pluginState(target)).status).toBe('conflict')
    await expect(manager.installPlugin(target)).rejects.toThrow('Refusing to overwrite')
    await expect(manager.removePlugin(target)).rejects.toThrow('Refusing to remove')
    expect(await fs.readFile(tui, 'utf8')).toContain('unrelated')
    await fs.rm(tui)
    await fs.writeFile(join(directory, 'notes.txt'), 'mine')
    await manager.installPlugin(target)
    await manager.removePlugin(target)
    expect(await fs.readFile(join(directory, 'notes.txt'), 'utf8')).toBe('mine')
  })

  it('replaces the OpenCode 1 plugin file that OpenCode 2 cannot load, but never a foreign one', async () => {
    const config = await temporaryDirectory()
    const manager = new OpenCodeTuiStatusManager({ onStatus: vi.fn(), onInstances: vi.fn() }, {
      platform: 'darwin', nativeConfigDirectory: async () => config,
    })
    const target = { kind: 'native' } as const
    const legacy = join(config, 'plugins', 'mde-status.js')
    await fs.mkdir(join(config, 'plugins'), { recursive: true })
    await fs.writeFile(legacy, `// ${TUI_STATUS_PLUGIN_MARKER}\n// mde-opencode-tui-status-plugin-version: 1.3.0\nexport const MdeTuiStatus = async () => ({})\n`)
    expect(await manager.pluginState(target)).toMatchObject({ status: 'outdated', installedVersion: '1.3.0' })
    expect((await manager.installPlugin(target)).status).toBe('installed')
    await expect(fs.access(legacy)).rejects.toThrow()

    await manager.removePlugin(target)
    await fs.writeFile(legacy, 'export const SomeoneElse = async () => ({})')
    expect((await manager.pluginState(target)).status).toBe('not-installed')
    expect((await manager.installPlugin(target)).status).toBe('installed')
    expect(await fs.readFile(legacy, 'utf8')).toContain('SomeoneElse')
    await manager.removePlugin(target)
    expect(await fs.readFile(legacy, 'utf8')).toContain('SomeoneElse')

    await fs.rm(legacy)
    await manager.installPlugin(target)
    await fs.writeFile(legacy, `// ${TUI_STATUS_PLUGIN_MARKER}\n`)
    expect((await manager.pluginState(target)).status).toBe('outdated')
    await manager.removePlugin(target)
    await expect(fs.access(legacy)).rejects.toThrow()
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
