import { trustedIpcSender } from './helpers/ipc-sender'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenCodeSessionSummary, Session } from '../src/shared/types'
import { IpcChannels } from '../src/shared/ipc'

type Handler = (event: unknown, request: unknown) => Promise<unknown> | unknown
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  getSession: vi.fn(), list: vi.fn(), read: vi.fn(),
  canonicalize: vi.fn(), runWslCommand: vi.fn()
}))
vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.1' }, BrowserWindow: {}, clipboard: {}, dialog: {}, shell: {},
  ipcMain: { handle: (name: string, handler: Handler) => mocks.handlers.set(name, handler) }
}))
vi.mock('../src/main/store/workspace', () => ({
  getSession: mocks.getSession,
  createProject: vi.fn(), createTodoProject: vi.fn(), createTodoTask: vi.fn(), createSession: vi.fn(),
  duplicateSession: vi.fn(), loadWorkspace: vi.fn(), moveSession: vi.fn(), removeProject: vi.fn(),
  removeTodoProject: vi.fn(), removeTodoTask: vi.fn(), removeSession: vi.fn(), reorderSession: vi.fn(),
  createSessionTab: vi.fn(), removeSessionTab: vi.fn(), selectSessionTab: vi.fn(), updateProject: vi.fn(),
  updateTodoProject: vi.fn(), updateTodoTask: vi.fn(), moveTodoTask: vi.fn(), updateSession: vi.fn(), updateSessionTab: vi.fn()
}))
vi.mock('../src/main/opencode/sessions', async () => ({
  ...await vi.importActual<typeof import('../src/main/opencode/sessions')>('../src/main/opencode/sessions'),
  listOpenCodeSessions: mocks.list,
  readOpenCodeSession: mocks.read
}))
vi.mock('../src/main/wsl/paths', async () => ({
  ...await vi.importActual<typeof import('../src/main/wsl/paths')>('../src/main/wsl/paths'),
  canonicalizeWslPath: mocks.canonicalize
}))
vi.mock('../src/main/wsl/distros', async () => ({
  ...await vi.importActual<typeof import('../src/main/wsl/distros')>('../src/main/wsl/distros'),
  runWslCommand: mocks.runWslCommand
}))
import { registerIpcHandlers } from '../src/main/ipc'

const { security, event: trustedEvent } = trustedIpcSender()

const session: Session = {
  id: 'workspace-1', projectId: 'project-1', name: 'App', kind: 'wsl',
  distro: 'Ubuntu-24.04', path: '/workspace/current', createdAt: '2026-01-01T00:00:00Z'
}
const saved: OpenCodeSessionSummary = {
  id: 'ses_chosen', title: 'Fix tests', directory: "/home/me/other project's files;literal",
  createdAt: 100, updatedAt: 200
}
const request = { sessionId: session.id, sourceTerminalId: 'source-pane', executable: 'custom-opencode' }
const ensureRequest = {
  sessionId: session.id, terminalId: 'new-pane', size: { cols: 80, rows: 24 },
  palette: { foreground: '#ffffff', background: '#000000' },
  launch: { sourceTerminalId: 'source-pane', executable: 'custom-opencode', opencodeSessionId: saved.id }
}
const terminalInfo = vi.fn()
const ensure = vi.fn(() => 'running')
const dispose = vi.fn()

function invoke(channel: string, request: unknown): Promise<unknown> {
  return Promise.resolve(mocks.handlers.get(channel)!(trustedEvent, request))
}

beforeEach(() => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  mocks.handlers.clear()
  mocks.getSession.mockReset().mockResolvedValue(session)
  mocks.list.mockReset().mockResolvedValue([saved])
  mocks.read.mockReset().mockResolvedValue(saved)
  mocks.canonicalize.mockReset().mockImplementation(async (_distro, path) => path)
  mocks.runWslCommand.mockReset().mockResolvedValue({ code: 0, stdout: '', stderr: '' })
  terminalInfo.mockReset().mockImplementation((id) => id === 'source-pane' ? { sessionId: session.id, directory: session.path } : null)
  ensure.mockClear()
  dispose.mockClear()
  registerIpcHandlers(security, { terminalInfo, ensure, dispose } as never, {} as never, {} as never, {} as never)
})
afterEach(() => vi.restoreAllMocks())

describe('OpenCode history IPC and resume', () => {
  it('derives the distro from the owning workspace session', async () => {
    expect(await invoke(IpcChannels.opencodeSessionsList, request)).toEqual([saved])
    expect(mocks.list).toHaveBeenCalledWith(session, 'custom-opencode')
  })

  it('rejects missing or foreign source terminals and malformed executables', async () => {
    terminalInfo.mockReturnValue({ sessionId: 'other-session', directory: '/workspace/other' })
    await expect(invoke(IpcChannels.opencodeSessionsList, request)).rejects.toThrow('source terminal')
    terminalInfo.mockReturnValue(null)
    await expect(invoke(IpcChannels.opencodeSessionsList, request)).rejects.toThrow('source terminal')
    await expect(invoke(IpcChannels.opencodeSessionsList, { ...request, executable: 'opencode\nunsafe' })).rejects.toThrow('Invalid IPC payload for opencode-sessions:list.')
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('rejects native sessions and non-Windows hosts', async () => {
    mocks.getSession.mockResolvedValue({ ...session, kind: 'native' })
    await expect(invoke(IpcChannels.opencodeSessionsList, request)).rejects.toThrow('Windows/WSL')
    mocks.getSession.mockResolvedValue(session)
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    await expect(invoke(IpcChannels.opencodeSessionsList, request)).rejects.toThrow('Windows/WSL')
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('resumes the chosen ID in its verified saved directory, preserving literal path characters', async () => {
    expect(await invoke(IpcChannels.ptyEnsure, ensureRequest)).toBe('running')
    expect(mocks.read).toHaveBeenCalledWith(session, 'custom-opencode', 'ses_chosen')
    expect(mocks.runWslCommand).toHaveBeenCalledWith(session.distro, ['test', '-d', saved.directory])
    expect(ensure).toHaveBeenCalledWith('new-pane', session, ensureRequest.size, ensureRequest.palette, {
      directory: saved.directory, agent: { executable: 'custom-opencode', args: ['--session', saved.id] }
    })
  })

  it('refuses deleted sessions and unavailable saved directories before spawning', async () => {
    mocks.read.mockRejectedValueOnce(new Error('This OpenCode session no longer exists.'))
    await expect(invoke(IpcChannels.ptyEnsure, ensureRequest)).rejects.toThrow('no longer exists')
    mocks.runWslCommand.mockResolvedValue({ code: 1, stdout: '', stderr: '' })
    await expect(invoke(IpcChannels.ptyEnsure, ensureRequest)).rejects.toThrow('saved OpenCode session directory')
    expect(ensure).not.toHaveBeenCalled()
  })

  it('rejects spoofed IDs and unsafe database directories', async () => {
    await expect(invoke(IpcChannels.ptyEnsure, { ...ensureRequest, launch: 'invalid' }))
      .rejects.toThrow('Invalid IPC payload for pty:ensure.')
    await expect(invoke(IpcChannels.ptyEnsure, {
      ...ensureRequest, launch: { ...ensureRequest.launch, opencodeSessionId: "ses_x' OR 1=1" }
    })).rejects.toThrow('Invalid IPC payload for pty:ensure.')
    expect(mocks.read).not.toHaveBeenCalled()
    mocks.read.mockResolvedValue({ ...saved, directory: '/workspace/../../etc' })
    await expect(invoke(IpcChannels.ptyEnsure, ensureRequest)).rejects.toThrow('saved OpenCode session directory')
    expect(ensure).not.toHaveBeenCalled()
  })

  it('reattaches an existing TUI without querying a deleted record or closed source pane', async () => {
    terminalInfo.mockImplementation((id) => id === 'new-pane' ? { sessionId: session.id, directory: saved.directory } : null)
    expect(await invoke(IpcChannels.ptyEnsure, ensureRequest)).toBe('running')
    expect(mocks.read).not.toHaveBeenCalled()
    expect(ensure).toHaveBeenCalledWith('new-pane', session, ensureRequest.size, ensureRequest.palette, undefined)
  })

  it('does not spawn a pane closed while its history lookup is pending', async () => {
    let resolve!: (value: OpenCodeSessionSummary) => void
    mocks.read.mockReturnValue(new Promise<OpenCodeSessionSummary>((done) => { resolve = done }))
    const pending = invoke(IpcChannels.ptyEnsure, ensureRequest)
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalled())
    await invoke(IpcChannels.ptyDispose, 'new-pane')
    resolve(saved)
    expect(await pending).toBe('none')
    expect(ensure).not.toHaveBeenCalled()
  })

  it('rechecks source ownership after the database and directory checks', async () => {
    terminalInfo.mockReturnValueOnce(null).mockReturnValueOnce({ sessionId: session.id, directory: session.path }).mockReturnValue(null)
    await expect(invoke(IpcChannels.ptyEnsure, ensureRequest)).rejects.toThrow('source terminal')
    expect(ensure).not.toHaveBeenCalled()
  })
})
