import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { trustedIpcSender } from './helpers/ipc-sender'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../src/shared/types'

type Handler = (event: unknown, request: unknown) => Promise<unknown> | unknown
type TerminalInfo = { sessionId: string; directory: string | null }
const hostPlatform = process.platform

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
  createTodoProject: vi.fn(),
  createTodoTask: vi.fn(),
  createSession: vi.fn(),
  duplicateSession: vi.fn(),
  getSession: vi.fn(),
  loadWorkspace: vi.fn(),
  moveTodoTask: vi.fn(),
  removeTodoProject: vi.fn(),
  removeTodoTask: vi.fn(),
  removeSession: vi.fn(),
  reorderSession: vi.fn(),
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
  runWslCommand: vi.fn(),
  runWslCommandBuffer: vi.fn()
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

const { security, event: trustedEvent } = trustedIpcSender()

function wslSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: 'App',
    kind: 'wsl',
    distro: 'Ubuntu-24.04',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function handler(channel: string): Handler {
  const registered = electronMock.handlers.get(channel)
  if (!registered) throw new Error(`No handler registered for ${channel}`)
  return registered
}

const inboxFileRoot = vi.fn()

function registerForTest(
  terminalInfo: ReturnType<typeof vi.fn>,
  ensure: ReturnType<typeof vi.fn> = vi.fn(() => 'running'),
  savedDirectory: ReturnType<typeof vi.fn> = vi.fn(),
  restart: ReturnType<typeof vi.fn> = vi.fn(() => 'running'),
): void {
  registerIpcHandlers(
    security,
    { terminalInfo, ensure, savedDirectory, restart, dispose: vi.fn() } as never,
    {} as never,
    {} as never,
    { chat: { fileRoot: inboxFileRoot }, recorder: {} } as never
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

  it('opens the live WSL terminal directory', async () => {
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

    await handler(IpcChannels.pathRevealTerminal)(trustedEvent, 'pane-1')

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

    await handler(IpcChannels.pathRevealTerminal)(trustedEvent, 'pane-1')

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

    await handler(IpcChannels.pathRevealTerminal)(trustedEvent, 'pane-1')

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

    await handler(IpcChannels.pathRevealTerminal)(trustedEvent, 'pane-1')

    terminalInfo.mockReturnValue({ sessionId: 'session-1', directory: '/home/me/../../etc' })
    await handler(IpcChannels.pathRevealTerminal)(trustedEvent, 'pane-1')

    terminalInfo.mockReturnValue({ sessionId: 'session-1', directory: 'home/me/relative' })
    await handler(IpcChannels.pathRevealTerminal)(trustedEvent, 'pane-1')

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

    await handler(IpcChannels.pathRevealTerminal)(trustedEvent, 'pane-1')

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

    await handler(IpcChannels.pathOpenTerminalInVsCode)(trustedEvent, 'pane-1')

    expect(electronMock.shell.openExternal).not.toHaveBeenCalled()
    expect(electronMock.dialog.showErrorBox).not.toHaveBeenCalled()
  })

  it('does nothing for unavailable or unsupported terminals', async () => {
    const terminalInfo = vi.fn<() => TerminalInfo | null>(() => null)
    registerForTest(terminalInfo)

    await handler(IpcChannels.pathRevealTerminal)(trustedEvent, 'missing')

    expect(workspaceMock.getSession).not.toHaveBeenCalled()
    expect(electronMock.shell.openPath).not.toHaveBeenCalled()

    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    terminalInfo.mockReturnValue({ sessionId: 'session-1', directory: '/home/me/current' })
    workspaceMock.getSession.mockResolvedValue(wslSession())

    await handler(IpcChannels.pathRevealTerminal)(trustedEvent, 'pane-1')

    expect(electronMock.shell.openPath).not.toHaveBeenCalled()
  })

  it('does nothing when the terminal has no current directory or its session is not WSL', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const terminalInfo = vi.fn<() => TerminalInfo | null>(() => ({
      sessionId: 'session-1',
      directory: null
    }))
    registerForTest(terminalInfo)

    await handler(IpcChannels.pathRevealTerminal)(trustedEvent, 'pane-1')

    expect(workspaceMock.getSession).not.toHaveBeenCalled()
    expect(electronMock.shell.openPath).not.toHaveBeenCalled()

    terminalInfo.mockReturnValue({ sessionId: 'session-1', directory: '/tmp/current' })
    workspaceMock.getSession.mockResolvedValue(wslSession({ kind: 'native', distro: undefined }))

    await handler(IpcChannels.pathRevealTerminal)(trustedEvent, 'pane-1')

    expect(electronMock.shell.openPath).not.toHaveBeenCalled()
  })

  it('rejects a renderer-provided launch before spawning a pane', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const terminalInfo = vi.fn(() => ({ sessionId: 'session-1', directory: '/home/me/live' }))
    const ensure = vi.fn(() => 'running')
    workspaceMock.getSession.mockResolvedValue(wslSession())
    registerForTest(terminalInfo, ensure)

    await expect(
      handler(IpcChannels.ptyEnsure)(trustedEvent, {
        terminalId: 'child-pane',
        sessionId: 'session-1',
        size: { cols: 80, rows: 24 },
        palette: { foreground: '#d8dee9', background: '#0b0e13' },
        launch: { sourceTerminalId: 'source-pane', directory: 'other' }
      })
    ).rejects.toThrow('Invalid IPC payload for pty:ensure.')

    expect(terminalInfo).not.toHaveBeenCalled()
    expect(ensure).not.toHaveBeenCalled()
  })

  it('validates hostile WSL directory names through direct execution', async () => {
    const path = "/tmp/project 'single' \"double\"; $(touch sentinel) `touch sentinel`"
    wslDistrosMock.isWslAvailable.mockResolvedValue(true)
    wslPathsMock.canonicalizeWslPath.mockResolvedValue(path)
    wslDistrosMock.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    registerForTest(vi.fn())

    await expect(
      handler(IpcChannels.pathValidate)(trustedEvent, {
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

  it('rejects control characters in WSL paths before launching a process', async () => {
    registerForTest(vi.fn())
    await expect(handler(IpcChannels.pathValidate)(trustedEvent, {
      kind: 'wsl', distro: 'Ubuntu-24.04', path: '/tmp/project\nline',
    })).rejects.toThrow('Invalid IPC payload for path:validate.')
    expect(wslPathsMock.canonicalizeWslPath).not.toHaveBeenCalled()
    expect(wslDistrosMock.runWslCommand).not.toHaveBeenCalled()
  })
})

describe('Inbox folder IPC', () => {
  const thread = (overrides: Partial<Session> & { path?: string } = {}): Session & { path: string } => ({
    ...wslSession({ id: 'ses_thread' }),
    path: '/home/me/app',
    ...overrides
  })

  beforeEach(() => {
    electronMock.handlers.clear()
    electronMock.shell.openPath.mockClear()
    electronMock.shell.openExternal.mockClear()
    electronMock.dialog.showErrorBox.mockClear()
    inboxFileRoot.mockReset().mockReturnValue(null)
    wslPathsMock.canonicalizeWslPath.mockReset()
    wslPathsMock.toWindows.mockReset()
    wslPathsMock.uncPathFor.mockReset()
    wslDistrosMock.runWslCommand.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a WSL thread folder in the file manager, named by thread or project ID', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    inboxFileRoot.mockReturnValue(thread())
    wslPathsMock.canonicalizeWslPath.mockResolvedValue('/home/me/app')
    wslDistrosMock.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    wslPathsMock.toWindows.mockResolvedValue('\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\app')
    registerForTest(vi.fn())

    await handler(IpcChannels.pathRevealInbox)(trustedEvent, 'ses_thread')
    await handler(IpcChannels.pathRevealInbox)(trustedEvent, 'fld_1234')

    expect(inboxFileRoot).toHaveBeenNthCalledWith(1, 'ses_thread')
    expect(inboxFileRoot).toHaveBeenNthCalledWith(2, 'fld_1234')
    expect(wslDistrosMock.runWslCommand).toHaveBeenCalledWith('Ubuntu-24.04', ['test', '-d', '/home/me/app'])
    expect(electronMock.shell.openPath).toHaveBeenCalledTimes(2)
    expect(electronMock.shell.openPath).toHaveBeenCalledWith('\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\app')
  })

  it('shows a native thread folder in the file manager on any platform', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'mde-inbox-folder-'))
    try {
      inboxFileRoot.mockReturnValue(thread({ kind: 'native', distro: undefined, path: directory }))
      registerForTest(vi.fn())

      await handler(IpcChannels.pathRevealInbox)(trustedEvent, 'ses_thread')

      expect(electronMock.shell.openPath).toHaveBeenCalledWith(directory)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('opens a WSL thread folder in VS Code through the remote URI', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    inboxFileRoot.mockReturnValue(thread({ path: '/home/me/my app' }))
    wslPathsMock.canonicalizeWslPath.mockResolvedValue('/home/me/my app')
    wslDistrosMock.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    registerForTest(vi.fn())

    await handler(IpcChannels.pathOpenInboxInVsCode)(trustedEvent, 'ses_thread')

    expect(electronMock.shell.openExternal).toHaveBeenCalledWith(
      'vscode://vscode-remote/wsl+Ubuntu-24.04/home/me/my%20app/'
    )
    expect(electronMock.dialog.showErrorBox).not.toHaveBeenCalled()
  })

  it('opens the canonical folder rather than a symlink to it', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    inboxFileRoot.mockReturnValue(thread({ path: '/home/me/link' }))
    wslPathsMock.canonicalizeWslPath.mockResolvedValue('/home/me/real')
    wslDistrosMock.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    registerForTest(vi.fn())

    await handler(IpcChannels.pathOpenInboxInVsCode)(trustedEvent, 'ses_thread')

    expect(electronMock.shell.openExternal).toHaveBeenCalledWith('vscode://vscode-remote/wsl+Ubuntu-24.04/home/me/real/')
  })

  it('does nothing for an ID that is not in the Inbox', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    registerForTest(vi.fn())

    await handler(IpcChannels.pathRevealInbox)(trustedEvent, 'ses_gone')
    await handler(IpcChannels.pathOpenInboxInVsCode)(trustedEvent, 'ses_gone')

    expect(electronMock.shell.openPath).not.toHaveBeenCalled()
    expect(electronMock.shell.openExternal).not.toHaveBeenCalled()
    expect(electronMock.dialog.showErrorBox).not.toHaveBeenCalled()
  })

  it('refuses a folder that is really a file, or not a plain absolute path', async () => {
    // The thread's directory is recorded data, but a file here would make "open folder" launch it.
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    inboxFileRoot.mockReturnValue(thread({ path: '/home/me/Update.exe' }))
    wslPathsMock.canonicalizeWslPath.mockResolvedValue('/home/me/Update.exe')
    wslDistrosMock.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 1 })
    registerForTest(vi.fn())

    await handler(IpcChannels.pathRevealInbox)(trustedEvent, 'ses_thread')
    await handler(IpcChannels.pathOpenInboxInVsCode)(trustedEvent, 'ses_thread')

    inboxFileRoot.mockReturnValue(thread({ path: '/home/me/../../etc' }))
    wslDistrosMock.runWslCommand.mockClear()
    await handler(IpcChannels.pathRevealInbox)(trustedEvent, 'ses_thread')
    await handler(IpcChannels.pathOpenInboxInVsCode)(trustedEvent, 'ses_thread')

    expect(wslDistrosMock.runWslCommand).not.toHaveBeenCalled()
    expect(electronMock.shell.openPath).not.toHaveBeenCalled()
    expect(electronMock.shell.openExternal).not.toHaveBeenCalled()
  })

  it('does not hand a WSL folder to the desktop away from Windows', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    inboxFileRoot.mockReturnValue(thread())
    registerForTest(vi.fn())

    await handler(IpcChannels.pathRevealInbox)(trustedEvent, 'ses_thread')
    await handler(IpcChannels.pathOpenInboxInVsCode)(trustedEvent, 'ses_thread')

    expect(wslDistrosMock.runWslCommand).not.toHaveBeenCalled()
    expect(electronMock.shell.openPath).not.toHaveBeenCalled()
    expect(electronMock.shell.openExternal).not.toHaveBeenCalled()
  })

  it('opens only WSL folders in VS Code, as the terminal button does', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    inboxFileRoot.mockReturnValue(thread({ kind: 'native', distro: undefined, path: 'C:\\Users\\Me\\app' }))
    registerForTest(vi.fn())

    await handler(IpcChannels.pathOpenInboxInVsCode)(trustedEvent, 'ses_thread')

    expect(electronMock.shell.openExternal).not.toHaveBeenCalled()
  })

  it('tells the user when Windows cannot open the folder in VS Code', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    inboxFileRoot.mockReturnValue(thread())
    wslPathsMock.canonicalizeWslPath.mockResolvedValue('/home/me/app')
    wslDistrosMock.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    electronMock.shell.openExternal.mockRejectedValueOnce(new Error('No application is registered'))
    registerForTest(vi.fn())

    await handler(IpcChannels.pathOpenInboxInVsCode)(trustedEvent, 'ses_thread')

    expect(electronMock.dialog.showErrorBox).toHaveBeenCalledWith(
      'Could not open VS Code',
      expect.stringContaining('No application is registered')
    )
  })
})

describe('terminal directory restoration over IPC', () => {
  beforeEach(() => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    electronMock.handlers.clear()
    workspaceMock.getSession.mockReset().mockResolvedValue(wslSession())
    wslPathsMock.canonicalizeWslPath.mockReset().mockImplementation(async (_distro, path) => path)
    wslDistrosMock.runWslCommand.mockReset().mockResolvedValue({ stdout: '', stderr: '', code: 0 })
  })

  afterEach(() => vi.restoreAllMocks())

  const request = (terminalId: string) => ({
    terminalId, sessionId: 'session-1', size: { cols: 80, rows: 24 },
    palette: { foreground: '#ffffff', background: '#000000' },
  })

  it('restores each new shell in its own verified WSL directory', async () => {
    const ensure = vi.fn(() => 'running')
    registerForTest(vi.fn(() => null), ensure, vi.fn((id) => `/home/me/${id}`))
    await handler(IpcChannels.ptyEnsure)(trustedEvent, request('first'))
    await handler(IpcChannels.ptyEnsure)(trustedEvent, request('second'))
    expect(ensure.mock.calls).toEqual([
      ['first', wslSession(), request('first').size, request('first').palette, { directory: '/home/me/first' }],
      ['second', wslSession(), request('second').size, request('second').palette, { directory: '/home/me/second' }],
    ])
    expect(wslDistrosMock.runWslCommand).toHaveBeenCalledWith('Ubuntu-24.04', ['test', '-d', '/home/me/first'])
  })

  it('restores native folders with spaces and falls back for missing folders or files', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(hostPlatform)
    const directory = await fs.mkdtemp(join(tmpdir(), 'mde-restore-'))
    try {
      const folder = join(directory, hostPlatform === 'win32' ? 'folder with spaces' : 'folder with spaces ')
      const file = join(directory, 'file')
      await fs.mkdir(folder)
      await fs.writeFile(file, '')
      const native = { ...wslSession(), kind: 'native', distro: undefined }
      workspaceMock.getSession.mockResolvedValue(native)
      const ensure = vi.fn(() => 'running')
      registerForTest(vi.fn(() => null), ensure, vi.fn((id) => id === 'folder' ? folder : id === 'file' ? file : join(directory, 'missing')))
      for (const id of ['folder', 'file', 'missing']) await handler(IpcChannels.ptyEnsure)(trustedEvent, request(id))
      expect(ensure.mock.calls).toEqual([
        ['folder', native, request('folder').size, request('folder').palette, { directory: folder }],
        ['file', native, request('file').size, request('file').palette, undefined],
        ['missing', native, request('missing').size, request('missing').palette, undefined],
      ])
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it.each(['missing', 'inaccessible', 'unavailable'])('uses the default home launch when a saved folder is %s', async (failure) => {
    const ensure = vi.fn(() => 'running')
    if (failure === 'missing') wslDistrosMock.runWslCommand.mockResolvedValue({ stdout: '', stderr: '', code: 1 })
    else if (failure === 'inaccessible') wslDistrosMock.runWslCommand.mockImplementation(async (_distro, command) => ({ stdout: '', stderr: '', code: command[1] === '-x' ? 1 : 0 }))
    else wslPathsMock.canonicalizeWslPath.mockRejectedValue(new Error('Unavailable distro'))
    registerForTest(vi.fn(() => null), ensure, vi.fn(() => '/home/me/gone'))
    await handler(IpcChannels.ptyEnsure)(trustedEvent, request('pane'))
    expect(ensure).toHaveBeenCalledWith('pane', wslSession(), request('pane').size, request('pane').palette, undefined)
  })

  it('does not revalidate saved directories while reattaching an existing PTY', async () => {
    const ensure = vi.fn(() => 'running')
    const saved = vi.fn(() => '/home/me/gone')
    registerForTest(vi.fn(() => ({ sessionId: 'session-1', directory: '/home/me/live' })), ensure, saved)
    await handler(IpcChannels.ptyEnsure)(trustedEvent, request('pane'))
    expect(saved).not.toHaveBeenCalled()
    expect(wslDistrosMock.runWslCommand).not.toHaveBeenCalled()
    expect(ensure).toHaveBeenCalledWith('pane', wslSession(), request('pane').size, request('pane').palette, undefined)
  })

  it('restarts in the live terminal directory before using an older saved one', async () => {
    const restart = vi.fn(() => 'running')
    const saved = vi.fn(() => '/home/me/older')
    registerForTest(vi.fn(() => ({ sessionId: 'session-1', directory: '/home/me/current' })), vi.fn(), saved, restart)
    await handler(IpcChannels.ptyRestart)(trustedEvent, request('pane'))
    expect(restart).toHaveBeenCalledWith('pane', wslSession(), request('pane').size, request('pane').palette, { directory: '/home/me/current' })
    expect(saved).not.toHaveBeenCalled()
  })

  it('does not recreate a pane closed while its saved directory is being verified', async () => {
    let resolve!: (path: string) => void
    wslPathsMock.canonicalizeWslPath.mockReturnValue(new Promise<string>((done) => { resolve = done }))
    const ensure = vi.fn(() => 'running')
    registerForTest(vi.fn(() => null), ensure, vi.fn(() => '/home/me/project'))
    const pending = handler(IpcChannels.ptyEnsure)(trustedEvent, request('pane'))
    await vi.waitFor(() => expect(wslPathsMock.canonicalizeWslPath).toHaveBeenCalled())
    await handler(IpcChannels.ptyDispose)(trustedEvent, 'pane')
    resolve('/home/me/project')
    expect(await pending).toBe('none')
    expect(ensure).not.toHaveBeenCalled()
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
      if (command.includes('status') || command.includes('diff')) return { stdout: '', stderr: '', code: 0 }
      if (command.includes('branch')) return { stdout: 'feature/live\n', stderr: '', code: 0 }
      return { stdout: '/home/me/repo\n', stderr: '', code: 0 }
    })
    registerForTest(terminalInfo)

    await expect(handler(IpcChannels.gitTerminalInfo)(trustedEvent, { terminalId: 'pane-1' })).resolves.toEqual({
      repository: true,
      branch: 'feature/live',
      worktree: '/home/me/repo',
      directory: '/home/me/current',
      additions: 0, deletions: 0, commitsAhead: null, changedFiles: 0
    })

    expect(terminalInfo).toHaveBeenCalledWith('pane-1')
    const gitCalls = wslDistrosMock.runWslCommand.mock.calls.filter(
      ([, command]) => command[0] === 'git'
    )
    expect(gitCalls).toHaveLength(6)
    expect(gitCalls.every(([, , options]) => options.cwd === '/home/me/current')).toBe(true)
  })

  it('returns no terminal Git metadata when the PTY is unavailable', async () => {
    const terminalInfo = vi.fn(() => null)
    registerForTest(terminalInfo)

    await expect(handler(IpcChannels.gitTerminalInfo)(trustedEvent, { terminalId: 'missing' })).resolves.toBeNull()
    expect(wslDistrosMock.runWslCommand).not.toHaveBeenCalled()
  })
})

describe('file tree IPC', () => {
  beforeEach(() => {
    inboxFileRoot.mockReset().mockReturnValue(null)
    electronMock.handlers.clear()
    workspaceMock.getSession.mockReset()
    wslPathsMock.resolveForTarget.mockReset()
    wslDistrosMock.runWslCommand.mockReset()
    wslDistrosMock.runWslCommandBuffer.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects malformed requests and unknown sessions', async () => {
    registerForTest(vi.fn())
    const list = handler(IpcChannels.filesList)

    await expect(list(trustedEvent, null)).rejects.toThrow('Invalid IPC payload for files:list.')
    await expect(list(trustedEvent, { sessionId: 'session-1' })).rejects.toThrow('Invalid IPC payload for files:list.')
    await expect(list(trustedEvent, { sessionId: '', path: '' })).rejects.toThrow('Invalid IPC payload for files:list.')

    workspaceMock.getSession.mockResolvedValue(undefined)
    await expect(list(trustedEvent, { sessionId: 'missing', path: '' })).rejects.toThrow('Session no longer exists.')
    workspaceMock.getSession.mockResolvedValue(wslSession())
    await expect(list(trustedEvent, { sessionId: 'session-1', path: '' })).rejects.toThrow('Session no longer exists.')
  })

  it('refuses paths outside the session root before reaching the distro', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    registerForTest(vi.fn())
    workspaceMock.getSession.mockResolvedValue(wslSession())

    await expect(
      handler(IpcChannels.filesList)(trustedEvent, { sessionId: 'session-1', path: '../../etc' })
    ).rejects.toThrow('Invalid IPC payload for files:list.')
    expect(wslDistrosMock.runWslCommand).not.toHaveBeenCalled()
  })

  it('lists a WSL Inbox folder inside its distro', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    registerForTest(vi.fn())
    inboxFileRoot.mockReturnValue({ ...wslSession(), path: '/home/me/configured' })
    wslDistrosMock.runWslCommand.mockResolvedValue({ stdout: 'f\tmain.ts\n', stderr: '', code: 0 })

    await expect(
      handler(IpcChannels.filesList)(trustedEvent, { sessionId: 'fld_app', path: 'src' })
    ).resolves.toEqual({ path: 'src', entries: [{ name: 'main.ts', kind: 'file' }], truncated: false })
    expect(wslDistrosMock.runWslCommand).toHaveBeenCalledWith(
      'Ubuntu-24.04',
      expect.arrayContaining(['find', '-H', '/home/me/configured/src'])
    )
  })

  it('validates file read requests before reaching the distro', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    registerForTest(vi.fn())
    const read = handler(IpcChannels.filesRead)

    await expect(read(trustedEvent, { sessionId: 'session-1' })).rejects.toThrow('Invalid IPC payload for files:read.')
    workspaceMock.getSession.mockResolvedValue(undefined)
    await expect(read(trustedEvent, { sessionId: 'missing', path: 'a.md' })).rejects.toThrow('Session no longer exists.')

    workspaceMock.getSession.mockResolvedValue(wslSession())
    await expect(read(trustedEvent, { sessionId: 'session-1', path: '../../etc/passwd' })).rejects.toThrow('Invalid IPC payload for files:read.')
    expect(wslDistrosMock.runWslCommandBuffer).not.toHaveBeenCalled()
  })

  it('reads a WSL Inbox file through the binary-safe runner', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    registerForTest(vi.fn())
    inboxFileRoot.mockReturnValue({ ...wslSession(), path: '/home/me/configured' })
    wslDistrosMock.runWslCommandBuffer.mockResolvedValue({ stdout: Buffer.from('3\nhi\n'), stderr: '', code: 0 })

    await expect(
      handler(IpcChannels.filesRead)(trustedEvent, { sessionId: 'fld_app', path: 'README.md' })
    ).resolves.toEqual({ path: 'README.md', content: 'hi\n', size: 3, binary: false, tooLarge: false })
    expect(wslDistrosMock.runWslCommandBuffer.mock.calls[0]?.[1]).toContain('/home/me/configured/README.md')
  })

  it('lists and reads relative to the live terminal, outside its launch folder', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    workspaceMock.getSession.mockResolvedValue(wslSession())
    wslPathsMock.canonicalizeWslPath.mockResolvedValue('/home/me/current')
    wslDistrosMock.runWslCommand.mockImplementation(async (_distro: string, command: string[]) => ({
      stdout: command[0] === 'find' ? 'f\tREADME.md\n' : '', stderr: '', code: 0,
    }))
    wslDistrosMock.runWslCommandBuffer.mockResolvedValue({ stdout: Buffer.from('3\nhi\n'), stderr: '', code: 0 })
    registerForTest(vi.fn(() => ({ sessionId: 'session-1', directory: '/home/me/current' })))
    const root = { terminalId: 'pane-1', directory: '/home/me/current' }
    await expect(handler(IpcChannels.filesList)(trustedEvent, { ...root, path: '' })).resolves.toMatchObject({ entries: [{ name: 'README.md' }] })
    expect(wslDistrosMock.runWslCommand).toHaveBeenCalledWith('Ubuntu-24.04', expect.arrayContaining(['/home/me/current']))
    await expect(handler(IpcChannels.filesRead)(trustedEvent, { ...root, path: 'README.md' })).resolves.toMatchObject({ content: 'hi\n' })
    expect(wslDistrosMock.runWslCommandBuffer.mock.calls[0]?.[1]).toContain('/home/me/current/README.md')
  })

  it.each([IpcChannels.filesList, IpcChannels.filesRead, IpcChannels.gitInfo, IpcChannels.gitDiff])('rejects a stale or invented terminal directory for %s', async (channel) => {
    workspaceMock.getSession.mockResolvedValue(wslSession())
    const terminalInfo = vi.fn(() => ({ sessionId: 'session-1', directory: '/home/me/current' }))
    registerForTest(terminalInfo)
    await expect(handler(channel)(trustedEvent, { terminalId: 'pane-1', directory: '/home/me/other', ...(channel === IpcChannels.gitInfo ? {} : { path: 'README.md' }) })).rejects.toThrow('The terminal directory has changed.')
    expect(wslDistrosMock.runWslCommand).not.toHaveBeenCalled()
  })

  it('rechecks the terminal after directory verification finishes', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    workspaceMock.getSession.mockResolvedValue(wslSession())
    wslPathsMock.canonicalizeWslPath.mockResolvedValue('/home/me/current')
    const terminal = { sessionId: 'session-1', directory: '/home/me/current' }
    wslDistrosMock.runWslCommand.mockImplementation(async () => {
      terminal.directory = '/home/me/new'
      return { stdout: '', stderr: '', code: 0 }
    })
    registerForTest(vi.fn(() => ({ ...terminal })))
    await expect(handler(IpcChannels.filesList)(trustedEvent, { terminalId: 'pane-1', directory: '/home/me/current', path: '' })).rejects.toThrow('The terminal directory has changed.')
    expect(wslDistrosMock.runWslCommand.mock.calls.every(([, command]) => command[0] === 'test')).toBe(true)
  })

  it('lists WSL folders through the browser channel, starting at the distro home', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    registerForTest(vi.fn())
    wslDistrosMock.runWslCommand.mockImplementation(async (_distro: string, command: string[]) =>
      command[0] === 'bash'
        ? { stdout: '__MDE_VALUE_BEGIN__/home/me__MDE_VALUE_END__\n', stderr: '', code: 0 }
        : { stdout: 'd\tsrc\nf\ta.txt\n', stderr: '', code: 0 })

    await expect(
      handler(IpcChannels.pathListWslDirectories)(trustedEvent, { distro: 'Ubuntu-24.04' })
    ).resolves.toEqual({ path: '/home/me', directories: ['src'], truncated: false })
    expect(wslDistrosMock.runWslCommand).toHaveBeenLastCalledWith(
      'Ubuntu-24.04',
      ['find', '-L', '/home/me', '-mindepth', '1', '-maxdepth', '1', '-printf', '%y\\t%f\\n']
    )
  })

  it('rejects malformed folder-browser requests before reaching the distro', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    registerForTest(vi.fn())
    const list = handler(IpcChannels.pathListWslDirectories)

    await expect(list(trustedEvent, { distro: 'Ubuntu', path: '/home/me\nx' })).rejects.toThrow('Invalid IPC payload for path:list-wsl-directories.')
    await expect(list(trustedEvent, { distro: 'Ubuntu', path: '../etc' })).rejects.toThrow('Invalid folder path.')
    await expect(list(trustedEvent, { distro: '--help' })).rejects.toThrow('Invalid IPC payload for path:list-wsl-directories.')
    expect(wslDistrosMock.runWslCommand).not.toHaveBeenCalled()
  })

  it('does not browse WSL folders on macOS', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    registerForTest(vi.fn())

    await expect(
      handler(IpcChannels.pathListWslDirectories)(trustedEvent, { distro: 'Ubuntu-24.04' })
    ).rejects.toThrow('only be browsed on Windows')
    expect(wslDistrosMock.runWslCommand).not.toHaveBeenCalled()
  })
})
