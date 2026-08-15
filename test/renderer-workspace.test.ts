import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenCodeChatItem, OpenCodeStreamChunk } from '../src/shared/types'

vi.mock('../src/renderer/terminal/sessions', () => ({ disposeSession: vi.fn() }))

import { useWorkspace } from '../src/renderer/store/workspace'

describe('renderer workspace event bridge', () => {
  const streamListeners: Array<(chunk: OpenCodeStreamChunk) => void> = []
  const api = {
    platform: { info: vi.fn(async () => ({ platform: 'linux', arch: 'x64' })) },
    workspace: { list: vi.fn(async () => ({ projects: [], sessions: [] })) },
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
    api.opencode.onStream.mockClear()
    api.opencode.replyPermission.mockClear()
  })

  it('registers process-lifetime push listeners only once', async () => {
    await Promise.all([useWorkspace.getState().init(), useWorkspace.getState().init()])

    expect(api.pty.onExit).toHaveBeenCalledTimes(1)
    expect(api.opencode.onStream).toHaveBeenCalledTimes(1)

    let resolveSend: ((value: { messages: OpenCodeChatItem[] }) => void) | undefined
    api.opencode.send.mockImplementation(
      () =>
        new Promise<{ messages: OpenCodeChatItem[] }>((resolve) => {
          resolveSend = resolve
        })
    )

    const send = useWorkspace.getState().sendOpenCodeMessage('session-1', 'hello')
    await Promise.resolve()
    expect(streamListeners).toHaveLength(1)

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

    resolveSend?.({ messages: [{ id: 'answer-1', role: 'assistant', text: 'Final answer.' }] })
    await send
    expect(useWorkspace.getState().opencodeChats['session-1']?.liveItems).toEqual([])
    expect(useWorkspace.getState().opencodeChats['session-1']?.messages.at(-1)).toEqual({
      id: 'answer-1',
      role: 'assistant',
      text: 'Final answer.'
    })
  })
})
