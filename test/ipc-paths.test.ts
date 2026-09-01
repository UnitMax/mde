import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../src/shared/types'

type Handler = (event: unknown, request: unknown) => Promise<unknown> | unknown
type TerminalInfo = { sessionId: string; directory: string | null }

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, Handler>()
  return {
    handlers,
    app: { getVersion: vi.fn(() => '0.0.1') },
    BrowserWindow: { fromWebContents: vi.fn() },
    clipboard: { writeText: vi.fn() },
    dialog: { showErrorBox: vi.fn(), showOpenDialog: vi.fn() },
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler)
      })
    },
    shell: {
      openExternal: vi.fn(),
      openPath: vi.fn(async () => '')
    }
  }
})

const workspaceMock = vi.hoisted(() => ({
  createProject: vi.fn(),
  createTodoProject: vi.fn(),
  createTodoTask: vi.fn(),
  createSession: vi.fn(),
  duplicateSession: vi.fn(),
  getSession: vi.fn(),
  loadWorkspace: vi.fn(),
  moveSession: vi.fn(),
  moveTodoTask: vi.fn(),
  removeProject: vi.fn(),
  removeTodoProject: vi.fn(),
  removeTodoTask: vi.fn(),
  removeSession: vi.fn(),
  reorderSession: vi.fn(),
  updateProject: vi.fn(),
  updateTodoProject: vi.fn(),
  updateTodoTask: vi.fn(),
  updateSession: vi.fn()
}))

const wslPathsMock = vi.hoisted(() => ({
  canonicalizeWslPath: vi.fn(),
  resolveForTarget: vi.fn(),
  toWindows: vi.fn(),
  uncPathFor: vi.fn()
}))

const wslDistrosMock = vi.hoisted(() => ({
  isWslAvailable: vi.fn(),
  listDistros: vi.fn(),
  runWslCommand: vi.fn()
}))

vi.mock('electron', () => electronMock)
vi.mock('../src/main/store/workspace', () => workspaceMock)
vi.mock('../src/main/wsl/paths', async () => {
  // The shape check and the argv builder are pure and are themselves part of
  // what these tests assert, so the real ones are used; only the functions that
  // shell out to wsl.exe are replaced.
  const actual = await vi.importActual<typeof import('../src/main/wsl/paths')>(
    '../src/main/wsl/paths'
  )
  return {
    ...actual,
    ...wslPathsMock
  }
})
vi.mock('../src/main/wsl/distros', () => wslDistrosMock)

import { IpcChannels } from '../src/shared/ipc'
import { registerIpcHandlers } from '../src/main/ipc'

function wslSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    projectId: 'project-1',
    name: 'App',
    kind: 'wsl',
    distro: 'Ubuntu-24.04',
    path: '/home/me/configured',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function handler(channel: string): Handler {
  const registered = electronMock.handlers.get(channel)
  if (!registered) throw new Error(`No handler registered for ${channel}`)
  return registered
}

function registerForTest(terminalInfo: ReturnType<typeof vi.fn>): void {
  registerIpcHandlers(
    { terminalInfo } as never,
    {} as never,
    {} as never,
    {} as never
  )
}

describe('terminal Explorer IPC', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    electronMock.shell.openPath.mockClear()
    electronMock.shell.openExternal.mockClear()
    workspaceMock.createSession.mockReset()
    workspaceMock.getSession.mockReset()
    wslPathsMock.canonicalizeWslPath.mockReset()
    wslPathsMock.resolveForTarget.mockReset()
    wslPathsMock.toWindows.mockReset()
    wslPathsMock.uncPathFor.mockReset()
    wslDistrosMock.isWslAvailable.mockReset()
    wslDistrosMock.listDistros.mockReset()
    wslDistrosMock.runWslCommand.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens the live WSL terminal directory instead of the configured session path', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const terminalInfo = vi.fn(() => ({
      sessionId: 'session-1',
      directory: '/home/me/current folder'
    }))
    workspaceMock.getSession.mockResolvedValue(wslSession())
    wslPathsMock.canonicalizeWslPath.mockResolvedValue('/home/me/current folder')
    wslDistrosMock.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    wslPathsMock.toWindows.mockResolvedValue('\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\current folder')
    registerForTest(terminalInfo)

    await handler(IpcChannels.pathRevealTerminal)({}, 'pane-1')

    expect(terminalInfo).toHaveBeenCalledWith('pane-1')
    // `test` is not getopt-based: a `--` terminator here would be a third
    // operand and every reveal would fail.
    expect(wslDistrosMock.runWslCommand).toHaveBeenCalledWith('Ubuntu-24.04', [
      'test',
      '-d',
      '/home/me/current folder'
    ])
    expect(wslPathsMock.toWindows).toHaveBeenCalledWith('Ubuntu-24.04', '/home/me/current folder')
    expect(electronMock.shell.openPath).toHaveBeenCalledWith(
      '\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\current folder'
    )
  })

  it('falls back to a WSL UNC path when conversion fails', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const terminalInfo = vi.fn(() => ({
      sessionId: 'session-1',
      directory: '/home/me/current'
    }))
    workspaceMock.getSession.mockResolvedValue(wslSession())
    wslPathsMock.canonicalizeWslPath.mockResolvedValue('/home/me/current')
    wslDistrosMock.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    wslPathsMock.toWindows.mockResolvedValue(null)
    wslPathsMock.uncPathFor.mockReturnValue('\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\current')
    registerForTest(terminalInfo)

    await handler(IpcChannels.pathRevealTerminal)({}, 'pane-1')

    expect(wslPathsMock.uncPathFor).toHaveBeenCalledWith('Ubuntu-24.04', '/home/me/current')
    expect(electronMock.shell.openPath).toHaveBeenCalledWith(
      '\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\current'
    )
  })

  it('refuses to open a spoofed OSC 7 directory that is really a file', async () => {
    // Any process writing to the terminal can emit OSC 7. Pointing it at an
    // executable would otherwise make the folder button launch that file.
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const terminalInfo = vi.fn(() => ({
      sessionId: 'session-1',
      directory: '/home/me/Update.exe'
    }))
    workspaceMock.getSession.mockResolvedValue(wslSession())
    wslPathsMock.canonicalizeWslPath.mockResolvedValue('/home/me/Update.exe')
    wslDistrosMock.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 1 })
    registerForTest(terminalInfo)

    await handler(IpcChannels.pathRevealTerminal)({}, 'pane-1')

    expect(wslPathsMock.toWindows).not.toHaveBeenCalled()
    expect(electronMock.shell.openPath).not.toHaveBeenCalled()
  })

  it('rejects malformed terminal directories before touching the distro', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const terminalInfo = vi.fn<() => TerminalInfo>(() => ({
      sessionId: 'session-1',
      directory: '/home/me/x\\..\\..\\Windows\\System32\\calc.exe'
    }))
    workspaceMock.getSession.mockResolvedValue(wslSession())
    registerForTest(terminalInfo)

    await handler(IpcChannels.pathRevealTerminal)({}, 'pane-1')

    terminalInfo.mockReturnValue({ sessionId: 'session-1', directory: '/home/me/../../etc' })
    await handler(IpcChannels.pathRevealTerminal)({}, 'pane-1')

    terminalInfo.mockReturnValue({ sessionId: 'session-1', directory: 'home/me/relative' })
    await handler(IpcChannels.pathRevealTerminal)({}, 'pane-1')

    expect(wslPathsMock.canonicalizeWslPath).not.toHaveBeenCalled()
    expect(wslDistrosMock.runWslCommand).not.toHaveBeenCalled()
    expect(electronMock.shell.openPath).not.toHaveBeenCalled()
  })

  it('reveals the canonical directory rather than the reported one', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const terminalInfo = vi.fn(() => ({ sessionId: 'session-1', directory: '/home/me/link' }))
    workspaceMock.getSession.mockResolvedValue(wslSession())
    wslPathsMock.canonicalizeWslPath.mockResolvedValue('/home/me/real')
    wslDistrosMock.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    wslPathsMock.toWindows.mockResolvedValue('\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\real')
    registerForTest(terminalInfo)

    await handler(IpcChannels.pathRevealTerminal)({}, 'pane-1')

    expect(wslPathsMock.toWindows).toHaveBeenCalledWith('Ubuntu-24.04', '/home/me/real')
    expect(electronMock.shell.openPath).toHaveBeenCalledWith(
      '\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\real'
    )
  })

  it('refuses to hand a spoofed terminal directory to VS Code', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const terminalInfo = vi.fn(() => ({
      sessionId: 'session-1',
      directory: '/home/me/Update.exe'
    }))
    workspaceMock.getSession.mockResolvedValue(wslSession())
    wslPathsMock.canonicalizeWslPath.mockResolvedValue('/home/me/Update.exe')
    wslDistrosMock.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 1 })
    registerForTest(terminalInfo)

    await handler(IpcChannels.pathOpenTerminalInVsCode)({}, 'pane-1')

    expect(electronMock.shell.openExternal).not.toHaveBeenCalled()
    expect(electronMock.dialog.showErrorBox).not.toHaveBeenCalled()
  })

  it('does nothing for unavailable or unsupported terminals', async () => {
    const terminalInfo = vi.fn<() => TerminalInfo | null>(() => null)
    registerForTest(terminalInfo)

    await handler(IpcChannels.pathRevealTerminal)({}, 'missing')

    expect(workspaceMock.getSession).not.toHaveBeenCalled()
    expect(electronMock.shell.openPath).not.toHaveBeenCalled()

    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    terminalInfo.mockReturnValue({ sessionId: 'session-1', directory: '/home/me/current' })
    workspaceMock.getSession.mockResolvedValue(wslSession())

    await handler(IpcChannels.pathRevealTerminal)({}, 'pane-1')

    expect(electronMock.shell.openPath).not.toHaveBeenCalled()
  })

  it('does nothing when the terminal has no current directory or its session is not WSL', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const terminalInfo = vi.fn<() => TerminalInfo | null>(() => ({
      sessionId: 'session-1',
      directory: null
    }))
    registerForTest(terminalInfo)

    await handler(IpcChannels.pathRevealTerminal)({}, 'pane-1')

    expect(workspaceMock.getSession).not.toHaveBeenCalled()
    expect(electronMock.shell.openPath).not.toHaveBeenCalled()

    terminalInfo.mockReturnValue({ sessionId: 'session-1', directory: '/tmp/current' })
    workspaceMock.getSession.mockResolvedValue(wslSession({ kind: 'native', distro: undefined }))

    await handler(IpcChannels.pathRevealTerminal)({}, 'pane-1')

    expect(electronMock.shell.openPath).not.toHaveBeenCalled()
  })

  it('normalizes a raw WSL home path before creating a session', async () => {
    const created = wslSession({ path: '/home/tester/dev/testmde' })
    workspaceMock.createSession.mockResolvedValue(created)
    wslPathsMock.resolveForTarget.mockResolvedValue({ path: '/home/tester/dev/testmde' })
    registerForTest(vi.fn())

    const input = {
      projectId: 'project-1',
      name: 'testmde',
      kind: 'wsl',
      distro: 'Ubuntu-24.04',
      path: '~/dev/testmde'
    }

    await expect(handler(IpcChannels.sessionsCreate)({}, input)).resolves.toBe(created)

    expect(wslPathsMock.resolveForTarget).toHaveBeenCalledWith(
      'wsl',
      'Ubuntu-24.04',
      '~/dev/testmde'
    )
    expect(workspaceMock.createSession).toHaveBeenCalledWith({
      ...input,
      path: '/home/tester/dev/testmde'
    })
  })

  it('validates hostile WSL directory names through direct execution', async () => {
    const path = "/tmp/project 'single' \"double\"; $(touch sentinel) `touch sentinel`\nline"
    wslDistrosMock.isWslAvailable.mockResolvedValue(true)
    wslPathsMock.canonicalizeWslPath.mockResolvedValue(path)
    wslDistrosMock.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    registerForTest(vi.fn())

    await expect(
      handler(IpcChannels.pathValidate)({}, {
        kind: 'wsl',
        distro: 'Ubuntu-24.04',
        path
      })
    ).resolves.toEqual({ exists: true })

    expect(wslDistrosMock.runWslCommand).toHaveBeenCalledWith(
      'Ubuntu-24.04',
      ['test', '-d', path]
    )
  })

  it('keeps native session paths in the target-native format', async () => {
    const created = {
      ...wslSession({ kind: 'native', distro: undefined, path: 'C:\\dev\\testmde' })
    }
    workspaceMock.createSession.mockResolvedValue(created)
    wslPathsMock.resolveForTarget.mockResolvedValue({ path: 'C:\\dev\\testmde' })
    registerForTest(vi.fn())

    const input = {
      projectId: 'project-1',
      name: 'testmde',
      kind: 'native',
      path: 'C:\\dev\\testmde'
    }

    await expect(handler(IpcChannels.sessionsCreate)({}, input)).resolves.toBe(created)

    expect(wslPathsMock.resolveForTarget).toHaveBeenCalledWith(
      'native',
      undefined,
      'C:\\dev\\testmde'
    )
    expect(workspaceMock.createSession).toHaveBeenCalledWith(input)
  })
})
