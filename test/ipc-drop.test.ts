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
  createSessionTab: vi.fn(),
  removeSessionTab: vi.fn(),
  selectSessionTab: vi.fn(),
  updateProject: vi.fn(),
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
vi.mock('../src/main/wsl/paths', () => ({
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

function nativeSession(): Session {
  return {
    id: 'session-1',
    projectId: 'project-1',
    name: 'App',
    kind: 'native',
    path: '/tmp',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
}

function registerForTest(ptyManager: { terminalInfo: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn> }): void {
  registerIpcHandlers(ptyManager as never, {} as never, {} as never, {} as never)
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

    await expect(handler(IpcChannels.ptyDropFiles)({}, request)).resolves.toEqual({
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
      handler(IpcChannels.ptyDropFiles)({}, {
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

  it('resolves a tree entry using its saved source session and the receiving terminal', async () => {
    const target = nativeSession()
    const source = { ...target, id: 'source', path: '/tmp/another-project' }
    workspaceMock.getSession.mockImplementation(async (id) => id === 'source' ? source : target)
    const descriptor = { name: 'src', nativePath: '/tmp/another-project/src' }
    dropMock.fileTreeDropFile.mockResolvedValue(descriptor)
    dropMock.resolveTerminalDrop.mockResolvedValue({ insertions: [], acceptedCount: 0, rejections: [] })
    registerForTest({ terminalInfo: vi.fn(() => ({ sessionId: target.id })), status: vi.fn(() => 'running') })
    await handler(IpcChannels.ptyDropFiles)({}, {
      terminalId: 'pane-1', files: [], mode: 'shell', treeEntry: { sessionId: 'source', path: 'src' },
    })
    expect(dropMock.fileTreeDropFile).toHaveBeenCalledWith(source, 'src', process.platform)
    expect(dropMock.resolveTerminalDrop).toHaveBeenCalledWith(target, process.platform, [descriptor], 'shell')
  })

  it('reports a tree drop onto a stopped terminal', async () => {
    registerForTest({ terminalInfo: vi.fn(() => null), status: vi.fn(() => 'exited') })
    await expect(handler(IpcChannels.ptyDropFiles)({}, {
      terminalId: 'pane-1', files: [], mode: 'shell', treeEntry: { sessionId: 'source', path: 'src' },
    })).resolves.toEqual({
      insertions: [], acceptedCount: 0, rejections: [{ name: 'src', code: 'terminal-unavailable' }],
    })
  })

  it.each([{ sessionId: 'source', path: '../outside' }, { sessionId: 7, path: 'src' }, null])(
    'validates the tree entry before loading sessions', async (treeEntry) => {
      registerForTest({ terminalInfo: vi.fn(), status: vi.fn() })
      await expect(handler(IpcChannels.ptyDropFiles)({}, {
        terminalId: 'pane-1', files: [], mode: 'shell', treeEntry,
      })).rejects.toThrow('Invalid terminal file drop.')
      expect(workspaceMock.getSession).not.toHaveBeenCalled()
    }
  )

  it('validates the preload payload before resolving paths', async () => {
    const terminalInfo = vi.fn(() => ({ sessionId: 'session-1', directory: '/tmp' }))
    const status = vi.fn(() => 'running')
    registerForTest({ terminalInfo, status })

    await expect(
      handler(IpcChannels.ptyDropFiles)({}, {
        terminalId: 'pane-1',
        files: [{ name: 'image.png', nativePath: 42 }],
        mode: 'shell'
      })
    ).rejects.toThrow('Invalid terminal file drop.')
  })

  it('validates the drop mode before resolving paths', async () => {
    const terminalInfo = vi.fn(() => ({ sessionId: 'session-1', directory: '/tmp' }))
    const status = vi.fn(() => 'running')
    registerForTest({ terminalInfo, status })

    await expect(
      handler(IpcChannels.ptyDropFiles)({}, {
        terminalId: 'pane-1',
        files: [{ name: 'image.png', nativePath: '/tmp/image.png' }],
        mode: 'unknown'
      })
    ).rejects.toThrow('Invalid terminal file drop.')
  })
})
