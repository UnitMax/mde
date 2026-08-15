import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/renderer/terminal/sessions', () => ({ disposeSession: vi.fn() }))

import { useWorkspace } from '../src/renderer/store/workspace'

describe('renderer workspace event bridge', () => {
  const streamListeners: Array<(chunk: { sessionId: string; delta: string }) => void> = []
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
      onStream: vi.fn((listener: (chunk: { sessionId: string; delta: string }) => void) => {
        streamListeners.push(listener)
        return vi.fn()
      })
    }
  }

  beforeEach(() => {
    streamListeners.length = 0
    vi.stubGlobal('window', { api })
    api.pty.onExit.mockClear()
    api.opencode.onStream.mockClear()
  })

  it('registers process-lifetime push listeners only once', async () => {
    await Promise.all([useWorkspace.getState().init(), useWorkspace.getState().init()])

    expect(api.pty.onExit).toHaveBeenCalledTimes(1)
    expect(api.opencode.onStream).toHaveBeenCalledTimes(1)

    let resolveSend: ((value: { messages: [] }) => void) | undefined
    api.opencode.send.mockImplementation(
      () =>
        new Promise<{ messages: [] }>((resolve) => {
          resolveSend = resolve
        })
    )

    const send = useWorkspace.getState().sendOpenCodeMessage('session-1', 'hello')
    await Promise.resolve()
    expect(streamListeners).toHaveLength(1)

    streamListeners[0]?.({ sessionId: 'session-1', delta: 'Hello' })
    expect(useWorkspace.getState().opencodeChats['session-1']?.streamingText).toBe('Hello')

    resolveSend?.({ messages: [] })
    await send
  })
})
