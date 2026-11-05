import { homedir } from 'node:os'
import { trustedIpcSender } from './helpers/ipc-sender'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
vi.mock('../src/main/wsl/paths', () => ({ canonicalizeWslPath: vi.fn(), resolveForTarget: vi.fn(), toWindows: vi.fn(), uncPathFor: vi.fn() }))
vi.mock('../src/main/wsl/distros', () => ({ isWslAvailable: vi.fn(), listDistros: vi.fn(), runWslCommand: vi.fn() }))

import { IpcChannels } from '../src/shared/ipc'
import { registerIpcHandlers } from '../src/main/ipc'

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
