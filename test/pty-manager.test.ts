import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@shared/types'

type FakeChild = {
  dataListener?: (data: string) => void
  exitListener?: (info: { exitCode: number; signal?: number }) => void
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  onData: (listener: (data: string) => void) => { dispose: ReturnType<typeof vi.fn> }
  onExit: (listener: (info: { exitCode: number; signal?: number }) => void) => {
    dispose: ReturnType<typeof vi.fn>
  }
}

const ptyMock = vi.hoisted(() => ({
  children: new Map<string, FakeChild>(),
  spawn: vi.fn()
}))

vi.mock('node-pty', () => ({ spawn: ptyMock.spawn }))

import { PtyManager } from '../src/main/pty/manager'
import { TerminalDirectoryStore } from '../src/main/pty/directories'

import * as hostExecutables from '../src/main/windows-executable'

const wslExecutable = { file: 'D:\\Windows\\System32\\wsl.exe', cwd: 'D:\\Windows\\System32' }
const powershell = 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

const palette = { foreground: '#d8dee9', background: '#0b0e13' }

function createFakeChild(): FakeChild {
  const child = {} as FakeChild
  child.write = vi.fn()
  child.resize = vi.fn()
  child.kill = vi.fn()
  child.onData = (listener) => {
    child.dataListener = listener
    return { dispose: vi.fn() }
  }
  child.onExit = (listener) => {
    child.exitListener = listener
    return { dispose: vi.fn() }
  }
  ptyMock.children.set(`pane-${ptyMock.children.size + 1}`, child)
  return child
}

function sourceSession(): Session {
  return {
    id: 'session-1',
    name: 'App',
    kind: 'native',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
}

function wslSession(): Session {
  return {
    ...sourceSession(),
    kind: 'wsl',
    distro: 'Ubuntu-24.04',

  }
}

describe('PtyManager runtime terminal identities', () => {
  beforeEach(() => {
    vi.spyOn(hostExecutables, 'resolveWslExecutable').mockReturnValue(wslExecutable)
    vi.spyOn(hostExecutables, 'resolveWindowsShell').mockReturnValue(powershell)
    ptyMock.children.clear()
    ptyMock.spawn.mockReset()
    ptyMock.spawn.mockImplementation((file: string, args: string[], options: unknown) => {
      void file
      void args
      void options
      return createFakeChild()
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('routes independent panes launched from one workspace session', () => {
    const events = { onData: vi.fn(), onDirectory: vi.fn(), onExit: vi.fn() }
    const manager = new PtyManager(events)
    const source = sourceSession()
    const size = { cols: 80, rows: 24 }

    manager.ensure('pane-a', source, size, palette)
    manager.ensure('pane-b', source, size, palette)

    expect(ptyMock.spawn).toHaveBeenCalledTimes(2)
    const first = ptyMock.children.get('pane-1')
    const second = ptyMock.children.get('pane-2')
    first?.dataListener?.('first')
    second?.dataListener?.('second')
    expect(events.onData).toHaveBeenNthCalledWith(1, { terminalId: 'pane-a', data: 'first' })
    expect(events.onData).toHaveBeenNthCalledWith(2, { terminalId: 'pane-b', data: 'second' })

    manager.write('pane-a', 'input')
    manager.resize('pane-b', { cols: 120, rows: 30 })
    expect(first?.write).toHaveBeenCalledWith('input')
    expect(second?.resize).toHaveBeenCalledWith(120, 30)

    first?.exitListener?.({ exitCode: 0 })
    expect(events.onExit).toHaveBeenCalledWith({
      sessionId: 'session-1',
      terminalId: 'pane-a',
      exitCode: 0
    })
  })

  it('synchronizes an existing PTY size when the renderer reattaches', () => {
    const manager = new PtyManager({ onData: vi.fn(), onDirectory: vi.fn(), onExit: vi.fn() })
    const source = sourceSession()

    manager.ensure('pane-a', source, { cols: 80, rows: 24 }, palette)
    const child = ptyMock.children.get('pane-1')
    manager.ensure('pane-a', source, { cols: 140, rows: 42 }, palette)

    expect(ptyMock.spawn).toHaveBeenCalledOnce()
    expect(child?.resize).toHaveBeenCalledOnce()
    expect(child?.resize).toHaveBeenCalledWith(140, 42)
  })

  it.each(['darwin', 'win32'] as const)('keeps terminal service credentials out of argv on %s', (platform) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
    const previousWslEnv = process.env.WSLENV
    process.env.WSLENV = 'KEEP/u:OPENCODE_PASSWORD/p'
    try {
      const manager = new PtyManager({ onData: vi.fn(), onDirectory: vi.fn(), onExit: vi.fn() })
      manager.ensure('inbox-thread:ses_one', platform === 'win32' ? wslSession() : sourceSession(), { cols: 80, rows: 24 }, palette, {
        agent: { executable: 'opencode', args: ['--server', 'http://127.0.0.1:49374', '--session', 'ses_one'] },
        environment: { OPENCODE_PASSWORD: 'test-password' },
      })
      const [, args, options] = ptyMock.spawn.mock.calls[0] as [string, string[], { env: Record<string, string> }]
      expect(args.join(' ')).not.toContain('test-password')
      expect(args.join(' ')).not.toContain('OPENCODE_PASSWORD')
      expect(options.env.OPENCODE_PASSWORD).toBe('test-password')
      if (platform === 'win32') expect(options.env.WSLENV).toBe('KEEP/u:OPENCODE_PASSWORD/u')
      expect(process.env.OPENCODE_PASSWORD).not.toBe('test-password')
      manager.disposeAll()
    } finally {
      if (previousWslEnv === undefined) delete process.env.WSLENV
      else process.env.WSLENV = previousWslEnv
    }
  })

  it('restarts and disposes panes independently', () => {
    const manager = new PtyManager({ onData: vi.fn(), onDirectory: vi.fn(), onExit: vi.fn() })
    const source = sourceSession()
    manager.ensure('pane-a', source, { cols: 80, rows: 24 }, palette)
    manager.ensure('pane-b', source, { cols: 80, rows: 24 }, palette)
    const first = ptyMock.children.get('pane-1')
    const second = ptyMock.children.get('pane-2')

    manager.restart('pane-a', source, { cols: 100, rows: 25 }, palette)
    expect(first?.kill).toHaveBeenCalledTimes(1)
    expect(ptyMock.spawn).toHaveBeenCalledTimes(3)
    expect(manager.status('pane-a')).toBe('running')

    manager.dispose('pane-b')
    expect(second?.kill).toHaveBeenCalledTimes(1)
    expect(manager.status('pane-b')).toBe('none')
    expect(manager.status('pane-a')).toBe('running')
  })

  it('restarts a pane into the launch directory and agent it is given', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const manager = new PtyManager({ onData: vi.fn(), onDirectory: vi.fn(), onExit: vi.fn() })
    const source = wslSession()
    manager.ensure('pane-a', source, { cols: 80, rows: 24 }, palette)
    const first = ptyMock.children.get('pane-1')

    manager.restart('pane-a', source, { cols: 80, rows: 24 }, palette, {
      directory: '/home/me/other',
      agent: { executable: 'opencode', args: ['--session', 'ses_chosen'] }
    })

    expect(first?.kill).toHaveBeenCalledTimes(1)
    expect(ptyMock.spawn).toHaveBeenCalledTimes(2)
    const [file, args] = ptyMock.spawn.mock.calls[1] as [string, string[]]
    expect(file).toBe(wslExecutable.file)
    expect(ptyMock.spawn.mock.calls[1]?.[2]).toMatchObject({ cwd: wslExecutable.cwd })
    expect(args).toEqual(expect.arrayContaining(['--cd', '/home/me/other', 'opencode', '--session', 'ses_chosen']))
  })

  it('disposes every runtime terminal belonging to one source session', () => {
    const manager = new PtyManager({ onData: vi.fn(), onDirectory: vi.fn(), onExit: vi.fn() })
    const source = sourceSession()
    const other = { ...source, id: 'session-2' }
    manager.ensure('pane-a', source, { cols: 80, rows: 24 }, palette)
    manager.ensure('pane-b', source, { cols: 80, rows: 24 }, palette)
    manager.ensure('pane-c', other, { cols: 80, rows: 24 }, palette)
    const first = ptyMock.children.get('pane-1')
    const second = ptyMock.children.get('pane-2')
    const third = ptyMock.children.get('pane-3')

    manager.disposeForSourceSession(source.id)

    expect(first?.kill).toHaveBeenCalledTimes(1)
    expect(second?.kill).toHaveBeenCalledTimes(1)
    expect(third?.kill).not.toHaveBeenCalled()
    expect(manager.status('pane-a')).toBe('none')
    expect(manager.status('pane-b')).toBe('none')
    expect(manager.status('pane-c')).toBe('running')
  })

  it('answers palette queries directly at the PTY boundary', () => {
    const events = { onData: vi.fn(), onDirectory: vi.fn(), onExit: vi.fn() }
    const manager = new PtyManager(events)
    manager.ensure('pane-a', sourceSession(), { cols: 80, rows: 24 }, palette)
    const child = ptyMock.children.get('pane-1')

    child?.dataListener?.('before\u001b]11;?\u001b\\after')

    expect(child?.write).toHaveBeenCalledWith(
      '\u001b]11;rgb:0b0b/0e0e/1313\u001b\\'
    )
    expect(events.onData).toHaveBeenCalledWith({
      terminalId: 'pane-a',
      data: 'beforeafter'
    })
  })

  it('tracks current directories independently for split panes', () => {
    const events = { onData: vi.fn(), onDirectory: vi.fn(), onExit: vi.fn() }
    const manager = new PtyManager(events)
    const source = sourceSession()
    manager.ensure('pane-a', source, { cols: 80, rows: 24 }, palette)
    manager.ensure('pane-b', source, { cols: 80, rows: 24 }, palette)

    expect(manager.terminalInfo('pane-a')?.directory).toBe(homedir())
    events.onDirectory.mockClear()
    ptyMock.children.get('pane-1')?.dataListener?.('\u001b]7;file://localhost/home/me/a\u0007')
    ptyMock.children.get('pane-2')?.dataListener?.('\u001b]7;file:///tmp/b\u001b\\')

    expect(events.onDirectory).toHaveBeenNthCalledWith(1, {
      terminalId: 'pane-a',
      directory: '/home/me/a'
    })
    expect(events.onDirectory).toHaveBeenNthCalledWith(2, {
      terminalId: 'pane-b',
      directory: '/tmp/b'
    })
    expect(manager.terminalInfo('pane-a')).toEqual({
      sessionId: 'session-1',
      directory: '/home/me/a'
    })
    expect(manager.terminalInfo('pane-b')).toEqual({
      sessionId: 'session-1',
      directory: '/tmp/b'
    })
    expect(manager.directories()).toEqual({
      'pane-a': '/home/me/a',
      'pane-b': '/tmp/b'
    })

    manager.dispose('pane-a')
    expect(events.onDirectory).toHaveBeenLastCalledWith({ terminalId: 'pane-a', directory: null })
    expect(manager.terminalInfo('pane-a')).toBeNull()
    expect(manager.directories()).toEqual({ 'pane-b': '/tmp/b' })
  })

  it('waits for a WSL shell to report its home directory', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const events = { onData: vi.fn(), onDirectory: vi.fn(), onExit: vi.fn() }
    const manager = new PtyManager(events)

    manager.ensure('pane-a', wslSession(), { cols: 80, rows: 24 }, palette)

    expect(ptyMock.spawn.mock.calls[0]?.[1]?.slice(2, 4)).toEqual(['--cd', '~'])
    expect(events.onDirectory).not.toHaveBeenCalled()
    expect(manager.directories()).toEqual({})
    ptyMock.children.get('pane-1')?.dataListener?.('\u001b]7;file://localhost/home/me/app\u0007')
    expect(events.onDirectory).toHaveBeenCalledWith({ terminalId: 'pane-a', directory: '/home/me/app' })
    expect(manager.directories()).toEqual({ 'pane-a': '/home/me/app' })
  })

  it('retains reported directories at shutdown and forgets panes explicitly removed later', async () => {
    const saved = new TerminalDirectoryStore()
    const events = { onData: vi.fn(), onDirectory: vi.fn(), onExit: vi.fn() }
    const manager = new PtyManager(events, saved)
    const source = sourceSession()
    manager.ensure('pane-a', source, { cols: 80, rows: 24 }, palette)
    manager.ensure('pane-b', source, { cols: 80, rows: 24 }, palette)
    const first = join(tmpdir(), 'mde-first')
    const second = join(tmpdir(), 'mde-second')
    ptyMock.children.get('pane-1')?.dataListener?.(`\u001b]7;${pathToFileURL(first).href}\u0007`)
    ptyMock.children.get('pane-2')?.dataListener?.(`\u001b]7;${pathToFileURL(second).href}\u0007`)
    manager.disposeAll()

    const nextRun = new PtyManager(events, saved)
    expect(nextRun.savedDirectory('pane-a', source)).toBe(first)
    expect(nextRun.savedDirectory('pane-b', source)).toBe(second)
    nextRun.dispose('pane-a')
    expect(nextRun.savedDirectory('pane-a', source)).toBeUndefined()
    expect(nextRun.savedDirectory('pane-b', source)).toBe(second)
    await saved.flush()
  })

  it('updates the stored WSL directory after a prompt reports cd', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const events = { onData: vi.fn(), onDirectory: vi.fn(), onExit: vi.fn() }
    const manager = new PtyManager(events)
    manager.ensure('pane-a', wslSession(), { cols: 80, rows: 24 }, palette)
    const child = ptyMock.children.get('pane-1')

    child?.dataListener?.('\u001b]7;file://localhost/home/me/other\u0007')

    expect(manager.terminalInfo('pane-a')).toEqual({
      sessionId: 'session-1',
      directory: '/home/me/other'
    })
    expect(events.onDirectory).toHaveBeenLastCalledWith({
      terminalId: 'pane-a',
      directory: '/home/me/other'
    })
  })

  it('uses bundled ConPTY for Windows terminals', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const manager = new PtyManager({ onData: vi.fn(), onDirectory: vi.fn(), onExit: vi.fn() })

    manager.ensure('pane-a', sourceSession(), { cols: 80, rows: 24 }, palette)

    expect(ptyMock.spawn).toHaveBeenCalledOnce()
    expect(ptyMock.spawn.mock.calls[0]?.[0]).toBe(powershell)
    expect(ptyMock.spawn.mock.calls[0]?.[2]).toMatchObject({
      useConpty: true,
      useConptyDll: true,
    })
  })

  it('rejects unavailable host executables before creating PTYs', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.mocked(hostExecutables.resolveWslExecutable).mockImplementation(() => {
      throw new Error('Windows WSL executable is unavailable')
    })
    const manager = new PtyManager({ onData: vi.fn(), onDirectory: vi.fn(), onExit: vi.fn() })
    expect(() => manager.ensure('pane-a', wslSession(), { cols: 80, rows: 24 }, palette)).toThrow('WSL executable is unavailable')
    expect(ptyMock.spawn).not.toHaveBeenCalled()
  })

  it.each(['linux', 'darwin'] as const)('does not request a Windows backend on %s', (platform) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
    const manager = new PtyManager({ onData: vi.fn(), onDirectory: vi.fn(), onExit: vi.fn() })

    manager.ensure('pane-a', sourceSession(), { cols: 80, rows: 24 }, palette)

    expect(ptyMock.spawn.mock.calls[0]?.[2]).not.toHaveProperty('useConpty')
    expect(ptyMock.spawn.mock.calls[0]?.[2]).not.toHaveProperty('useConptyDll')
  })

  it('fails closed when the bundled ConPTY backend cannot initialize', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    ptyMock.spawn
      .mockImplementationOnce(() => {
        throw new Error('Cannot find conpty.dll at expected path')
      })
    const manager = new PtyManager({ onData: vi.fn(), onDirectory: vi.fn(), onExit: vi.fn() })

    expect(() => (
      manager.ensure('pane-a', sourceSession(), { cols: 80, rows: 24 }, palette)
    )).toThrow('Cannot find conpty.dll at expected path')

    expect(ptyMock.spawn).toHaveBeenCalledOnce()
    expect(ptyMock.spawn.mock.calls[0]?.[2]).toMatchObject({
      useConptyDll: true,
    })
  })

  it('does not mask unrelated Windows launch failures with a retry', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    ptyMock.spawn.mockImplementationOnce(() => {
      throw new Error('File not found: missing-shell.exe')
    })
    const manager = new PtyManager({ onData: vi.fn(), onDirectory: vi.fn(), onExit: vi.fn() })

    expect(() => (
      manager.ensure('pane-a', sourceSession(), { cols: 80, rows: 24 }, palette)
    )).toThrow('File not found: missing-shell.exe')
    expect(ptyMock.spawn).toHaveBeenCalledOnce()
  })
})
