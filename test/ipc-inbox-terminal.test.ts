import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { trustedIpcSender } from './helpers/ipc-sender'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../src/shared/types'

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

const workspaceMock = vi.hoisted(() => ({
  createTodoProject: vi.fn(), createTodoTask: vi.fn(), createSession: vi.fn(), duplicateSession: vi.fn(),
  getSession: vi.fn(), loadWorkspace: vi.fn(), moveTodoTask: vi.fn(), removeTodoProject: vi.fn(),
  removeTodoTask: vi.fn(), removeSession: vi.fn(), reorderSession: vi.fn(), createSessionTab: vi.fn(), removeSessionTab: vi.fn(),
  selectSessionTab: vi.fn(), updateTodoProject: vi.fn(), updateTodoTask: vi.fn(), updateSession: vi.fn(), updateSessionTab: vi.fn(),
}))

vi.mock('electron', () => electronMock)
vi.mock('../src/main/store/workspace', () => workspaceMock)
vi.mock('../src/main/wsl/paths', async () => ({
  ...await vi.importActual('../src/main/wsl/paths'),
  canonicalizeWslPath: vi.fn(), resolveForTarget: vi.fn(), toWindows: vi.fn(), uncPathFor: vi.fn(),
}))
vi.mock('../src/main/wsl/distros', () => ({ isWslAvailable: vi.fn(), listDistros: vi.fn(), runWslCommand: vi.fn() }))

import { IpcChannels } from '../src/shared/ipc'
import { registerIpcHandlers } from '../src/main/ipc'
import { canonicalizeWslPath } from '../src/main/wsl/paths'
import { listDistros, runWslCommand } from '../src/main/wsl/distros'

const { security, event: trustedEvent } = trustedIpcSender()
const size = { cols: 80, rows: 24 }
const palette = { foreground: '#ffffff', background: '#000000' }
const handler = (channel: string): Handler => {
  const registered = electronMock.handlers.get(channel)
  if (!registered) throw new Error(`No handler registered for ${channel}`)
  return registered
}

describe('the Inbox terminal over IPC', () => {
  const ptyManager = { savedDirectory: vi.fn(), ensure: vi.fn(() => 'running'), terminalInfo: vi.fn(), status: vi.fn() }

  beforeEach(() => {
    electronMock.handlers.clear()
    workspaceMock.getSession.mockReset().mockResolvedValue(null)
    ptyManager.ensure.mockClear()
    registerIpcHandlers(security, ptyManager as never, {} as never, {} as never, {} as never)
  })

  it('starts a shell for the reserved session ID in the home directory, without consulting the workspace', async () => {
    const terminalId = 'inbox-terminal:tab:inbox-terminal:tab:default:pane:pane-1'
    await expect(handler(IpcChannels.ptyEnsure)(trustedEvent, { terminalId, sessionId: 'inbox-terminal', size, palette })).resolves.toBe('running')
    expect(workspaceMock.getSession).not.toHaveBeenCalled()
    const call = ptyManager.ensure.mock.calls[0] as unknown as [string, Session]
    expect(call[0]).toBe(terminalId)
    expect(call[1]).toMatchObject({ id: 'inbox-terminal', kind: process.platform === 'win32' ? 'wsl' : 'native' })
  })

  it('still resolves an ordinary session from the workspace', async () => {
    const session: Session = { id: 'ses-1', name: 'App', kind: 'native', createdAt: '' }
    workspaceMock.getSession.mockResolvedValue(session)
    await handler(IpcChannels.ptyEnsure)(trustedEvent, { terminalId: 't1', sessionId: 'ses-1', size, palette })
    expect((ptyManager.ensure.mock.calls[0] as unknown as [string, Session])[1]).toBe(session)
  })

  it('does not let anything but a terminal request name it: session file access is not available', async () => {
    await expect(handler(IpcChannels.filesList)(trustedEvent, { sessionId: 'inbox-terminal', path: '' })).rejects.toThrow()
    expect(workspaceMock.getSession).not.toHaveBeenCalled()
  })
})

describe('choosing the sidebar terminal WSL distribution', () => {
  const terminalId = 'inbox-terminal:tab:inbox-terminal:tab:default:pane:pane-1'
  const request = { terminalId, sessionId: 'inbox-terminal', size, palette }
  const pty = {
    ensure: vi.fn((_id: string, _session: Session) => 'running'), restart: vi.fn((_id: string, _session: Session) => 'running'), savedDirectory: vi.fn(),
    terminalInfo: vi.fn(), statuses: vi.fn(() => ({})), disposeForSourceSession: vi.fn(),
  }
  const configure = (distro: string | null) => handler(IpcChannels.ptyConfigureInbox)(trustedEvent, { distro })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.mocked(listDistros).mockResolvedValue([
      { name: 'Ubuntu', state: 'Running', version: 2, isDefault: true },
      { name: 'Debian', state: 'Running', version: 2, isDefault: false },
    ])
    pty.savedDirectory.mockReset()
    pty.terminalInfo.mockReset()
    pty.statuses.mockReturnValue({})
    registerIpcHandlers(security, pty as never, {} as never, {} as never, {} as never)
  })
  afterEach(() => vi.restoreAllMocks())

  it('switches only the sidebar shells, and uses the choice on ensure and restart', async () => {
    await handler(IpcChannels.ptyEnsure)(trustedEvent, request)
    pty.statuses.mockReturnValue({ [terminalId]: 'running', other: 'running' })
    pty.terminalInfo.mockImplementation((id: string) => ({ sessionId: id === terminalId ? 'inbox-terminal' : 'ses-other', directory: null }))
    await expect(configure('Debian')).resolves.toMatchObject({ session: { distro: 'Debian' }, changed: true })
    expect(pty.disposeForSourceSession).toHaveBeenCalledExactlyOnceWith('inbox-terminal')
    for (const channel of [IpcChannels.ptyEnsure, IpcChannels.ptyRestart]) {
      await handler(channel)(trustedEvent, request)
    }
    expect(pty.ensure.mock.lastCall?.[1]).toMatchObject({ distro: 'Debian' })
    expect(pty.restart.mock.lastCall?.[1]).toMatchObject({ distro: 'Debian' })
    await expect(configure(null)).resolves.toMatchObject({ session: { distro: 'Ubuntu' }, changed: true })
  })

  it('rejects missing distros before stopping any shells or changing the current target', async () => {
    await expect(configure('Missing')).rejects.toThrow('was not found')
    expect(pty.disposeForSourceSession).not.toHaveBeenCalled()
    await handler(IpcChannels.ptyEnsure)(trustedEvent, request)
    expect(pty.ensure.mock.lastCall?.[1]).toMatchObject({ distro: 'Ubuntu' })
  })

  it('preserves saved pane directories on startup, and leaves shells alone when reapplying the same distro', async () => {
    await configure('Debian')
    expect(pty.disposeForSourceSession).not.toHaveBeenCalled()
    pty.statuses.mockReturnValue({ [terminalId]: 'running' })
    pty.terminalInfo.mockReturnValue({ sessionId: 'inbox-terminal', directory: null })
    await configure('Debian')
    expect(pty.disposeForSourceSession).not.toHaveBeenCalled()
  })

  it('follows the latest Windows default when default is reapplied', async () => {
    await configure(null)
    vi.mocked(listDistros).mockResolvedValue([
      { name: 'Ubuntu', state: 'Running', version: 2, isDefault: false },
      { name: 'Debian', state: 'Running', version: 2, isDefault: true },
    ])
    await expect(configure(null)).resolves.toMatchObject({ session: { distro: 'Debian' }, changed: true })
    await handler(IpcChannels.ptyEnsure)(trustedEvent, request)
    expect(pty.ensure.mock.lastCall?.[1]).toMatchObject({ distro: 'Debian' })
  })

  it.each([IpcChannels.ptyEnsure, IpcChannels.ptyRestart])('cancels an old %s still checking its saved directory when the distro changes', async (channel) => {
    pty.savedDirectory.mockReturnValue('/home/me/app')
    vi.mocked(canonicalizeWslPath).mockResolvedValue('/home/me/app')
    let finishCheck!: (value: Awaited<ReturnType<typeof runWslCommand>>) => void
    vi.mocked(runWslCommand).mockImplementationOnce(() => new Promise((resolve) => { finishCheck = resolve }))
    const pending = handler(channel)(trustedEvent, request)
    await vi.waitFor(() => expect(runWslCommand).toHaveBeenCalled())
    await configure('Debian')
    finishCheck({ stdout: '', stderr: '', code: 0 })
    await expect(pending).resolves.toBe('none')
    expect(pty.ensure).not.toHaveBeenCalled()
    expect(pty.restart).not.toHaveBeenCalled()
  })
})

describe('Inbox terminal chat launches over IPC', () => {
  const terminalId = 'inbox-thread:ses_chat'
  let directory: string
  const pty = { savedDirectory: vi.fn(), ensure: vi.fn(() => 'running'), restart: vi.fn(() => 'running'), terminalInfo: vi.fn(), dispose: vi.fn() }
  const launch = { agent: { executable: 'custom-opencode', args: ['--server', 'http://127.0.0.1:49374', '--session', 'ses_chat'] }, environment: { OPENCODE_PASSWORD: 'test-password' } }
  const chat = { fileRoot: vi.fn(), terminalSession: vi.fn(), terminalLaunch: vi.fn(async () => launch), removeDraft: vi.fn(), removeThreadWorktree: vi.fn() }
  const recorder = { remove: vi.fn() }
  const request = () => ({ terminalId, sessionId: terminalId, size, palette })

  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), 'mde-thread-terminal-'))
    vi.clearAllMocks()
    electronMock.handlers.clear()
    chat.fileRoot.mockImplementation(() => ({ id: 'ses_chat', name: 'Chat', kind: 'native', path: directory, createdAt: '' }))
    chat.terminalSession.mockImplementation(() => ({ id: terminalId, name: 'Chat', kind: 'native', createdAt: '' }))
    registerIpcHandlers(security, pty as never, {} as never, {} as never, { chat, recorder } as never)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(directory, { recursive: true, force: true })
  })

  it('attaches to the recorded API conversation and uses the configured executable on ensure and reopen', async () => {
    for (const channel of [IpcChannels.ptyEnsure, IpcChannels.ptyRestart]) {
      await expect(handler(channel)(trustedEvent, request())).resolves.toBe('running')
    }
    for (const fn of [pty.ensure, pty.restart]) {
      expect(fn).toHaveBeenCalledWith(terminalId, expect.objectContaining({ id: terminalId }), size, palette, {
        directory,
        ...launch,
      })
    }
    expect(workspaceMock.getSession).not.toHaveBeenCalled()
  })

  it('rejects other pane identities, missing threads and removed folders', async () => {
    await expect(handler(IpcChannels.ptyEnsure)(trustedEvent, { ...request(), terminalId: 'another-pane' })).rejects.toThrow('Invalid Inbox')
    await fs.rm(directory, { recursive: true })
    await expect(handler(IpcChannels.ptyEnsure)(trustedEvent, request())).rejects.toThrow('directory is not available')
    chat.terminalSession.mockImplementation(() => { throw new Error('Thread no longer exists') })
    await expect(handler(IpcChannels.ptyEnsure)(trustedEvent, request())).rejects.toThrow('no longer exists')
    expect(pty.ensure).not.toHaveBeenCalled()
  })

  it('uses the thread’s recorded WSL distro and worktree directory', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const path = '/home/me/worktrees/task'
    chat.fileRoot.mockImplementation(() => ({ id: 'ses_chat', name: 'Chat', kind: 'wsl', distro: 'Ubuntu-24.04', path, createdAt: '' }))
    chat.terminalSession.mockImplementation(() => ({ id: terminalId, name: 'Chat', kind: 'wsl', distro: 'Ubuntu-24.04', createdAt: '' }))
    vi.mocked(canonicalizeWslPath).mockResolvedValue(path)
    vi.mocked(runWslCommand).mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    await handler(IpcChannels.ptyEnsure)(trustedEvent, request())
    expect(pty.ensure).toHaveBeenCalledWith(terminalId, expect.objectContaining({ kind: 'wsl', distro: 'Ubuntu-24.04' }), size, palette, {
      directory: path, ...launch,
    })
  })

  it('rejects a thread removed while its directory is being checked', async () => {
    chat.terminalSession.mockImplementationOnce(() => ({ id: terminalId, name: 'Chat', kind: 'native', path: directory, createdAt: '' }))
      .mockImplementationOnce(() => { throw new Error('Thread no longer exists') })
    await expect(handler(IpcChannels.ptyEnsure)(trustedEvent, request())).rejects.toThrow('no longer exists')
    expect(pty.ensure).not.toHaveBeenCalled()
  })

  it('disposes the associated terminal only after removing the thread succeeds', async () => {
    await handler(IpcChannels.inboxRemove)(trustedEvent, { id: 'ses_chat' })
    expect(recorder.remove).toHaveBeenCalledWith('ses_chat')
    expect(pty.dispose).toHaveBeenCalledWith(terminalId)
    pty.dispose.mockClear()
    chat.removeThreadWorktree.mockRejectedValueOnce(new Error('Worktree is dirty'))
    await expect(handler(IpcChannels.inboxRemove)(trustedEvent, { id: 'ses_chat', removeWorktree: true })).rejects.toThrow('dirty')
    expect(pty.dispose).not.toHaveBeenCalled()
  })
})
