import { trustedIpcSender } from './helpers/ipc-sender'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, request: unknown) => Promise<unknown> | unknown

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, Handler>()
  return {
    handlers,
    app: { getVersion: vi.fn(() => '0.0.1') },
    BrowserWindow: { fromWebContents: vi.fn() },
    clipboard: { writeText: vi.fn() },
    dialog: { showErrorBox: vi.fn(), showOpenDialog: vi.fn() },
    ipcMain: { handle: vi.fn((channel: string, handler: Handler) => { handlers.set(channel, handler) }) },
    shell: { openExternal: vi.fn(), openPath: vi.fn(async () => '') },
  }
})

vi.mock('electron', () => electronMock)
vi.mock('../src/main/wsl/distros', () => ({ isWslAvailable: vi.fn(), listDistros: vi.fn(), runWslCommand: vi.fn() }))

import { IpcChannels } from '../src/shared/ipc'
import { registerIpcHandlers } from '../src/main/ipc'
import { listDistros } from '../src/main/wsl/distros'

const { security, event: trustedEvent } = trustedIpcSender()
const draft = {
  permissions: [{ action: 'shell', resource: '*', effect: 'ask' }],
  customProviders: [],
  disabledProviders: ['opencode'],
}
const realPlatform = process.platform

function platform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

const call = (channel: string, request: unknown): Promise<unknown> | unknown => {
  const registered = electronMock.handlers.get(channel)
  if (!registered) throw new Error(`No handler registered for ${channel}`)
  return registered(trustedEvent, request)
}

describe('OpenCode configuration over IPC', () => {
  const openCodeConfig = { read: vi.fn(), preview: vi.fn(), save: vi.fn() }

  beforeEach(() => {
    electronMock.handlers.clear()
    for (const method of Object.values(openCodeConfig)) method.mockReset().mockResolvedValue({ ok: true })
    vi.mocked(listDistros).mockReset().mockResolvedValue([
      { name: 'Ubuntu-24.04', state: 'Running', version: 2, isDefault: true },
    ])
    registerIpcHandlers(security, {} as never, {} as never, {} as never, { openCodeConfig } as never)
  })

  afterEach(() => {
    platform(realPlatform)
  })

  it('reads, previews and saves on this computer where OpenCode runs natively', async () => {
    platform('darwin')
    await call(IpcChannels.opencodeConfigRead, { kind: 'native' })
    await call(IpcChannels.opencodeConfigPreview, { kind: 'native', draft })
    await call(IpcChannels.opencodeConfigSave, { kind: 'native', draft, revision: 'abc' })
    expect(openCodeConfig.read).toHaveBeenCalledWith({ kind: 'native' })
    expect(openCodeConfig.preview).toHaveBeenCalledWith({ kind: 'native' }, draft)
    expect(openCodeConfig.save).toHaveBeenCalledWith({ kind: 'native' }, draft, 'abc')
  })

  it('uses the named WSL distribution on Windows, using the name WSL itself reports', async () => {
    platform('win32')
    await call(IpcChannels.opencodeConfigRead, { kind: 'wsl', distro: 'Ubuntu-24.04' })
    expect(openCodeConfig.read).toHaveBeenCalledWith({ kind: 'wsl', distro: 'Ubuntu-24.04' })
  })

  it('refuses a WSL distribution that does not exist, and native on Windows', async () => {
    platform('win32')
    await expect(call(IpcChannels.opencodeConfigRead, { kind: 'wsl', distro: 'Debian' })).rejects.toThrow(/Debian was not found/)
    await expect(call(IpcChannels.opencodeConfigRead, { kind: 'native' })).rejects.toThrow(/runs in WSL/)
    await expect(call(IpcChannels.opencodeConfigSave, { kind: 'wsl', draft, revision: 'abc' })).rejects.toThrow(/runs in WSL/)
    expect(openCodeConfig.read).not.toHaveBeenCalled()
    expect(openCodeConfig.save).not.toHaveBeenCalled()
  })

  it('refuses WSL anywhere but Windows', async () => {
    platform('darwin')
    await expect(call(IpcChannels.opencodeConfigRead, { kind: 'wsl', distro: 'Ubuntu-24.04' })).rejects.toThrow(/only available on Windows/)
    expect(listDistros).not.toHaveBeenCalled()
  })

  it('rejects a request that names a path, before anything is read', async () => {
    platform('darwin')
    await expect(call(IpcChannels.opencodeConfigRead, { kind: 'native', path: '/etc/passwd' })).rejects.toThrow('Invalid IPC payload')
    await expect(call(IpcChannels.opencodeConfigSave, { kind: 'native', draft, revision: 'abc', path: '/etc/passwd' })).rejects.toThrow('Invalid IPC payload')
    expect(openCodeConfig.read).not.toHaveBeenCalled()
    expect(openCodeConfig.save).not.toHaveBeenCalled()
  })
})
