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
    projectId: 'project-1',
    name: 'App',
    kind: 'native',
    path: '/tmp/app',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
}

function wslSession(): Session {
  return {
    ...sourceSession(),
    kind: 'wsl',
    distro: 'Ubuntu-24.04',
    path: '/home/me/app'
  }
}

describe('PtyManager runtime terminal identities', () => {
  beforeEach(() => {
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

  it('applies launch integration environment to native shells and disposes it', () => {
    const integration = {
      prepare: vi.fn(() => ({ MDE_OPENCODE_TOKEN_RATE: '1' })),
      dispose: vi.fn()
    }
    const manager = new PtyManager({ onData: vi.fn(), onDirectory: vi.fn(), onExit: vi.fn() }, integration)

    manager.ensure('pane-a', sourceSession(), { cols: 80, rows: 24 }, palette)

    expect(ptyMock.spawn.mock.calls[0]?.[2]).toMatchObject({
      env: expect.objectContaining({ MDE_OPENCODE_TOKEN_RATE: '1' })
    })
    manager.dispose('pane-a')
    expect(integration.dispose).toHaveBeenCalledWith('pane-a')
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

  it('reports the WSL launch directory before the first prompt', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const events = { onData: vi.fn(), onDirectory: vi.fn(), onExit: vi.fn() }
    const manager = new PtyManager(events)

    manager.ensure('pane-a', wslSession(), { cols: 80, rows: 24 }, palette)

    expect(events.onDirectory).toHaveBeenCalledWith({
      terminalId: 'pane-a',
      directory: '/home/me/app'
    })
    expect(manager.directories()).toEqual({ 'pane-a': '/home/me/app' })
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
    expect(ptyMock.spawn.mock.calls[0]?.[2]).toMatchObject({
      useConpty: true,
      useConptyDll: true,
    })
  })

  it('does not request a Windows backend on non-Windows platforms', () => {
    const manager = new PtyManager({ onData: vi.fn(), onDirectory: vi.fn(), onExit: vi.fn() })

    manager.ensure('pane-a', sourceSession(), { cols: 80, rows: 24 }, palette)

    expect(ptyMock.spawn.mock.calls[0]?.[2]).not.toHaveProperty('useConpty')
    expect(ptyMock.spawn.mock.calls[0]?.[2]).not.toHaveProperty('useConptyDll')
  })

  it('falls back to inbox ConPTY when the bundled backend cannot initialize', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    ptyMock.spawn
      .mockImplementationOnce(() => {
        throw new Error('Cannot find conpty.dll at expected path')
      })
      .mockImplementationOnce(() => createFakeChild())
    const manager = new PtyManager({ onData: vi.fn(), onDirectory: vi.fn(), onExit: vi.fn() })

    manager.ensure('pane-a', sourceSession(), { cols: 80, rows: 24 }, palette)

    expect(ptyMock.spawn).toHaveBeenCalledTimes(2)
    expect(ptyMock.spawn.mock.calls[0]?.[2]).toMatchObject({
      useConptyDll: true,
    })
    expect(ptyMock.spawn.mock.calls[1]?.[2]).toMatchObject({
      useConptyDll: false,
    })
    expect(warning).toHaveBeenCalledOnce()
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
