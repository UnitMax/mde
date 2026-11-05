import { homedir } from 'node:os'
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
  createProject: vi.fn(), createTodoProject: vi.fn(), createTodoTask: vi.fn(), createSession: vi.fn(), duplicateSession: vi.fn(),
  getSession: vi.fn(), loadWorkspace: vi.fn(), moveSession: vi.fn(), moveTodoTask: vi.fn(), removeProject: vi.fn(), removeTodoProject: vi.fn(),
  removeTodoTask: vi.fn(), removeSession: vi.fn(), reorderSession: vi.fn(), createSessionTab: vi.fn(), removeSessionTab: vi.fn(),
  selectSessionTab: vi.fn(), updateProject: vi.fn(), updateTodoProject: vi.fn(), updateTodoTask: vi.fn(), updateSession: vi.fn(), updateSessionTab: vi.fn(),
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
import { runWslCommand } from '../src/main/wsl/distros'

const { security, event: trustedEvent } = trustedIpcSender()
const size = { cols: 80, rows: 24 }
const palette = { foreground: '#ffffff', background: '#000000' }
const handler = (channel: string): Handler => {
  const registered = electronMock.handlers.get(channel)
  if (!registered) throw new Error(`No handler registered for ${channel}`)
  return registered
}

describe('the Inbox terminal over IPC', () => {
  const ptyManager = { ensure: vi.fn(() => 'running'), terminalInfo: vi.fn(), status: vi.fn() }

  beforeEach(() => {
    electronMock.handlers.clear()
    workspaceMock.getSession.mockReset().mockResolvedValue(null)
    ptyManager.ensure.mockClear()
    registerIpcHandlers(security, ptyManager as never, {} as never, {} as never, {} as never, {} as never, {} as never)
  })

  it('starts a shell for the reserved session ID in the home directory, without consulting the workspace', async () => {
    const terminalId = 'inbox-terminal:tab:inbox-terminal:tab:default:pane:pane-1'
    await expect(handler(IpcChannels.ptyEnsure)(trustedEvent, { terminalId, sessionId: 'inbox-terminal', size, palette })).resolves.toBe('running')
    expect(workspaceMock.getSession).not.toHaveBeenCalled()
    const call = ptyManager.ensure.mock.calls[0] as unknown as [string, Session]
    expect(call[0]).toBe(terminalId)
    expect(call[1]).toMatchObject({ id: 'inbox-terminal', kind: process.platform === 'win32' ? 'wsl' : 'native' })
    if (process.platform !== 'win32') expect(call[1].path).toBe(homedir())
  })

  it('still resolves an ordinary session from the workspace', async () => {
    const session: Session = { id: 'ses-1', projectId: 'p', name: 'App', kind: 'native', path: '/tmp', createdAt: '' }
    workspaceMock.getSession.mockResolvedValue(session)
    await handler(IpcChannels.ptyEnsure)(trustedEvent, { terminalId: 't1', sessionId: 'ses-1', size, palette })
    expect((ptyManager.ensure.mock.calls[0] as unknown as [string, Session])[1]).toBe(session)
  })

  it('does not let anything but a terminal request name it: session file access is not available', async () => {
    await expect(handler(IpcChannels.filesList)(trustedEvent, { sessionId: 'inbox-terminal', path: '' })).rejects.toThrow()
    expect(workspaceMock.getSession).toHaveBeenCalledWith('inbox-terminal')
  })
})

describe('Inbox terminal chat launches over IPC', () => {
  const terminalId = 'inbox-thread:ses_chat'
  let directory: string
  const pty = { ensure: vi.fn(() => 'running'), restart: vi.fn(() => 'running'), terminalInfo: vi.fn(), dispose: vi.fn() }
  const launch = { agent: { executable: 'custom-opencode', args: ['--server', 'http://127.0.0.1:49374', '--session', 'ses_chat'] }, environment: { OPENCODE_PASSWORD: 'test-password' } }
  const chat = { terminalSession: vi.fn(), terminalLaunch: vi.fn(async () => launch), removeDraft: vi.fn(), removeThreadWorktree: vi.fn() }
  const recorder = { remove: vi.fn() }
  const request = () => ({ terminalId, sessionId: terminalId, size, palette })

  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), 'mde-thread-terminal-'))
    vi.clearAllMocks()
    electronMock.handlers.clear()
    chat.terminalSession.mockImplementation(() => ({ id: terminalId, projectId: '', name: 'Chat', kind: 'native', path: directory, createdAt: '' }))
    registerIpcHandlers(security, pty as never, {} as never, {} as never, {} as never, {} as never, { chat, recorder } as never)
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
      expect(fn).toHaveBeenCalledWith(terminalId, expect.objectContaining({ path: directory }), size, palette, {
        directory,
        ...launch,
      })
    }
    expect(workspaceMock.getSession).not.toHaveBeenCalled()
  })

  it('rejects other pane identities, launch overrides, missing threads and removed folders', async () => {
    await expect(handler(IpcChannels.ptyEnsure)(trustedEvent, { ...request(), terminalId: 'another-pane' })).rejects.toThrow('Invalid Inbox')
    await expect(handler(IpcChannels.ptyEnsure)(trustedEvent, { ...request(), launch: { sourceTerminalId: 'pane', directory: 'terminal' } })).rejects.toThrow('Invalid Inbox')
    await fs.rm(directory, { recursive: true })
    await expect(handler(IpcChannels.ptyEnsure)(trustedEvent, request())).rejects.toThrow('directory is not available')
    chat.terminalSession.mockImplementation(() => { throw new Error('Thread no longer exists') })
    await expect(handler(IpcChannels.ptyEnsure)(trustedEvent, request())).rejects.toThrow('no longer exists')
    expect(pty.ensure).not.toHaveBeenCalled()
  })

  it('uses the thread’s recorded WSL distro and worktree directory', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const path = '/home/me/worktrees/task'
    chat.terminalSession.mockImplementation(() => ({ id: terminalId, projectId: '', name: 'Chat', kind: 'wsl', distro: 'Ubuntu-24.04', path, createdAt: '' }))
    vi.mocked(canonicalizeWslPath).mockResolvedValue(path)
    vi.mocked(runWslCommand).mockResolvedValue({ stdout: '', stderr: '', code: 0 })
    await handler(IpcChannels.ptyEnsure)(trustedEvent, request())
    expect(pty.ensure).toHaveBeenCalledWith(terminalId, expect.objectContaining({ kind: 'wsl', distro: 'Ubuntu-24.04', path }), size, palette, {
      directory: path, ...launch,
    })
  })

  it('rejects a thread removed while its directory is being checked', async () => {
    chat.terminalSession.mockImplementationOnce(() => ({ id: terminalId, projectId: '', name: 'Chat', kind: 'native', path: directory, createdAt: '' }))
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
