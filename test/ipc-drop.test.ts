import { tmpdir } from 'node:os'
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
  createSessionTab: vi.fn(),
  removeSessionTab: vi.fn(),
  selectSessionTab: vi.fn(),
  updateTodoProject: vi.fn(),
  updateTodoTask: vi.fn(),
  updateSession: vi.fn(),
  updateSessionTab: vi.fn()
}))

const dropMock = vi.hoisted(() => ({
  fileTreeDropFile: vi.fn(),
  resolveTerminalDrop: vi.fn()
}))

vi.mock('electron', () => electronMock)
vi.mock('../src/main/store/workspace', () => workspaceMock)
vi.mock('../src/main/pty/drop', () => dropMock)
vi.mock('../src/main/wsl/paths', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/wsl/paths')>(),
  canonicalizeWslPath: vi.fn(),
  resolveForTarget: vi.fn(),
  toWindows: vi.fn(),
  uncPathFor: vi.fn()
}))
vi.mock('../src/main/wsl/distros', () => ({
  isWslAvailable: vi.fn(),
  listDistros: vi.fn(),
  runWslCommand: vi.fn()
}))

import { IpcChannels, type DropPtyFilesRequest } from '../src/shared/ipc'
import { registerIpcHandlers } from '../src/main/ipc'

const { security, event: trustedEvent } = trustedIpcSender()

function nativeSession(): Session {
  return {
    id: 'session-1',
    name: 'App',
    kind: 'native',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
}

function registerForTest(ptyManager: { terminalInfo: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn> }): void {
  registerIpcHandlers(security, ptyManager as never, {} as never, {} as never, {} as never)
}

function handler(channel: string): Handler {
  const registered = electronMock.handlers.get(channel)
  if (!registered) throw new Error(`No handler registered for ${channel}`)
  return registered
}

describe('terminal file-drop IPC', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    workspaceMock.getSession.mockReset()
    dropMock.resolveTerminalDrop.mockReset()
    dropMock.fileTreeDropFile.mockReset()
  })

  it('resolves a running terminal drop against its source session', async () => {
    const terminalInfo = vi.fn(() => ({ sessionId: 'session-1', directory: '/tmp' }))
    const status = vi.fn(() => 'running')
    const ptyManager = { terminalInfo, status }
    const request: DropPtyFilesRequest = {
      terminalId: 'pane-1',
      files: [{ name: 'image.png', nativePath: '/tmp/image.png' }],
      mode: 'shell'
    }
    const resolved = {
      insertions: ["'/tmp/image.png' "],
      acceptedCount: 1,
      rejections: []
    }

    workspaceMock.getSession.mockResolvedValue(nativeSession())
    dropMock.resolveTerminalDrop.mockResolvedValue(resolved)
    registerForTest(ptyManager)

    await expect(handler(IpcChannels.ptyDropFiles)(trustedEvent, request)).resolves.toEqual({
      ...resolved
    })
    expect(dropMock.resolveTerminalDrop).toHaveBeenCalledWith(
      nativeSession(),
      process.platform,
      request.files,
      request.mode
    )
  })

  it('rejects drops when the terminal is absent or no longer running', async () => {
    const terminalInfo = vi.fn(() => ({ sessionId: 'session-1', directory: null }))
    const status = vi.fn(() => 'exited')
    registerForTest({ terminalInfo, status })

    await expect(
      handler(IpcChannels.ptyDropFiles)(trustedEvent, {
        terminalId: 'pane-1',
        files: [{ name: 'image.png', nativePath: '/tmp/image.png' }],
        mode: 'shell'
      })
    ).resolves.toEqual({
      insertions: [],
      acceptedCount: 0,
      rejections: [{ name: 'image.png', code: 'terminal-unavailable' }]
    })
    expect(workspaceMock.getSession).not.toHaveBeenCalled()
    expect(dropMock.resolveTerminalDrop).not.toHaveBeenCalled()
  })


  it('resolves a tree drag from the source terminal directory', async () => {
    const target = nativeSession()
    const source = { ...target, id: 'source', path: '/workspace/launch' }
    const directory = tmpdir()
    workspaceMock.getSession.mockImplementation(async (id) => id === source.id ? source : target)
    const descriptor = { name: 'src', nativePath: '/workspace/current/src' }
    dropMock.fileTreeDropFile.mockResolvedValue(descriptor)
    registerForTest({
      terminalInfo: vi.fn((id) => ({ sessionId: id === 'source-pane' ? source.id : target.id, directory })),
      status: vi.fn(() => 'running'),
    })
    await handler(IpcChannels.ptyDropFiles)(trustedEvent, {
      terminalId: 'target-pane', files: [], mode: 'shell', treeEntry: { terminalId: 'source-pane', directory, path: 'src' },
    })
    expect(dropMock.fileTreeDropFile).toHaveBeenCalledWith({ ...source, path: directory }, 'src', process.platform)
    expect(dropMock.resolveTerminalDrop).toHaveBeenCalledWith(target, process.platform, [descriptor], 'shell')
  })

  it('rejects a tree drag when the source terminal has changed directory', async () => {
    workspaceMock.getSession.mockResolvedValue(nativeSession())
    registerForTest({ terminalInfo: vi.fn(() => ({ sessionId: 'session-1', directory: '/workspace/new' })), status: vi.fn(() => 'running') })
    await expect(handler(IpcChannels.ptyDropFiles)(trustedEvent, {
      terminalId: 'target-pane', files: [], mode: 'shell', treeEntry: { terminalId: 'source-pane', directory: '/workspace/old', path: 'src' },
    })).rejects.toThrow('The terminal directory has changed.')
    expect(dropMock.fileTreeDropFile).not.toHaveBeenCalled()
  })

  it('reports a tree drop onto a stopped terminal', async () => {
    registerForTest({ terminalInfo: vi.fn(() => null), status: vi.fn(() => 'exited') })
    await expect(handler(IpcChannels.ptyDropFiles)(trustedEvent, {
      terminalId: 'pane-1', files: [], mode: 'shell', treeEntry: { sessionId: 'source', path: 'src' },
    })).resolves.toEqual({
      insertions: [], acceptedCount: 0, rejections: [{ name: 'src', code: 'terminal-unavailable' }],
    })
  })

  it.each([{ sessionId: 'source', path: '../outside' }, { sessionId: 7, path: 'src' }, null])(
    'validates the tree entry before loading sessions', async (treeEntry) => {
      registerForTest({ terminalInfo: vi.fn(), status: vi.fn() })
      await expect(handler(IpcChannels.ptyDropFiles)(trustedEvent, {
        terminalId: 'pane-1', files: [], mode: 'shell', treeEntry,
      })).rejects.toThrow('Invalid IPC payload for pty:drop-files.')
      expect(workspaceMock.getSession).not.toHaveBeenCalled()
    }
  )

  it('validates the preload payload before resolving paths', async () => {
    const terminalInfo = vi.fn(() => ({ sessionId: 'session-1', directory: '/tmp' }))
    const status = vi.fn(() => 'running')
    registerForTest({ terminalInfo, status })

    await expect(
      handler(IpcChannels.ptyDropFiles)(trustedEvent, {
        terminalId: 'pane-1',
        files: [{ name: 'image.png', nativePath: 42 }],
        mode: 'shell'
      })
    ).rejects.toThrow('Invalid IPC payload for pty:drop-files.')
  })

  it('validates the drop mode before resolving paths', async () => {
    const terminalInfo = vi.fn(() => ({ sessionId: 'session-1', directory: '/tmp' }))
    const status = vi.fn(() => 'running')
    registerForTest({ terminalInfo, status })

    await expect(
      handler(IpcChannels.ptyDropFiles)(trustedEvent, {
        terminalId: 'pane-1',
        files: [{ name: 'image.png', nativePath: '/tmp/image.png' }],
        mode: 'unknown'
      })
    ).rejects.toThrow('Invalid IPC payload for pty:drop-files.')
  })
})

describe('registered IPC security boundary', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    vi.clearAllMocks()
    registerIpcHandlers(security, {} as never, {} as never, {} as never, {} as never)
  })

  it('authenticates every channel before inspecting hostile payloads', async () => {
    expect([...electronMock.handlers.keys()].sort()).toEqual(Object.values(IpcChannels).sort())
    const hostile = Object.defineProperty({}, 'terminalId', { get: () => { throw new Error('Payload getter executed') } })
    const other = trustedIpcSender()
    for (const registered of electronMock.handlers.values()) {
      await expect(registered(other.event, hostile)).rejects.toThrow('Unauthorized IPC sender.')
      await expect(registered({ sender: trustedEvent.sender, senderFrame: null }, hostile)).rejects.toThrow('Unauthorized IPC sender.')
    }
    expect(workspaceMock.getSession).not.toHaveBeenCalled()
    expect(workspaceMock.createSession).not.toHaveBeenCalled()
    expect(workspaceMock.loadWorkspace).not.toHaveBeenCalled()
    expect(electronMock.clipboard.writeText).not.toHaveBeenCalled()
    expect(electronMock.shell.openExternal).not.toHaveBeenCalled()
    expect(electronMock.app.getVersion).not.toHaveBeenCalled()
  })

  it('validates every channel before privileged handlers can run', async () => {
    for (const [channel, registered] of electronMock.handlers) {
      await expect(registered(trustedEvent, null)).rejects.toThrow(`Invalid IPC payload for ${channel}.`)
    }
    expect(workspaceMock.getSession).not.toHaveBeenCalled()
    expect(workspaceMock.createSession).not.toHaveBeenCalled()
    expect(electronMock.clipboard.writeText).not.toHaveBeenCalled()
    expect(electronMock.app.getVersion).not.toHaveBeenCalled()
  })

  it('rejects additional invocation arguments and permits a valid main-frame request', async () => {
    const invoke = handler(IpcChannels.appInfo) as (...args: unknown[]) => Promise<unknown>
    await expect(invoke(trustedEvent, undefined, 'unexpected')).rejects.toThrow('Invalid IPC argument count for app:info.')
    expect(electronMock.app.getVersion).not.toHaveBeenCalled()
    await expect(invoke(trustedEvent, undefined)).resolves.toMatchObject({ version: '0.0.1' })
    expect(electronMock.app.getVersion).toHaveBeenCalledOnce()
  })

  it('pastes into the sender that asked and hands nothing back', async () => {
    const paste = vi.fn()
    const invoke = handler(IpcChannels.clipboardPaste) as (...args: unknown[]) => Promise<unknown>
    Object.assign(trustedEvent.sender, { paste })
    await expect(invoke(trustedEvent, undefined)).resolves.toBeUndefined()
    expect(paste).toHaveBeenCalledOnce()
    // Another window is not trusted, and a payload is not accepted.
    await expect(invoke(trustedIpcSender().event, undefined)).rejects.toThrow('Unauthorized IPC sender.')
    await expect(invoke(trustedEvent, 'text')).rejects.toThrow('Invalid IPC payload for clipboard:paste.')
    expect(paste).toHaveBeenCalledOnce()
    expect(electronMock.clipboard.writeText).not.toHaveBeenCalled()
  })
})
