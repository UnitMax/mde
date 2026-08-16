import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  OpenCodeChatItem,
  OpenCodeGenerationStats,
  OpenCodeModelOption,
  OpenCodeSessionSummary,
  OpenCodeStreamChunk,
  OpenCodeTuiStatusUpdate,
  Session
} from '../src/shared/types'

vi.mock('../src/renderer/terminal/sessions', () => ({ disposeSession: vi.fn() }))

import { useWorkspace } from '../src/renderer/store/workspace'

describe('renderer workspace event bridge', () => {
  const streamListeners: Array<(chunk: OpenCodeStreamChunk) => void> = []
  const tuiStatusListeners: Array<(update: OpenCodeTuiStatusUpdate) => void> = []
  const api = {
    platform: { info: vi.fn(async () => ({ platform: 'linux', arch: 'x64' })) },
    workspace: { list: vi.fn(async () => ({ projects: [], sessions: [] })) },
    sessions: {
      create: vi.fn(),
      update: vi.fn(async ({ id, patch }: { id: string; patch: Partial<Session> }) => ({
        id,
        projectId: 'project-1',
        name: 'App',
        mode: 'gui' as const,
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
      executeCommand: vi.fn(),
      listSessions: vi.fn(),
      listModels: vi.fn(),
      selectSession: vi.fn(),
      createSession: vi.fn(),
      revert: vi.fn(),
      unrevert: vi.fn(),
      replyPermission: vi.fn(async () => undefined),
      onStream: vi.fn((listener: (chunk: OpenCodeStreamChunk) => void) => {
        streamListeners.push(listener)
        return vi.fn()
      })
    },
    opencodeTui: {
      settings: vi.fn(async () => ({ enabled: false, currentPluginVersion: '1.0.0' })),
      setEnabled: vi.fn(async ({ enabled }: { enabled: boolean }) => ({
        enabled,
        currentPluginVersion: '1.0.0'
      })),
      pluginState: vi.fn(async ({ distro }: { distro: string }) => ({
        distro,
        status: 'not-installed' as const,
        installedVersion: null,
        currentVersion: '1.0.0'
      })),
      install: vi.fn(async ({ distro }: { distro: string }) => ({
        distro,
        status: 'installed' as const,
        installedVersion: '1.0.0',
        currentVersion: '1.0.0'
      })),
      remove: vi.fn(async ({ distro }: { distro: string }) => ({
        distro,
        status: 'not-installed' as const,
        installedVersion: null,
        currentVersion: '1.0.0'
      })),
      onStatus: vi.fn((listener: (update: OpenCodeTuiStatusUpdate) => void) => {
        tuiStatusListeners.push(listener)
        return vi.fn()
      })
    }
  }

  beforeEach(() => {
    streamListeners.length = 0
    tuiStatusListeners.length = 0
    vi.stubGlobal('window', { api })
    useWorkspace.setState({ opencodeChats: {}, opencodeTuiStatuses: {} })
    api.pty.onExit.mockClear()
    api.sessions.create.mockReset()
    api.sessions.update.mockClear()
    api.opencode.send.mockReset()
    api.opencode.executeCommand.mockReset()
    api.opencode.listSessions.mockReset()
    api.opencode.listModels.mockReset()
    api.opencode.selectSession.mockReset()
    api.opencode.createSession.mockReset()
    api.opencode.revert.mockReset()
    api.opencode.unrevert.mockReset()
    api.opencode.onStream.mockClear()
    api.opencode.replyPermission.mockClear()
    api.opencodeTui.onStatus.mockClear()
  })

  it('does not mark the source session exited when a split pane exits', () => {
    useWorkspace.setState({ statuses: {}, exits: {} })

    useWorkspace.getState().noteExit({
      sessionId: 'session-1',
      terminalId: 'session-1:split:1',
      exitCode: 0
    })
    expect(useWorkspace.getState().statuses).toEqual({})
    expect(useWorkspace.getState().exits).toEqual({})

    useWorkspace.getState().noteExit({ sessionId: 'session-1', terminalId: 'session-1', exitCode: 1 })
    expect(useWorkspace.getState().statuses['session-1']).toBe('exited')
    expect(useWorkspace.getState().exits['session-1']).toMatchObject({ exitCode: 1 })
  })

  it('tracks TUI completion as unread until the session is selected', () => {
    useWorkspace.setState({ selectedSessionId: 'other-session', opencodeTuiStatuses: {} })

    useWorkspace.getState().appendOpenCodeTuiStatus({
      sessionId: 'terminal-1',
      status: 'completed',
      revision: 1
    })
    expect(useWorkspace.getState().opencodeTuiStatuses['terminal-1']).toMatchObject({
      status: 'completed',
      unread: true
    })

    useWorkspace.getState().selectSession('terminal-1')
    expect(useWorkspace.getState().opencodeTuiStatuses['terminal-1']?.unread).toBe(false)

    useWorkspace.getState().appendOpenCodeTuiStatus({
      sessionId: 'terminal-1',
      status: null,
      revision: 0
    })
    expect(useWorkspace.getState().opencodeTuiStatuses['terminal-1']).toBeUndefined()
  })

  it('creates and selects a session with its persisted mode', async () => {
    api.sessions.create.mockResolvedValue({
      id: 'gui-session',
      projectId: 'project-1',
      name: 'GUI app',
      mode: 'gui',
      kind: 'native',
      path: '/workspace/app',
      createdAt: '2026-01-01T00:00:00.000Z'
    })

    const session = await useWorkspace.getState().addSession({
      projectId: 'project-1',
      name: 'GUI app',
      mode: 'gui',
      kind: 'native',
      path: '/workspace/app'
    })

    expect(api.sessions.create).toHaveBeenCalledWith({
      projectId: 'project-1',
      name: 'GUI app',
      mode: 'gui',
      kind: 'native',
      path: '/workspace/app'
    })
    expect(session.mode).toBe('gui')
    expect(useWorkspace.getState().selectedSessionId).toBe('gui-session')
  })

  it('registers process-lifetime push listeners only once', async () => {
    await Promise.all([useWorkspace.getState().init(), useWorkspace.getState().init()])

    expect(api.pty.onExit).toHaveBeenCalledTimes(1)
    expect(api.opencode.onStream).toHaveBeenCalledTimes(1)
    expect(api.opencodeTui.onStatus).toHaveBeenCalledTimes(1)

    useWorkspace.getState().selectSession('session-1')
    const model: OpenCodeModelOption = {
      key: 'opencode/test-model',
      providerID: 'opencode',
      providerName: 'OpenCode',
      modelID: 'test-model',
      modelName: 'Test model'
    }
    useWorkspace.setState({
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          name: 'App',
          mode: 'gui',
          kind: 'native',
          path: '/workspace/app',
          opencodeSessionId: 'opencode-1',
          opencodeModelSelections: { 'opencode-1': model },
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      opencodeChats: {
        'session-1': {
          messages: [],
          contextUsage: null,
          compacting: false,
          generation: null,
          availableSessions: [],
          availableModels: [model],
          selectedModel: model,
          subagents: [],
          revert: null,
          undoSupported: true,
          undoing: false,
          redoing: false,
          externalBusy: false,
          openCodeSessionId: 'opencode-1',
          liveItems: [],
          pending: false,
          sessionsLoading: false,
          modelsLoading: false,
          error: null,
          unreadCompletion: false
        }
      }
    })

    let resolveSend: ((value: {
      sessionId: string
      userMessageId: string | null
      messages: OpenCodeChatItem[]
      generationStats?: OpenCodeGenerationStats
    }) => void) | undefined
    api.opencode.send.mockImplementation(
      () =>
        new Promise<{
          sessionId: string
          userMessageId: string | null
          messages: OpenCodeChatItem[]
          generationStats?: OpenCodeGenerationStats
        }>((resolve) => {
          resolveSend = resolve
        })
    )

    const send = useWorkspace.getState().sendOpenCodeMessage('session-1', 'hello')
    await Promise.resolve()
    expect(streamListeners).toHaveLength(1)
    expect(useWorkspace.getState().opencodeChats['session-1']?.pending).toBe(true)
    expect(api.opencode.send).toHaveBeenCalledWith({ sessionId: 'session-1', text: 'hello', model })

    streamListeners[0]?.({
      sessionId: 'session-1',
      item: { kind: 'status', status: 'busy' }
    })
    expect(useWorkspace.getState().opencodeChats['session-1']?.externalBusy).toBe(false)

    streamListeners[0]?.({
      sessionId: 'session-1',
      item: { kind: 'compaction', status: 'started', automatic: true }
    })
    expect(useWorkspace.getState().opencodeChats['session-1']?.compacting).toBe(true)
    streamListeners[0]?.({
      sessionId: 'session-1',
      item: { kind: 'compaction', status: 'completed', automatic: true }
    })
    expect(useWorkspace.getState().opencodeChats['session-1']?.compacting).toBe(false)

    streamListeners[0]?.({
      sessionId: 'session-1',
      item: { kind: 'reasoning', partId: 'reasoning-1', delta: 'I should inspect this.', done: false }
    })
    expect(useWorkspace.getState().opencodeChats['session-1']?.generation?.live).toMatchObject({
      phase: 'thinking',
      estimatedTokens: 6
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
    expect(useWorkspace.getState().opencodeChats['session-1']?.generation?.live).toMatchObject({
      phase: 'tool',
      toolWaiting: false
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

    resolveSend?.({
      sessionId: 'opencode-1',
      userMessageId: 'user-1',
      messages: [{ id: 'answer-1', role: 'assistant', text: 'Final answer.' }],
      generationStats: {
        outputTokens: 12,
        reasoningTokens: 6,
        totalTokens: 18,
        durationMs: 2_000,
        tokensPerSecond: 9,
        timeToFirstTokenMs: null
      }
    })
    await send
    expect(useWorkspace.getState().opencodeChats['session-1']?.liveItems).toEqual([])
    expect(useWorkspace.getState().opencodeChats['session-1']?.unreadCompletion).toBe(false)
    expect(useWorkspace.getState().opencodeChats['session-1']?.messages.at(-1)).toEqual({
      id: 'answer-1',
      role: 'assistant',
      text: 'Final answer.'
    })
    expect(useWorkspace.getState().opencodeChats['session-1']?.generation?.final).toMatchObject({
      outputTokens: 12,
      totalTokens: 18,
      timeToFirstTokenMs: expect.any(Number)
    })

    streamListeners[0]?.({ sessionId: 'session-1', item: { kind: 'status', status: 'busy' } })
    expect(useWorkspace.getState().opencodeChats['session-1']?.externalBusy).toBe(true)
    streamListeners[0]?.({ sessionId: 'session-1', item: { kind: 'status', status: 'idle' } })
    expect(useWorkspace.getState().opencodeChats['session-1']?.externalBusy).toBe(false)

    useWorkspace.getState().selectSession('session-2')
    let resolveAway: ((value: { sessionId: string; userMessageId: string | null; messages: OpenCodeChatItem[] }) => void) | undefined
    api.opencode.send.mockImplementationOnce(
      () =>
        new Promise<{ sessionId: string; userMessageId: string | null; messages: OpenCodeChatItem[] }>((resolve) => {
          resolveAway = resolve
        })
    )
    const awaySend = useWorkspace.getState().sendOpenCodeMessage('session-1', 'follow up')
    await Promise.resolve()
    resolveAway?.({ sessionId: 'opencode-1', userMessageId: null, messages: [] })
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
    api.opencode.listModels.mockResolvedValue({ models: [] })
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
          mode: 'gui',
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

  it('executes supported slash commands and replaces the transcript with OpenCode history', async () => {
    const model: OpenCodeModelOption = {
      key: 'cloud/model-a',
      providerID: 'cloud',
      providerName: 'Cloud Provider',
      modelID: 'model-a',
      modelName: 'Model A'
    }
    const conversation: OpenCodeSessionSummary = {
      id: 'opencode-1',
      title: 'App',
      directory: '/workspace/app',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z'
    }
    api.opencode.executeCommand.mockResolvedValue({
      sessionId: conversation.id,
      session: conversation,
      messages: [
        { id: 'user-1', role: 'user', text: '/init' },
        { id: 'assistant-1', role: 'assistant', text: 'Created AGENTS.md.' }
      ],
      revert: null,
      undoSupported: true
    })
    api.opencode.listSessions.mockResolvedValue({
      sessions: [conversation],
      selectedSessionId: conversation.id,
      undoSupported: true
    })
    useWorkspace.setState({
      selectedSessionId: 'session-1',
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          name: 'App',
          mode: 'gui',
          kind: 'native',
          path: '/workspace/app',
          opencodeSessionId: conversation.id,
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      opencodeChats: {
        'session-1': {
          messages: [{ id: 'old', role: 'assistant', text: 'Old transcript' }],
          contextUsage: null,
          compacting: false,
          generation: null,
          availableSessions: [conversation],
          availableModels: [model],
          selectedModel: model,
          subagents: [],
          revert: null,
          undoSupported: false,
          undoing: false,
          redoing: false,
          externalBusy: false,
          openCodeSessionId: conversation.id,
          liveItems: [],
          pending: false,
          sessionsLoading: false,
          modelsLoading: false,
          error: null,
          unreadCompletion: false
        }
      }
    })

    await useWorkspace.getState().executeOpenCodeCommand('session-1', 'init')

    expect(api.opencode.executeCommand).toHaveBeenCalledWith({
      sessionId: 'session-1',
      command: 'init',
      model
    })
    expect(useWorkspace.getState().opencodeChats['session-1']).toMatchObject({
      messages: [
        { id: 'user-1', role: 'user', text: '/init' },
        { id: 'assistant-1', role: 'assistant', text: 'Created AGENTS.md.' }
      ],
      pending: false,
      undoSupported: true
    })
  })

  it('loads the live model catalog and persists a choice per conversation', async () => {
    const model: OpenCodeModelOption = {
      key: 'cloud/model-a#fast',
      providerID: 'cloud',
      providerName: 'Cloud Provider',
      modelID: 'model-a',
      modelName: 'Model A · fast',
      variant: 'fast'
    }
    const conversation: OpenCodeSessionSummary = {
      id: 'opencode-model-session',
      title: 'Model test',
      directory: '/workspace/app',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    api.opencode.listModels.mockResolvedValue({ models: [model] })
    api.opencode.listSessions.mockResolvedValue({ sessions: [conversation], selectedSessionId: conversation.id })
    api.opencode.selectSession.mockResolvedValue({
      sessionId: conversation.id,
      session: conversation,
      messages: []
    })
    useWorkspace.setState({
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          name: 'App',
          mode: 'gui',
          kind: 'native',
          path: '/workspace/app',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      opencodeChats: {}
    })

    await useWorkspace.getState().loadOpenCodeModels('session-1')
    expect(useWorkspace.getState().opencodeChats['session-1']).toMatchObject({
      availableModels: [model],
      selectedModel: null,
      modelsLoading: false
    })

    await useWorkspace.getState().loadOpenCodeSessions('session-1')
    await useWorkspace.getState().selectOpenCodeModel('session-1', model)
    expect(api.sessions.update).toHaveBeenLastCalledWith({
      id: 'session-1',
      patch: {
        opencodeModelSelections: {
          [conversation.id]: { providerID: 'cloud', modelID: 'model-a', variant: 'fast' }
        }
      }
    })
    expect(useWorkspace.getState().opencodeChats['session-1']?.selectedModel).toEqual({
      providerID: 'cloud',
      modelID: 'model-a',
      variant: 'fast'
    })
  })

  it('allows selecting a model before lazily creating the first conversation', async () => {
    const model: OpenCodeModelOption = {
      key: 'cloud/model-a',
      providerID: 'cloud',
      providerName: 'Cloud Provider',
      modelID: 'model-a',
      modelName: 'Model A'
    }
    api.opencode.listModels.mockResolvedValue({ models: [model] })
    const createdConversation: OpenCodeSessionSummary = {
      id: 'opencode-new',
      title: 'Empty folder',
      directory: '/workspace/empty',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    api.opencode.listSessions
      .mockResolvedValueOnce({ sessions: [], selectedSessionId: null, undoSupported: false })
      .mockResolvedValueOnce({ sessions: [], selectedSessionId: null, undoSupported: false })
      .mockResolvedValueOnce({
        sessions: [createdConversation],
        selectedSessionId: createdConversation.id,
        undoSupported: false
      })
    api.opencode.send.mockResolvedValue({
      sessionId: 'opencode-new',
      userMessageId: 'user-new',
      messages: [{ id: 'answer-new', role: 'assistant', text: 'Ready.' }]
    })
    useWorkspace.setState({
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          name: 'Empty folder',
          mode: 'gui',
          kind: 'native',
          path: '/workspace/empty',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      opencodeChats: {}
    })

    await useWorkspace.getState().loadOpenCodeModels('session-1')
    await useWorkspace.getState().loadOpenCodeSessions('session-1')
    await useWorkspace.getState().selectOpenCodeModel('session-1', model)

    expect(useWorkspace.getState().opencodeChats['session-1']?.selectedModel).toEqual({
      providerID: 'cloud',
      modelID: 'model-a'
    })
    expect(api.sessions.update).not.toHaveBeenCalled()

    await useWorkspace.getState().refreshOpenCodeSessionList('session-1')
    expect(useWorkspace.getState().opencodeChats['session-1']).toMatchObject({
      openCodeSessionId: null,
      selectedModel: { providerID: 'cloud', modelID: 'model-a' }
    })

    await useWorkspace.getState().sendOpenCodeMessage('session-1', 'First prompt')

    expect(api.opencode.send).toHaveBeenCalledWith({
      sessionId: 'session-1',
      text: 'First prompt',
      model: { providerID: 'cloud', modelID: 'model-a' }
    })
    expect(api.sessions.update).toHaveBeenCalledWith({
      id: 'session-1',
      patch: {
        opencodeSessionId: 'opencode-new',
        opencodeModelSelections: {
          'opencode-new': { providerID: 'cloud', modelID: 'model-a' }
        }
      }
    })
    expect(useWorkspace.getState().opencodeChats['session-1']).toMatchObject({
      openCodeSessionId: 'opencode-new',
      selectedModel: { providerID: 'cloud', modelID: 'model-a' },
      pending: false
    })
  })

  it('refreshes undo support when a project becomes a Git repository', async () => {
    const conversation: OpenCodeSessionSummary = {
      id: 'opencode-1',
      title: 'App',
      directory: '/workspace/app',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    api.opencode.listSessions.mockResolvedValue({
      sessions: [conversation],
      selectedSessionId: conversation.id,
      undoSupported: true
    })
    useWorkspace.setState({
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          name: 'App',
          mode: 'gui',
          kind: 'native',
          path: '/workspace/app',
          opencodeSessionId: conversation.id,
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      opencodeChats: {
        'session-1': {
          messages: [],
          contextUsage: null,
          compacting: false,
          generation: null,
          availableSessions: [conversation],
          availableModels: [],
          selectedModel: null,
          subagents: [],
          revert: null,
          undoSupported: false,
          undoing: false,
          redoing: false,
          externalBusy: false,
          openCodeSessionId: conversation.id,
          liveItems: [],
          pending: false,
          sessionsLoading: false,
          modelsLoading: false,
          error: null,
          unreadCompletion: false
        }
      }
    })

    await useWorkspace.getState().refreshOpenCodeSessionList('session-1')

    expect(useWorkspace.getState().opencodeChats['session-1']?.undoSupported).toBe(true)
  })

  it('keeps subagent status visible after the parent response completes', () => {
    const model: OpenCodeModelOption = {
      key: 'cloud/model-a',
      providerID: 'cloud',
      providerName: 'Cloud Provider',
      modelID: 'model-a',
      modelName: 'Model A'
    }
    useWorkspace.setState({
      selectedSessionId: 'session-2',
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          name: 'App',
          mode: 'gui',
          kind: 'native',
          path: '/workspace/app',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      opencodeChats: {
        'session-1': {
          messages: [],
          contextUsage: null,
          compacting: false,
          generation: null,
          availableSessions: [],
          availableModels: [model],
          selectedModel: model,
          subagents: [],
          revert: null,
          undoSupported: true,
          undoing: false,
          redoing: false,
          externalBusy: false,
          openCodeSessionId: 'opencode-1',
          liveItems: [],
          pending: false,
          sessionsLoading: false,
          modelsLoading: false,
          error: null,
          unreadCompletion: false
        }
      }
    })

    useWorkspace.getState().appendOpenCodeStream({
      sessionId: 'session-1',
      item: {
        kind: 'subagent',
        subagent: {
          id: 'child-1',
          taskId: 'task-1',
          description: 'Inspect the repository',
          agent: 'explore',
          status: 'working',
          startedAt: 100
        }
      }
    })
    expect(useWorkspace.getState().opencodeChats['session-1']?.subagents).toMatchObject([
      { id: 'child-1', status: 'working' }
    ])

    useWorkspace.getState().appendOpenCodeStream({
      sessionId: 'session-1',
      item: {
        kind: 'subagent',
        subagent: {
          id: 'child-1',
          taskId: 'task-1',
          description: 'Inspect the repository',
          agent: 'explore',
          status: 'waiting',
          startedAt: 100
        },
        permission: {
          requestId: 'child-permission',
          permission: 'bash',
          patterns: ['git status']
        }
      }
    })
    expect(useWorkspace.getState().opencodeChats['session-1']?.liveItems).toMatchObject([
      { id: 'child-permission', role: 'permission', subagentId: 'child-1' }
    ])

    useWorkspace.getState().appendOpenCodeStream({
      sessionId: 'session-1',
      item: {
        kind: 'subagent',
        subagent: {
          id: 'child-1',
          taskId: 'task-1',
          description: 'Inspect the repository',
          agent: 'explore',
          status: 'completed',
          startedAt: 100,
          finishedAt: 200
        },
        permissionResolved: 'child-permission'
      }
    })
    expect(useWorkspace.getState().opencodeChats['session-1']).toMatchObject({
      subagents: [{ id: 'child-1', status: 'completed' }],
      liveItems: [],
      unreadCompletion: true
    })
  })

  it('undoes and redoes the latest completed OpenCode turn using its real message ID', async () => {
    const model: OpenCodeModelOption = {
      key: 'cloud/model-a',
      providerID: 'cloud',
      providerName: 'Cloud Provider',
      modelID: 'model-a',
      modelName: 'Model A'
    }
    const beforeUndo: OpenCodeChatItem[] = [
      { id: 'msg-user-1', role: 'user', text: 'Earlier' },
      { id: 'assistant-1', role: 'assistant', text: 'Earlier answer' },
      { id: 'msg-user-2', role: 'user', text: 'Latest' },
      { id: 'assistant-2', role: 'assistant', text: 'Latest answer' }
    ]
    useWorkspace.setState({
      selectedSessionId: 'session-1',
      sessions: [
        {
          id: 'session-1',
          projectId: 'project-1',
          name: 'App',
          mode: 'gui',
          kind: 'native',
          path: '/workspace/app',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      opencodeChats: {
        'session-1': {
          messages: beforeUndo,
          contextUsage: null,
          compacting: false,
          generation: null,
          availableSessions: [],
          availableModels: [model],
          selectedModel: model,
          subagents: [],
          revert: null,
          undoSupported: true,
          undoing: false,
          redoing: false,
          externalBusy: false,
          openCodeSessionId: 'opencode-1',
          liveItems: [],
          pending: false,
          sessionsLoading: false,
          modelsLoading: false,
          error: null,
          unreadCompletion: false
        }
      }
    })
    api.opencode.revert.mockResolvedValue({
      sessionId: 'opencode-1',
      messages: beforeUndo.slice(0, 2),
      revert: { messageID: 'msg-user-2' },
      undoSupported: true
    })
    api.opencode.unrevert.mockResolvedValue({
      sessionId: 'opencode-1',
      messages: beforeUndo,
      revert: null,
      undoSupported: true
    })

    await useWorkspace.getState().undoOpenCodeLastTurn('session-1')
    expect(api.opencode.revert).toHaveBeenCalledWith({ sessionId: 'session-1', messageId: 'msg-user-2' })
    expect(useWorkspace.getState().opencodeChats['session-1']).toMatchObject({
      messages: beforeUndo.slice(0, 2),
      revert: { messageID: 'msg-user-2' },
      undoing: false
    })

    await useWorkspace.getState().redoOpenCodeLastTurn('session-1')
    expect(api.opencode.unrevert).toHaveBeenCalledWith({ sessionId: 'session-1' })
    expect(useWorkspace.getState().opencodeChats['session-1']).toMatchObject({
      messages: beforeUndo,
      revert: null,
      redoing: false
    })
  })
})
