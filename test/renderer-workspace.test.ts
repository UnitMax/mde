import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenCodeChatItem, OpenCodeSessionSummary, OpenCodeStreamChunk, Session } from '../src/shared/types'

vi.mock('../src/renderer/terminal/sessions', () => ({ disposeSession: vi.fn() }))

import { useWorkspace } from '../src/renderer/store/workspace'

describe('renderer workspace event bridge', () => {
  const streamListeners: Array<(chunk: OpenCodeStreamChunk) => void> = []
  const api = {
    platform: { info: vi.fn(async () => ({ platform: 'linux', arch: 'x64' })) },
    workspace: { list: vi.fn(async () => ({ projects: [], sessions: [] })) },
    sessions: {
      update: vi.fn(async ({ id, patch }: { id: string; patch: Partial<Session> }) => ({
        id,
        projectId: 'project-1',
        name: 'App',
        kind: 'native' as const,
        path: '/workspace/app',
        createdAt: '2026-01-01T00:00:00.000Z',
        ...patch
      }))
    },
    pty: {
      statuses: vi.fn(async () => ({})),
      onExit: vi.fn(() => vi.fn())
    },
    wsl: {
      available: vi.fn(async () => false),
      distros: vi.fn(async () => [])
    },
    opencode: {
      send: vi.fn(),
      listSessions: vi.fn(),
      selectSession: vi.fn(),
      createSession: vi.fn(),
      replyPermission: vi.fn(async () => undefined),
      onStream: vi.fn((listener: (chunk: OpenCodeStreamChunk) => void) => {
        streamListeners.push(listener)
        return vi.fn()
      })
    }
  }

  beforeEach(() => {
    streamListeners.length = 0
    vi.stubGlobal('window', { api })
    useWorkspace.setState({ opencodeChats: {} })
    api.pty.onExit.mockClear()
    api.sessions.update.mockClear()
    api.opencode.send.mockReset()
    api.opencode.listSessions.mockReset()
    api.opencode.selectSession.mockReset()
    api.opencode.createSession.mockReset()
    api.opencode.onStream.mockClear()
    api.opencode.replyPermission.mockClear()
  })

  it('registers process-lifetime push listeners only once', async () => {
    await Promise.all([useWorkspace.getState().init(), useWorkspace.getState().init()])

    expect(api.pty.onExit).toHaveBeenCalledTimes(1)
    expect(api.opencode.onStream).toHaveBeenCalledTimes(1)

    useWorkspace.getState().selectSession('session-1')

    let resolveSend: ((value: { sessionId: string; messages: OpenCodeChatItem[] }) => void) | undefined
    api.opencode.send.mockImplementation(
      () =>
        new Promise<{ sessionId: string; messages: OpenCodeChatItem[] }>((resolve) => {
          resolveSend = resolve
        })
    )

    const send = useWorkspace.getState().sendOpenCodeMessage('session-1', 'hello')
    await Promise.resolve()
    expect(streamListeners).toHaveLength(1)
    expect(useWorkspace.getState().opencodeChats['session-1']?.pending).toBe(true)

    streamListeners[0]?.({
      sessionId: 'session-1',
      item: { kind: 'reasoning', partId: 'reasoning-1', delta: 'I should inspect this.', done: false }
    })
    streamListeners[0]?.({
      sessionId: 'session-1',
      item: {
        kind: 'tool',
        partId: 'tool-1',
        tool: 'read',
        status: 'pending',
        input: {},
        rawInput: '{"filePath":"/tmp/a"}'
      }
    })
    streamListeners[0]?.({
      sessionId: 'session-1',
      item: { kind: 'text', partId: 'text-1', delta: 'Hello' }
    })
    streamListeners[0]?.({
      sessionId: 'session-1',
      item: {
        kind: 'permission',
        requestId: 'permission-1',
        permission: 'bash',
        patterns: ['git status *'],
        title: 'Inspect the repository'
      }
    })
    streamListeners[0]?.({
      sessionId: 'session-1',
      item: { kind: 'reasoning', partId: 'reasoning-1', delta: ' Next.', done: false }
    })
    expect(useWorkspace.getState().opencodeChats['session-1']?.liveItems).toEqual([
      { id: 'reasoning-1', role: 'reasoning', text: 'I should inspect this. Next.', live: true },
      {
        id: 'tool-1',
        role: 'tool',
        live: true,
        tool: 'read',
        status: 'pending',
        input: {},
        rawInput: '{"filePath":"/tmp/a"}'
      },
      { id: 'text-1', role: 'assistant', text: 'Hello', live: true },
      {
        id: 'permission-1',
        role: 'permission',
        live: true,
        permission: 'bash',
        patterns: ['git status *'],
        title: 'Inspect the repository'
      }
    ])

    await useWorkspace.getState().replyOpenCodePermission('session-1', 'permission-1', 'once')
    expect(api.opencode.replyPermission).toHaveBeenCalledWith({
      sessionId: 'session-1',
      requestId: 'permission-1',
      reply: 'once'
    })
    expect(
      useWorkspace.getState().opencodeChats['session-1']?.liveItems.some((item) => item.id === 'permission-1')
    ).toBe(false)

    streamListeners[0]?.({
      sessionId: 'session-1',
      item: {
        kind: 'tool',
        partId: 'tool-1',
        tool: 'read',
        status: 'completed',
        input: { filePath: '/tmp/a' },
        output: 'contents'
      }
    })
    expect(useWorkspace.getState().opencodeChats['session-1']?.liveItems[1]).toMatchObject({
      id: 'tool-1',
      status: 'completed',
      input: { filePath: '/tmp/a' },
      output: 'contents'
    })

    resolveSend?.({ sessionId: 'opencode-1', messages: [{ id: 'answer-1', role: 'assistant', text: 'Final answer.' }] })
    await send
    expect(useWorkspace.getState().opencodeChats['session-1']?.liveItems).toEqual([])
    expect(useWorkspace.getState().opencodeChats['session-1']?.unreadCompletion).toBe(false)
    expect(useWorkspace.getState().opencodeChats['session-1']?.messages.at(-1)).toEqual({
      id: 'answer-1',
      role: 'assistant',
      text: 'Final answer.'
    })

    useWorkspace.getState().selectSession('session-2')
    let resolveAway: ((value: { sessionId: string; messages: OpenCodeChatItem[] }) => void) | undefined
    api.opencode.send.mockImplementationOnce(
      () =>
        new Promise<{ sessionId: string; messages: OpenCodeChatItem[] }>((resolve) => {
          resolveAway = resolve
        })
    )
    const awaySend = useWorkspace.getState().sendOpenCodeMessage('session-1', 'follow up')
    await Promise.resolve()
    resolveAway?.({ sessionId: 'opencode-1', messages: [] })
    await awaySend
    expect(useWorkspace.getState().opencodeChats['session-1']?.unreadCompletion).toBe(true)

    useWorkspace.getState().selectSession('session-1')
    expect(useWorkspace.getState().opencodeChats['session-1']?.unreadCompletion).toBe(false)

    useWorkspace.getState().selectSession('session-2')
    api.opencode.send.mockRejectedValueOnce(new Error('OpenCode failed'))
    await useWorkspace.getState().sendOpenCodeMessage('session-1', 'fails away')
    expect(useWorkspace.getState().opencodeChats['session-1']).toMatchObject({
      error: 'OpenCode failed',
      unreadCompletion: true
    })
  })

  it('loads, switches, and persists existing OpenCode conversations', async () => {
    const first: OpenCodeSessionSummary = {
      id: 'opencode-1',
      title: 'Earlier work',
      directory: '/workspace/app',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z'
    }
    const second: OpenCodeSessionSummary = {
      ...first,
      id: 'opencode-2',
      title: 'Latest work',
      updatedAt: '2026-01-03T00:00:00.000Z'
    }
    api.opencode.listSessions.mockResolvedValue({
      sessions: [second, first],
      selectedSessionId: first.id
    })
    api.opencode.selectSession.mockResolvedValue({
      sessionId: first.id,
      session: first,
      messages: [{ id: 'history-1', role: 'user', text: 'Old prompt' }]
    })

    useWorkspace.setState({
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          name: 'App',
          kind: 'native',
          path: '/workspace/app',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      opencodeChats: {}
    })

    await useWorkspace.getState().loadOpenCodeSessions('session-1')
    expect(api.opencode.selectSession).toHaveBeenCalledWith({
      sessionId: 'session-1',
      openCodeSessionId: first.id
    })
    expect(useWorkspace.getState().opencodeChats['session-1']).toMatchObject({
      openCodeSessionId: first.id,
      messages: [{ id: 'history-1', role: 'user', text: 'Old prompt' }],
      availableSessions: [second, first],
      sessionsLoading: false
    })
    expect(api.sessions.update).toHaveBeenCalledWith({
      id: 'session-1',
      patch: { opencodeSessionId: first.id }
    })

    api.opencode.selectSession.mockResolvedValueOnce({
      sessionId: second.id,
      session: second,
      messages: [{ id: 'history-2', role: 'assistant', text: 'New branch' }]
    })
    await useWorkspace.getState().selectOpenCodeSession('session-1', second.id)
    expect(useWorkspace.getState().opencodeChats['session-1']).toMatchObject({
      openCodeSessionId: second.id,
      messages: [{ id: 'history-2', role: 'assistant', text: 'New branch' }]
    })
  })

  it('creates a new conversation without deleting the existing list', async () => {
    const created: OpenCodeSessionSummary = {
      id: 'opencode-new',
      title: 'App',
      directory: '/workspace/app',
      createdAt: '2026-01-04T00:00:00.000Z',
      updatedAt: '2026-01-04T00:00:00.000Z'
    }
    api.opencode.createSession.mockResolvedValue({
      sessionId: created.id,
      session: created,
      messages: []
    })
    useWorkspace.setState({ opencodeChats: {} })

    await useWorkspace.getState().createOpenCodeSession('session-1')
    expect(useWorkspace.getState().opencodeChats['session-1']).toMatchObject({
      openCodeSessionId: created.id,
      messages: [],
      availableSessions: [created]
    })
  })
})
