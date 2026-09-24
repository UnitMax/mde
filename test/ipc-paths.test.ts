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

function registerForTest(
  terminalInfo: ReturnType<typeof vi.fn>,
  ensure: ReturnType<typeof vi.fn> = vi.fn(() => 'running')
): void {
  registerIpcHandlers(
    { terminalInfo, ensure } as never,
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

  it('launches from the session directory without a live terminal directory', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const terminalInfo = vi.fn(() => ({ sessionId: 'session-1', directory: null }))
    const ensure = vi.fn(() => 'running')
    const session = wslSession({ path: '/home/me/session' })
    workspaceMock.getSession.mockResolvedValue(session)
    wslPathsMock.resolveForTarget.mockResolvedValue({ path: '/home/me/session' })
    wslPathsMock.canonicalizeWslPath.mockResolvedValue('/home/me/session')
    wslDistrosMock.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    registerForTest(terminalInfo, ensure)

    const request = {
      terminalId: 'child-pane',
      sessionId: session.id,
      size: { cols: 80, rows: 24 },
      palette: { foreground: '#d8dee9', background: '#0b0e13' },
      launch: { sourceTerminalId: 'source-pane', directory: 'session' }
    }

    await expect(handler(IpcChannels.ptyEnsure)({}, request)).resolves.toBe('running')

    expect(terminalInfo).toHaveBeenCalledWith('source-pane')
    expect(wslPathsMock.canonicalizeWslPath).toHaveBeenCalledWith('Ubuntu-24.04', '/home/me/session')
    expect(wslDistrosMock.runWslCommand).toHaveBeenCalledWith('Ubuntu-24.04', [
      'test',
      '-d',
      '/home/me/session'
    ])
    expect(ensure).toHaveBeenCalledWith(
      'child-pane',
      session,
      request.size,
      request.palette,
      { directory: '/home/me/session' }
    )
  })

  it('normalizes a legacy session path before launching', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const terminalInfo = vi.fn(() => ({ sessionId: 'session-1', directory: '/home/me/live' }))
    const ensure = vi.fn(() => 'running')
    const session = wslSession({ path: '~/session' })
    workspaceMock.getSession.mockResolvedValue(session)
    wslPathsMock.resolveForTarget.mockResolvedValue({ path: '/home/me/session' })
    wslPathsMock.canonicalizeWslPath.mockResolvedValue('/home/me/session')
    wslDistrosMock.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    registerForTest(terminalInfo, ensure)

    const request = {
      terminalId: 'child-pane',
      sessionId: session.id,
      size: { cols: 80, rows: 24 },
      palette: { foreground: '#d8dee9', background: '#0b0e13' },
      launch: { sourceTerminalId: 'source-pane', directory: 'session' }
    }

    await expect(handler(IpcChannels.ptyEnsure)({}, request)).resolves.toBe('running')

    expect(wslPathsMock.resolveForTarget).toHaveBeenCalledWith(
      'wsl',
      'Ubuntu-24.04',
      '~/session'
    )
    expect(wslPathsMock.canonicalizeWslPath).toHaveBeenCalledWith(
      'Ubuntu-24.04',
      '/home/me/session'
    )
    expect(ensure).toHaveBeenCalledWith(
      'child-pane',
      session,
      request.size,
      request.palette,
      { directory: '/home/me/session' }
    )
  })

  it('rejects an unavailable session directory before spawning a pane', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const terminalInfo = vi.fn(() => ({ sessionId: 'session-1', directory: '/home/me/live' }))
    const ensure = vi.fn(() => 'running')
    const session = wslSession({ path: '/home/me/missing' })
    workspaceMock.getSession.mockResolvedValue(session)
    wslPathsMock.resolveForTarget.mockResolvedValue({ path: '/home/me/missing' })
    wslPathsMock.canonicalizeWslPath.mockResolvedValue('/home/me/missing')
    wslDistrosMock.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 1 })
    registerForTest(terminalInfo, ensure)

    await expect(
      handler(IpcChannels.ptyEnsure)({}, {
        terminalId: 'child-pane',
        sessionId: session.id,
        size: { cols: 80, rows: 24 },
        palette: { foreground: '#d8dee9', background: '#0b0e13' },
        launch: { sourceTerminalId: 'source-pane', directory: 'session' }
      })
    ).rejects.toThrow('The selected launch directory is not available')

    expect(ensure).not.toHaveBeenCalled()
  })

  it('launches from the source terminal directory when requested', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const terminalInfo = vi.fn(() => ({
      sessionId: 'session-1',
      directory: '/home/me/live'
    }))
    const ensure = vi.fn(() => 'running')
    const session = wslSession({ path: '/home/me/session' })
    workspaceMock.getSession.mockResolvedValue(session)
    wslPathsMock.canonicalizeWslPath.mockResolvedValue('/home/me/live')
    wslDistrosMock.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    registerForTest(terminalInfo, ensure)

    const request = {
      terminalId: 'child-pane',
      sessionId: session.id,
      size: { cols: 100, rows: 30 },
      palette: { foreground: '#d8dee9', background: '#0b0e13' },
      launch: { sourceTerminalId: 'source-pane', directory: 'terminal' }
    }

    await expect(handler(IpcChannels.ptyEnsure)({}, request)).resolves.toBe('running')

    expect(wslPathsMock.canonicalizeWslPath).toHaveBeenCalledWith('Ubuntu-24.04', '/home/me/live')
    expect(ensure).toHaveBeenCalledWith(
      'child-pane',
      session,
      request.size,
      request.palette,
      { directory: '/home/me/live' }
    )
  })

  it('rejects an unknown launch directory before spawning a pane', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const terminalInfo = vi.fn(() => ({ sessionId: 'session-1', directory: '/home/me/live' }))
    const ensure = vi.fn(() => 'running')
    workspaceMock.getSession.mockResolvedValue(wslSession())
    registerForTest(terminalInfo, ensure)

    await expect(
      handler(IpcChannels.ptyEnsure)({}, {
        terminalId: 'child-pane',
        sessionId: 'session-1',
        size: { cols: 80, rows: 24 },
        palette: { foreground: '#d8dee9', background: '#0b0e13' },
        launch: { sourceTerminalId: 'source-pane', directory: 'other' }
      })
    ).rejects.toThrow('Invalid terminal launch directory')

    expect(terminalInfo).not.toHaveBeenCalled()
    expect(ensure).not.toHaveBeenCalled()
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

describe('terminal Git IPC', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    workspaceMock.getSession.mockReset()
    wslPathsMock.canonicalizeWslPath.mockReset()
    wslDistrosMock.runWslCommand.mockReset()
  })

  it('queries Git in the live terminal directory', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const terminalInfo = vi.fn(() => ({
      sessionId: 'session-1',
      directory: '/home/me/current'
    }))
    workspaceMock.getSession.mockResolvedValue(wslSession())
    wslPathsMock.canonicalizeWslPath.mockResolvedValue('/home/me/current')
    wslDistrosMock.runWslCommand.mockImplementation(async (
      _distro: string,
      command: readonly string[],
      _options: { cwd?: string } = {}
    ) => {
      if (command[0] === 'test') return { stdout: '', stderr: '', code: 0 }
      if (command.includes('--is-inside-work-tree')) return { stdout: 'true\n', stderr: '', code: 0 }
      if (command.includes('branch')) return { stdout: 'feature/live\n', stderr: '', code: 0 }
      return { stdout: '/home/me/repo\n', stderr: '', code: 0 }
    })
    registerForTest(terminalInfo)

    await expect(handler(IpcChannels.gitTerminalInfo)({}, { terminalId: 'pane-1' })).resolves.toEqual({
      repository: true,
      branch: 'feature/live',
      worktree: '/home/me/repo'
    })

    expect(terminalInfo).toHaveBeenCalledWith('pane-1')
    const gitCalls = wslDistrosMock.runWslCommand.mock.calls.filter(
      ([, command]) => command[0] === 'git'
    )
    expect(gitCalls).toHaveLength(3)
    expect(gitCalls.every(([, , options]) => options.cwd === '/home/me/current')).toBe(true)
  })

  it('returns no terminal Git metadata when the PTY is unavailable', async () => {
    const terminalInfo = vi.fn(() => null)
    registerForTest(terminalInfo)

    await expect(handler(IpcChannels.gitTerminalInfo)({}, { terminalId: 'missing' })).resolves.toBeNull()
    expect(wslDistrosMock.runWslCommand).not.toHaveBeenCalled()
  })
})

describe('file tree IPC', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    workspaceMock.getSession.mockReset()
    wslPathsMock.resolveForTarget.mockReset()
    wslDistrosMock.runWslCommand.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects malformed requests and unknown sessions', async () => {
    registerForTest(vi.fn())
    const list = handler(IpcChannels.filesList)

    await expect(list({}, null)).rejects.toThrow('Invalid file tree request.')
    await expect(list({}, { sessionId: 'session-1' })).rejects.toThrow('Invalid file tree request.')
    await expect(list({}, { sessionId: '', path: '' })).rejects.toThrow('Invalid file tree request.')

    workspaceMock.getSession.mockResolvedValue(undefined)
    await expect(list({}, { sessionId: 'missing', path: '' })).rejects.toThrow('Session no longer exists.')
  })

  it('refuses paths outside the session root before reaching the distro', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    registerForTest(vi.fn())
    workspaceMock.getSession.mockResolvedValue(wslSession())

    await expect(
      handler(IpcChannels.filesList)({}, { sessionId: 'session-1', path: '../../etc' })
    ).rejects.toThrow('Invalid folder path.')
    expect(wslDistrosMock.runWslCommand).not.toHaveBeenCalled()
  })

  it('lists a WSL session directory inside the configured distro', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    registerForTest(vi.fn())
    workspaceMock.getSession.mockResolvedValue(wslSession())
    wslDistrosMock.runWslCommand.mockResolvedValue({ stdout: 'f\tmain.ts\n', stderr: '', code: 0 })

    await expect(
      handler(IpcChannels.filesList)({}, { sessionId: 'session-1', path: 'src' })
    ).resolves.toEqual({ path: 'src', entries: [{ name: 'main.ts', kind: 'file' }], truncated: false })
    expect(wslDistrosMock.runWslCommand).toHaveBeenCalledWith(
      'Ubuntu-24.04',
      expect.arrayContaining(['find', '-H', '/home/me/configured/src'])
    )
  })
})
