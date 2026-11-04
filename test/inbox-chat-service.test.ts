import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InboxDraftStore } from '../src/main/inbox/drafts'
import { describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '../src/shared/types'
import { InboxChatService, type InboxChatDependencies } from '../src/main/inbox/chat'
import { InboxRecorder, isInboxThreadUnread } from '../src/main/inbox/recorder'
import { InboxStore } from '../src/main/inbox/store'
import type { ServiceOperation, ServiceRequest } from '../src/main/opencode/service/client'
import { OpenCodeServiceError } from '../src/main/opencode/service/client'

const wsl = { kind: 'wsl' as const, distro: 'Ubuntu-24.04' }
const model = { id: 'model-1', providerId: 'provider-1' }

function setup(responses: Partial<Record<ServiceOperation, unknown>> = {}, drafts?: InboxDraftStore, worktrees?: InboxChatDependencies['worktrees']) {
  let now = 1_000
  let enabled = true
  let nextId = 0
  const store = new InboxStore('/unused', { writeFile: async () => {}, writeDelayMs: 60_000 })
  const recorder = new InboxRecorder(store, {
    now: () => now,
    readBranch: async () => 'main',
    onChanged: () => {},
  })
  const calls: { operation: ServiceOperation; request: ServiceRequest }[] = []
  const request = vi.fn(async (_target: unknown, operation: ServiceOperation, req: ServiceRequest = {}) => {
    calls.push({ operation, request: req })
    if (operation in responses) {
      const response = responses[operation]
      if (response instanceof Error) throw response
      return response
    }
    return null
  })
  const events: ChatEvent[] = []
  // The event stream never opens in these tests.
  const openEvents = vi.fn(() => new Promise<ReadableStream<Uint8Array>>(() => {}))
  const service = new InboxChatService({
    drafts,
    worktrees,
    client: { request, openEvents, reset: vi.fn() },
    store,
    recorder,
    send: (event) => events.push(event),
    enabled: () => enabled,
    now: () => now,
    // The first id is the folder added below; later ones stay distinct, as real ones are.
    createId: () => (nextId++ === 0 ? 'abc' : `abc${nextId}`),
    sleep: async () => {},
  })
  const folder = service.addFolder({ directory: '/home/me/app', target: wsl })
  return {
    service, store, calls, events, folder, request, openEvents,
    advance: (ms: number) => { now += ms },
    disable: () => { enabled = false },
  }
}

describe('Inbox chat service', () => {
  it('regenerates natively and reconciles the title when no event arrives, preserving metadata', async () => {
    const { service, folder, calls, store, request } = setup({
      'session.create': { data: { id: 'ses_new', title: 'Original' } },
      'session.get': { data: { title: 'New title' } },
    })
    await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
    await vi.waitFor(() => expect(store.get('ses_new')?.branch).toBe('main'))
    store.put({ ...store.get('ses_new')!, archived: true, status: 'attention', attentionReason: 'question' })
    const before = store.get('ses_new')!
    calls.length = 0
    await service.regenerateTitle('ses_new')
    expect(calls).toEqual([
      { operation: 'session.update', request: { params: { sessionID: 'ses_new' }, body: { title: '' } } },
      { operation: 'session.get', request: { params: { sessionID: 'ses_new' } } },
    ])
    expect(request).toHaveBeenCalledWith(wsl, 'session.update', expect.anything())
    expect(store.get('ses_new')).toEqual({ ...before, title: 'New title' })
    service.stop()
  })

  it('coalesces regeneration and lets a rename event during readback win', async () => {
    const { service, folder, request, store } = setup({ 'session.create': { data: { id: 'ses_new' } } })
    await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
    let finish!: (value: unknown) => void
    const answer = request.getMockImplementation()!
    request.mockImplementation((target, operation, req) => operation === 'session.get'
      ? new Promise((resolve) => { finish = resolve }) : answer(target, operation, req))
    const first = service.regenerateTitle('ses_new')
    const second = service.regenerateTitle('ses_new')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const emit = (service as unknown as { onEvent(event: { type: string; data: Record<string, unknown> }): void })
    emit.onEvent({ type: 'session.renamed', data: { sessionID: 'ses_new', title: 'Newest title' } })
    finish({ data: { title: 'Stale snapshot' } })
    await Promise.all([first, second])
    expect(request.mock.calls.filter((call) => call[1] === 'session.update')).toHaveLength(1)
    expect(store.get('ses_new')?.title).toBe('Newest title')
    service.stop()
  })

  it('ignores deleted threads during readback and rejects unknown or unavailable threads', async () => {
    const { service, folder, request, store, disable } = setup({ 'session.create': { data: { id: 'ses_new' } } })
    await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
    const answer = request.getMockImplementation()!
    request.mockImplementation(async (target, operation, req) => {
      if (operation !== 'session.get') return answer(target, operation, req)
      store.remove('ses_new')
      return { data: { title: 'Deleted' } }
    })
    await service.regenerateTitle('ses_new')
    expect(store.get('ses_new')).toBeUndefined()
    await expect(service.regenerateTitle('ses_new')).rejects.toThrow('no longer in the Inbox')
    disable()
    await expect(service.regenerateTitle('ses_new')).rejects.toThrow('only available on macOS')
    service.stop()
  })

  it.each([
    [new Error('Service unavailable'), 'Service unavailable'],
    [new OpenCodeServiceError('Unsupported', 405), 'does not support native title regeneration'],
  ])('keeps the title after an update failure and permits retry (%s)', async (error, message) => {
    const responses = {
      'session.create': { data: { id: 'ses_new', title: 'Original' } },
      'session.update': error,
      'session.get': { data: { title: 'Original' } },
    }
    const { service, folder, store } = setup(responses)
    await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
    await expect(service.regenerateTitle('ses_new')).rejects.toThrow(message as string)
    expect(store.get('ses_new')?.title).toBe('Original')
    delete (responses as Partial<typeof responses>)['session.update']
    await service.regenerateTitle('ses_new')
    expect(store.get('ses_new')?.title).toBe('Original')
    service.stop()
  })

  it.each(['', 'bad\u0007title', 'x'.repeat(513)])('rejects an invalid readback title', async (title) => {
    const { service, folder, store } = setup({
      'session.create': { data: { id: 'ses_new', title: 'Original' } },
      'session.get': { data: { title } },
    })
    await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
    await expect(service.regenerateTitle('ses_new')).rejects.toThrow('invalid session title')
    expect(store.get('ses_new')?.title).toBe('Original')
    service.stop()
  })

  it('adds a folder once, names it, and remembers it as the composer folder', () => {
    const { service, store, folder, advance } = setup()
    expect(folder).toEqual({
      id: 'fld_abc', name: 'app', directory: '/home/me/app', target: wsl, createdAt: 1_000, lastUsedAt: 1_000,
    })
    advance(5)
    expect(service.addFolder({ directory: '/home/me/app', target: wsl })).toMatchObject({ id: 'fld_abc', lastUsedAt: 1_005 })
    expect(store.folders()).toHaveLength(1)
    expect(service.folders().composer).toEqual({ folderId: 'fld_abc' })
    service.removeFolder('fld_abc')
    expect(service.folders()).toEqual({ folders: [], composer: {} })
  })

  it('resolves a folder or thread ID to its directory for the file tree', async () => {
    const { service, folder } = setup({ 'session.create': { data: { id: 'ses_new', title: 'New session' } } })
    expect(service.fileRoot(folder.id)).toEqual({
      id: 'fld_abc', projectId: '', name: 'app', kind: 'wsl', distro: 'Ubuntu-24.04', path: '/home/me/app', createdAt: '',
    })
    await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
    expect(service.fileRoot('ses_new')).toMatchObject({ id: 'ses_new', kind: 'wsl', path: '/home/me/app' })
    expect(service.fileRoot('ses_gone')).toBeNull()
    expect(service.fileRoot('fld_gone')).toBeNull()
    expect(service.fileRoot('other')).toBeNull()
    service.stop()
  })

  it('loads agents and models for the folder and caches them', async () => {
    const { service, folder, calls } = setup({
      'agent.list': { data: [{ id: 'plan', name: 'Plan', mode: 'primary' }, { id: 'build', name: 'Build', mode: 'primary' }] },
      'provider.list': { data: [{ id: 'provider-1', name: 'Provider' }] },
      'model.list': { data: [{ id: 'model-1', providerID: 'provider-1', name: 'Model' }] },
      'model.default': { data: { id: 'model-1', providerID: 'provider-1' } },
    })
    const options = await service.chatOptions({ folderId: folder.id })
    expect(options).toEqual({
      agents: [{ id: 'plan', name: 'Plan' }, { id: 'build', name: 'Build' }],
      models: [{ id: 'model-1', providerId: 'provider-1', providerName: 'Provider', name: 'Model' }],
      defaultModel: model,
      defaultAgent: 'build',
      // OpenCode could not list skills here; the pickers work without them.
      skills: [],
    })
    expect(calls[0]?.request.query).toEqual({ 'location[directory]': '/home/me/app' })
    await service.chatOptions({ folderId: folder.id })
    expect(calls).toHaveLength(5)
    await expect(service.chatOptions({ folderId: 'fld_gone' })).rejects.toThrow('no longer in the Inbox')
    await expect(service.chatOptions({ threadId: 'ses_gone' })).rejects.toThrow('no longer in the Inbox')
  })

  it('asks again when OpenCode has not loaded the folder yet and answers with no agents', async () => {
    const { service, folder, request } = setup({
      'provider.list': { data: [] },
      'model.list': { data: [{ id: 'model-1', providerID: 'provider-1', name: 'Model' }] },
      'model.default': { data: null },
    })
    const agents = [{ id: 'build', name: 'Build', mode: 'primary' }]
    let attempts = 0
    const answer = request.getMockImplementation()!
    request.mockImplementation(async (target, operation, req) => {
      if (operation !== 'agent.list') return answer(target, operation, req)
      attempts += 1
      return { data: attempts < 3 ? [] : agents }
    })
    expect((await service.chatOptions({ folderId: folder.id })).agents).toEqual([{ id: 'build', name: 'Build' }])
    expect(attempts).toBe(3)

    request.mockImplementation(async (target, operation, req) =>
      operation === 'agent.list' ? { data: [] } : answer(target, operation, req))
    const other = service.addFolder({ directory: '/home/me/other', target: wsl })
    await expect(service.chatOptions({ folderId: other.id })).rejects.toThrow('not finished loading')
  })

  describe('skills', () => {
    const skillList = (...ids: string[]) => ({ data: ids.map((id) => ({ id, name: id, path: `/home/me/${id}.md`, content: 'secret text' })) })
    const agents = { 'agent.list': { data: [{ id: 'build', name: 'Build', mode: 'primary' }] } }

    it('lists the skills of the folder next to the agents, without their text or paths', async () => {
      const { service, folder, calls } = setup({
        ...agents,
        'provider.list': { data: [] },
        'model.list': { data: [] },
        'model.default': { data: null },
        'skill.list': skillList('demo', 'review'),
      })
      const options = await service.chatOptions({ folderId: folder.id })
      expect(options.skills).toEqual([{ id: 'demo', name: 'demo' }, { id: 'review', name: 'review' }])
      expect(JSON.stringify(options)).not.toMatch(/secret text|home\/me\/demo/)
      expect(calls.find((call) => call.operation === 'skill.list')?.request.query).toEqual({ 'location[directory]': '/home/me/app' })
    })

    it('still answers with agents and models when the skills cannot be listed', async () => {
      const { service, folder } = setup({
        ...agents,
        'provider.list': { data: [] },
        'model.list': { data: [{ id: 'model-1', providerID: 'provider-1', name: 'Model' }] },
        'model.default': { data: null },
        'skill.list': new OpenCodeServiceError('Not found', 404),
      })
      const options = await service.chatOptions({ folderId: folder.id })
      expect(options.skills).toEqual([])
      expect(options.agents).toEqual([{ id: 'build', name: 'Build' }])
      expect(options.models).toHaveLength(1)
    })

    it('asks again while a folder that has not loaded yet answers with no skills', async () => {
      const { service, folder, request } = setup({ ...agents, 'provider.list': { data: [] }, 'model.list': { data: [] }, 'model.default': { data: null } })
      const answer = request.getMockImplementation()!
      let attempts = 0
      request.mockImplementation(async (target, operation, req) => {
        if (operation !== 'skill.list') return answer(target, operation, req)
        attempts += 1
        return attempts < 3 ? { data: [] } : skillList('demo')
      })
      expect((await service.chatOptions({ folderId: folder.id })).skills).toEqual([{ id: 'demo', name: 'demo' }])
      expect(attempts).toBe(3)
    })

    it('gives up quietly on a folder that really has none', async () => {
      const { service, folder, calls } = setup({ ...agents, 'provider.list': { data: [] }, 'model.list': { data: [] }, 'model.default': { data: null }, 'skill.list': { data: [] } })
      expect((await service.chatOptions({ folderId: folder.id })).skills).toEqual([])
      expect(calls.filter((call) => call.operation === 'skill.list')).toHaveLength(4)
    })

    it('sends a $skill in a follow-up as a skill, with the text unchanged', async () => {
      const { service, folder, calls } = setup({ 'session.create': { data: { id: 'ses_new' } }, 'skill.list': skillList('demo', 'review') })
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
      calls.length = 0
      await service.send({ threadId: 'ses_new', text: 'héllo $demo, then $review please' })
      expect(calls.map((call) => call.operation)).toEqual(['skill.list', 'session.prompt'])
      expect(calls[0]?.request.query).toEqual({ 'location[directory]': '/home/me/app' })
      expect(calls[1]?.request).toEqual({
        params: { sessionID: 'ses_new' },
        body: {
          text: 'héllo $demo, then $review please',
          skills: [
            { id: 'demo', mention: { start: 6, end: 11, text: '$demo' } },
            { id: 'review', mention: { start: 18, end: 25, text: '$review' } },
          ],
        },
      })
      service.stop()
    })

    it('names a skill once even when the message does', async () => {
      const { service, folder, calls } = setup({ 'session.create': { data: { id: 'ses_new' } }, 'skill.list': skillList('demo') })
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
      calls.length = 0
      await service.send({ threadId: 'ses_new', text: '$demo and again $demo' })
      expect((calls[1]?.request.body as { skills: unknown[] }).skills).toHaveLength(1)
      service.stop()
    })

    it('leaves $text that is not a known skill alone, and asks nothing when there is no $', async () => {
      const { service, folder, calls } = setup({ 'session.create': { data: { id: 'ses_new' } }, 'skill.list': skillList('demo') })
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
      calls.length = 0
      await service.send({ threadId: 'ses_new', text: 'echo $HOME and $nope' })
      expect(calls[1]?.request.body).toEqual({ text: 'echo $HOME and $nope' })
      calls.length = 0
      await service.send({ threadId: 'ses_new', text: 'plain words' })
      expect(calls.map((call) => call.operation)).toEqual(['session.prompt'])
      service.stop()
    })

    it('sends the message as plain text when the skills cannot be listed', async () => {
      const { service, folder, calls } = setup({ 'session.create': { data: { id: 'ses_new' } }, 'skill.list': new OpenCodeServiceError('Unavailable', 503) })
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
      calls.length = 0
      await service.send({ threadId: 'ses_new', text: 'use $demo' })
      expect(calls[calls.length - 1]).toEqual({ operation: 'session.prompt', request: { params: { sessionID: 'ses_new' }, body: { text: 'use $demo' } } })
      service.stop()
    })

    it('sends a $skill in the first message of a new thread', async () => {
      const { service, folder, calls } = setup({ 'session.create': { data: { id: 'ses_new' } }, 'skill.list': skillList('demo') })
      await service.create({ folderId: folder.id, text: '$demo go', agent: 'build', model })
      expect(calls.map((call) => call.operation)).toEqual(['session.create', 'skill.list', 'session.prompt'])
      expect(calls[2]?.request.body).toEqual({ text: '$demo go', skills: [{ id: 'demo', mention: { start: 0, end: 5, text: '$demo' } }] })
      service.stop()
    })

    it('lists the skills of the worktree a new thread runs in, because that is where OpenCode checks them', async () => {
      const root = '/home/me/.mde/worktrees/app-abc/1a2b3c4d'
      const worktree = { repository: '/home/me/app', root, branch: 'mde/1a2b3c4d', base: 'origin/main' }
      const worktrees = {
        info: vi.fn(), remove: vi.fn(async () => {}), discard: vi.fn(async () => {}),
        create: vi.fn(async () => ({ directory: root, worktree })),
      }
      const { service, folder, calls } = setup({ 'session.create': { data: { id: 'ses_new' } }, 'skill.list': skillList('demo') }, undefined, worktrees)
      await service.create({ folderId: folder.id, text: '$demo go', agent: 'build', model, worktree: { base: 'origin/main' } })
      expect(calls.find((call) => call.operation === 'skill.list')?.request.query).toEqual({ 'location[directory]': root })
      service.stop()
    })
  })

  describe('MCP servers', () => {
    const listing = (...servers: Array<[string, string, Record<string, unknown>?]>) => ({
      data: servers.map(([name, status, extra]) => ({ name, status: { status, ...extra } })),
    })
    const emit = (service: InboxChatService, type: string, data: Record<string, unknown> = {}) =>
      (service as unknown as { onEvent(event: { type: string; data: Record<string, unknown> }, target: unknown): void }).onEvent({ type, data }, wsl)

    it('lists the servers for the folder’s directory in name order, and asks again every time', async () => {
      const { service, folder, calls } = setup({ 'mcp.list': listing(['demo_math', 'connected'], ['Alpha', 'pending'], ['demo_display', 'disabled']) })
      const first = await service.mcpList({ folderId: folder.id })
      expect(first).toEqual({
        supported: true,
        servers: [
          { name: 'Alpha', status: 'connecting' },
          { name: 'demo_display', status: 'disabled' },
          { name: 'demo_math', status: 'connected' },
        ],
      })
      await service.mcpList({ folderId: folder.id })
      expect(calls.map((call) => call.operation)).toEqual(['mcp.list', 'mcp.list'])
      expect(calls[0]?.request.query).toEqual({ 'location[directory]': '/home/me/app' })
      service.stop()
    })

    it('keeps only the name, title and state, and takes secrets out of an error', async () => {
      const { service, folder } = setup({
        'mcp.list': { data: [
          {
            name: 'remote',
            title: 'Remote tools',
            integrationID: 'int_1',
            command: ['node', '/home/me/secret.mjs'],
            environment: { TOKEN: 'abc' },
            status: { status: 'failed', error: 'GET https://user:pw@example.com/mcp?access_token=abcdef failed; see /home/me/.cache/log; Authorization: Bearer abcdef' },
          },
          { name: 'login', status: { status: 'needs_auth', error: 'Sign in' } },
          { name: 'odd', status: { status: 'something-new' } },
          { name: '..', status: { status: 'connected' } },
          { name: 'remote', status: { status: 'connected' } },
        ] },
      })
      const { servers } = await service.mcpList({ folderId: folder.id })
      expect(servers.map((server) => server.name)).toEqual(['login', 'odd', 'remote'])
      expect(servers.find((server) => server.name === 'odd')?.status).toBe('unknown')
      const remote = servers.find((server) => server.name === 'remote')!
      expect(remote).toEqual({ name: 'remote', title: 'Remote tools', status: 'failed', error: expect.any(String) })
      expect(remote.error).not.toMatch(/user:pw|abcdef|access_token=|\/home\/me|int_1/)
      expect(remote.error).toContain('example.com/mcp')
      expect(JSON.stringify(servers)).not.toMatch(/secret\.mjs|TOKEN/)
      service.stop()
    })

    it('asks again while a folder that has not loaded yet lists nothing, but only for the first answer of a place', async () => {
      const { service, folder, request } = setup()
      let asked = 0
      request.mockImplementation(async (_target, operation) => {
        if (operation !== 'mcp.list') return null
        asked += 1
        return asked < 3 ? { data: [] } : listing(['demo_math', 'connected'])
      })
      expect((await service.mcpList({ folderId: folder.id })).servers).toHaveLength(1)
      expect(asked).toBe(3)
      // The place has answered, so a later empty list (every server removed) is believed at once.
      request.mockImplementation(async () => { asked += 1; return { data: [] } })
      asked = 0
      expect(await service.mcpList({ folderId: folder.id })).toEqual({ servers: [], supported: true })
      expect(asked).toBe(1)
      // Another executable means another OpenCode: its first answer is waited for again.
      service.configure('/opt/opencode')
      asked = 0
      await service.mcpList({ folderId: folder.id })
      expect(asked).toBe(6)
      service.stop()
    })

    it('shares the request when several asks arrive together', async () => {
      const { service, folder, calls } = setup({ 'mcp.list': listing(['demo_math', 'connected']) })
      const [a, b] = await Promise.all([service.mcpList({ folderId: folder.id }), service.mcpList({ folderId: folder.id })])
      expect(a).toBe(b)
      expect(calls).toHaveLength(1)
      service.stop()
    })

    it('says an OpenCode without MCP routes is unsupported, but reports other failures', async () => {
      const old = setup({ 'mcp.list': new OpenCodeServiceError('Not found', 404) })
      await expect(old.service.mcpList({ folderId: old.folder.id })).resolves.toEqual({ servers: [], supported: false })
      const missing = setup({ 'mcp.list': new OpenCodeServiceError('No such folder', 404, 'LocationNotFoundError') })
      await expect(missing.service.mcpList({ folderId: missing.folder.id })).rejects.toThrow('No such folder')
      await expect(missing.service.mcpList({ folderId: 'fld_gone' })).rejects.toThrow('no longer in the Inbox')
      old.service.stop()
      missing.service.stop()
    })

    it('opens the event stream so that status changes arrive without a thread', async () => {
      const { service, folder, openEvents } = setup({ 'mcp.list': listing(['demo_math', 'connected']) })
      await service.mcpList({ folderId: folder.id })
      expect(openEvents).toHaveBeenCalledWith(wsl, expect.any(AbortSignal))
      service.stop()
    })

    it('connects a disabled server and disconnects a connected one, in the thread’s directory', async () => {
      const { service, folder, calls, store } = setup({
        'mcp.list': listing(['demo_math', 'connected'], ['context 7', 'disabled']),
        'session.create': { data: { id: 'ses_new' } },
      })
      await service.mcpSetEnabled({ folderId: folder.id, server: 'context 7', enabled: true })
      await service.mcpSetEnabled({ folderId: folder.id, server: 'demo_math', enabled: false })
      expect(calls.filter((call) => call.operation !== 'mcp.list')).toEqual([
        { operation: 'mcp.connect', request: { params: { server: 'context 7' }, query: { 'location[directory]': '/home/me/app' } } },
        { operation: 'mcp.disconnect', request: { params: { server: 'demo_math' }, query: { 'location[directory]': '/home/me/app' } } },
      ])
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
      const thread = store.get('ses_new')!
      calls.length = 0
      await service.mcpSetEnabled({ threadId: 'ses_new', server: 'demo_math', enabled: false })
      expect(calls[1]?.request.query).toEqual({ 'location[directory]': thread.directory })
      service.stop()
    })

    it('does nothing for a server that is already in the state asked for', async () => {
      const { service, folder, calls } = setup({ 'mcp.list': listing(['demo_math', 'connected'], ['demo_display', 'disabled'], ['slow', 'pending']) })
      await service.mcpSetEnabled({ folderId: folder.id, server: 'demo_math', enabled: true })
      await service.mcpSetEnabled({ folderId: folder.id, server: 'demo_display', enabled: false })
      await service.mcpSetEnabled({ folderId: folder.id, server: 'slow', enabled: true })
      expect(calls.map((call) => call.operation)).toEqual(['mcp.list', 'mcp.list', 'mcp.list'])
      service.stop()
    })

    it('retries a failed server by connecting it', async () => {
      const { service, folder, calls } = setup({ 'mcp.list': listing(['broken', 'failed', { error: 'exit 1' }]) })
      await service.mcpSetEnabled({ folderId: folder.id, server: 'broken', enabled: true })
      expect(calls.at(-1)?.operation).toBe('mcp.connect')
      service.stop()
    })

    it('only touches servers OpenCode lists, and leaves one that waits for a sign-in alone', async () => {
      const { service, folder, calls } = setup({ 'mcp.list': listing(['login', 'needs_auth', { error: 'Sign in' }], ['odd', 'something-new']) })
      await expect(service.mcpSetEnabled({ folderId: folder.id, server: 'gone', enabled: true })).rejects.toThrow('not configured any more')
      await expect(service.mcpSetEnabled({ folderId: folder.id, server: 'login', enabled: true })).rejects.toThrow('sign-in')
      await expect(service.mcpSetEnabled({ folderId: folder.id, server: 'odd', enabled: false })).rejects.toThrow('does not know')
      expect(calls.every((call) => call.operation === 'mcp.list')).toBe(true)
      service.stop()
    })

    it('tells a vanished server from an OpenCode that cannot toggle', async () => {
      const gone = setup({ 'mcp.list': listing(['demo_math', 'connected']), 'mcp.disconnect': new OpenCodeServiceError('x', 404, 'McpServerNotFoundError') })
      await expect(gone.service.mcpSetEnabled({ folderId: gone.folder.id, server: 'demo_math', enabled: false })).rejects.toThrow('not configured any more')
      const old = setup({ 'mcp.list': listing(['demo_math', 'connected']), 'mcp.disconnect': new OpenCodeServiceError('Not found', 404) })
      await expect(old.service.mcpSetEnabled({ folderId: old.folder.id, server: 'demo_math', enabled: false })).rejects.toThrow('Update OpenCode')
      const down = setup({ 'mcp.list': listing(['demo_math', 'connected']), 'mcp.disconnect': new OpenCodeServiceError('Boom', 500) })
      await expect(down.service.mcpSetEnabled({ folderId: down.folder.id, server: 'demo_math', enabled: false })).rejects.toThrow('Boom')
      for (const each of [gone, old, down]) each.service.stop()
    })

    it('passes MCP changes on without any thread, and ignores the ones that change nothing visible', () => {
      const { service, events } = setup()
      emit(service, 'mcp.status.changed', { server: 'demo_math' })
      emit(service, 'mcp.tools.changed', { server: 'demo_math' })
      emit(service, 'mcp.resources.changed', { server: 'demo_math' })
      expect(events).toEqual([{ type: 'mcp', target: wsl }, { type: 'mcp', target: wsl }])
      service.stop()
    })

    it('refuses where the Inbox is unavailable', async () => {
      const { service, folder, disable, calls } = setup()
      disable()
      await expect(service.mcpList({ folderId: folder.id })).rejects.toThrow('only available')
      await expect(service.mcpSetEnabled({ folderId: folder.id, server: 'demo_math', enabled: false })).rejects.toThrow('only available')
      expect(calls).toEqual([])
    })
  })

  it('creates a session in the folder, records it, and sends the first message', async () => {
    const { service, store, folder, calls, openEvents } = setup({ 'session.create': { data: { id: 'ses_new', title: 'New session' } } })
    const thread = await service.create({ folderId: folder.id, text: 'Fix the login', agent: 'plan', model })
    expect(calls.map((call) => call.operation)).toEqual(['session.create', 'session.prompt'])
    expect(calls[0]?.request.body).toEqual({
      agent: 'plan', model: { id: 'model-1', providerID: 'provider-1' }, location: { directory: '/home/me/app' },
    })
    expect(calls[1]?.request).toEqual({ params: { sessionID: 'ses_new' }, body: { text: 'Fix the login' } })
    expect(thread).toMatchObject({ id: 'ses_new', title: 'New session', folderId: 'fld_abc', status: 'working' })
    expect(store.composer()).toEqual({ folderId: 'fld_abc', agent: 'plan', model })
    expect(openEvents).toHaveBeenCalledWith(wsl, expect.any(AbortSignal))
    service.stop()
  })

  it('settles a new thread whose first message failed', async () => {
    const { service, store, folder } = setup({
      'session.create': { data: { id: 'ses_new' } },
      'session.prompt': new Error('Model unavailable'),
    })
    await expect(service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })).rejects.toThrow('Model unavailable')
    expect(store.get('ses_new')?.status).toBe('idle')
    service.stop()
  })

  it('refuses to start threads where the Inbox is unavailable or with an empty message', async () => {
    const { service, folder, disable } = setup()
    await expect(service.create({ folderId: folder.id, text: '   ', agent: 'build', model })).rejects.toThrow('Type a message first.')
    disable()
    await expect(service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })).rejects.toThrow('only available on macOS')
  })

  it('switches agent and model only when they changed, then sends', async () => {
    const { service, folder, calls } = setup({
      'session.create': { data: { id: 'ses_new' } },
      'session.get': { data: { id: 'ses_new', agent: 'build', model: { id: 'model-1', providerID: 'provider-1' } } },
    })
    await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
    calls.length = 0
    await service.send({ threadId: 'ses_new', text: 'Plan it', agent: 'plan', model })
    expect(calls.map((call) => call.operation)).toEqual(['session.get', 'session.switchAgent', 'session.prompt'])
    expect(calls[1]?.request.body).toEqual({ agent: 'plan' })
    calls.length = 0
    await service.send({ threadId: 'ses_new', text: 'Go' })
    expect(calls.map((call) => call.operation)).toEqual(['session.prompt'])
    await expect(service.send({ threadId: 'ses_unknown', text: 'Go' })).rejects.toThrow('no longer in the Inbox')
    service.stop()
  })

  it('loads the newest page with the running state, and older pages by cursor', async () => {
    const { service, folder, calls } = setup({
      'session.create': { data: { id: 'ses_new' } },
      'session.message.list': {
        data: Array.from({ length: 50 }, (_, index) => ({ id: `msg_${50 - index}`, type: 'user', text: 'Hi', time: { created: 50 - index } })),
        cursor: { next: 'older-1' },
      },
      'session.active': { data: { ses_new: { type: 'running' } } },
    })
    await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
    calls.length = 0
    const page = await service.messages({ threadId: 'ses_new' })
    expect(page.messages).toHaveLength(50)
    expect(page.messages[0]).toEqual({ kind: 'user', id: 'msg_1', time: 1, text: 'Hi' })
    expect(page).toMatchObject({ older: 'older-1', running: true })
    expect(calls.find((call) => call.operation === 'session.message.list')?.request.query).toEqual({ limit: '50', order: 'desc' })
    calls.length = 0
    await service.messages({ threadId: 'ses_new', cursor: 'older-1' })
    // An older page needs neither the running state's session lookup nor the thread's totals again.
    expect(calls.map((call) => call.operation)).toEqual(['session.message.list', 'session.active'])
    expect(calls[0]?.request.query).toEqual({ limit: '50', cursor: 'older-1' })
    service.stop()
  })

  it('adds the thread totals to the newest page only, and still loads without them', async () => {
    const totals = { cost: 0.42, tokens: { input: 1200, output: 300, reasoning: 50, cache: { read: 9000, write: 100 } } }
    const withTotals = setup({
      'session.create': { data: { id: 'ses_new' } },
      'session.message.list': { data: [], cursor: { next: 'older-1' } },
      'session.active': { data: {} },
      'session.get': { data: { id: 'ses_new', ...totals } },
    })
    await withTotals.service.create({ folderId: withTotals.folder.id, text: 'Hi', agent: 'build', model })
    expect(await withTotals.service.messages({ threadId: 'ses_new' })).toMatchObject({
      usage: { cost: 0.42, tokens: { input: 1200, output: 300, reasoning: 50, cacheRead: 9000, cacheWrite: 100 } },
    })
    expect(await withTotals.service.messages({ threadId: 'ses_new', cursor: 'older-1' })).not.toHaveProperty('usage')
    withTotals.service.stop()

    const failing = setup({
      'session.create': { data: { id: 'ses_new' } },
      'session.message.list': { data: [] },
      'session.active': { data: {} },
      'session.get': new Error('gone'),
    })
    await failing.service.create({ folderId: failing.folder.id, text: 'Hi', agent: 'build', model })
    const page = await failing.service.messages({ threadId: 'ses_new' })
    expect(page).toEqual({ messages: [], older: null, running: false })
    failing.service.stop()
  })

  it('reports a staged revert with the newest page only, and says none when OpenCode has none', async () => {
    const revert = {
      messageID: 'msg_3',
      snapshot: 'abc',
      files: [{ file: 'src/a.ts', patch: 'diff --git a/src/a.ts b/src/a.ts', additions: 2, deletions: 1, status: 'modified' }],
    }
    const staged = setup({
      'session.create': { data: { id: 'ses_new' } },
      'session.message.list': { data: [], cursor: { next: 'older-1' } },
      'session.active': { data: {} },
      'session.get': { data: { id: 'ses_new', revert } },
    })
    await staged.service.create({ folderId: staged.folder.id, text: 'Hi', agent: 'build', model })
    expect(await staged.service.messages({ threadId: 'ses_new' })).toMatchObject({
      revert: { messageId: 'msg_3', files: [{ path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1 }] },
    })
    // The diff stays in OpenCode; and an older page neither asks nor answers.
    expect(JSON.stringify(await staged.service.messages({ threadId: 'ses_new' }))).not.toContain('diff --git')
    expect(await staged.service.messages({ threadId: 'ses_new', cursor: 'older-1' })).not.toHaveProperty('revert')
    staged.service.stop()

    const none = setup({
      'session.create': { data: { id: 'ses_new' } },
      'session.message.list': { data: [] },
      'session.active': { data: {} },
      'session.get': { data: { id: 'ses_new' } },
    })
    await none.service.create({ folderId: none.folder.id, text: 'Hi', agent: 'build', model })
    expect(await none.service.messages({ threadId: 'ses_new' })).toHaveProperty('revert', null)
    none.service.stop()
  })

  it('refetches the conversation when a revert is staged, redone or made permanent', async () => {
    const { service, folder, events } = setup({ 'session.create': { data: { id: 'ses_new' } } })
    await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
    service.subscribe('ses_new')
    const emit = (type: string, data: Record<string, unknown>) =>
      (service as unknown as { onEvent(event: { type: string; data: Record<string, unknown> }): void }).onEvent({ type, data })
    emit('session.revert.staged', { sessionID: 'ses_new', revert: { messageID: 'msg_3', files: [] } })
    emit('session.revert.cleared', { sessionID: 'ses_new' })
    emit('session.revert.committed', { sessionID: 'ses_new', to: 'msg_3' })
    emit('session.revert.staged', { sessionID: 'ses_other', revert: { messageID: 'msg_3', files: [] } })
    expect(events).toEqual([
      { type: 'messages', threadId: 'ses_new' },
      { type: 'messages', threadId: 'ses_new' },
      { type: 'messages', threadId: 'ses_new' },
    ])
    service.stop()
  })

  describe('messages held for the agent', () => {
    /** An item of the session inbox, as the service sends it. */
    const inboxItem = (id: string, text: string, delivery: 'steer' | 'queue' = 'steer', type = 'user') =>
      ({ id, sessionID: 'ses_new', time: { created: 7 }, type, delivery, payload: { text } })
    const emit = (service: InboxChatService, type: string, data: Record<string, unknown>) =>
      (service as unknown as { onEvent(event: { type: string; data: Record<string, unknown> }): void }).onEvent({ type, data })

    it('adds what the service holds to the newest page, after reading it, and not to older pages', async () => {
      const { service, folder, calls } = setup({
        'session.create': { data: { id: 'ses_new' } },
        'session.message.list': { data: [{ id: 'msg_1', type: 'user', text: 'Hi', time: { created: 1 } }], cursor: { next: 'older-1' } },
        'session.active': { data: {} },
        'session.inbox.list': { data: [inboxItem('msg_p1', 'Also add a test'), inboxItem('msg_p2', 'Then lint', 'queue'), inboxItem('msg_p3', 'Agent note', 'steer', 'synthetic')] },
      })
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
      calls.length = 0
      const page = await service.messages({ threadId: 'ses_new' })
      expect(page.pending).toEqual([
        { id: 'msg_p1', delivery: 'steer', message: { kind: 'user', id: 'msg_p1', time: 7, text: 'Also add a test' } },
        { id: 'msg_p2', delivery: 'queue', message: { kind: 'user', id: 'msg_p2', time: 7, text: 'Then lint' } },
      ])
      // The inbox first: a message delivered between the two reads is then in both, never in neither.
      const operations = calls.map((call) => call.operation)
      expect(operations[0]).toBe('session.inbox.list')
      expect(operations.indexOf('session.inbox.list')).toBeLessThan(operations.indexOf('session.message.list'))
      expect(calls[0]?.request).toEqual({ params: { sessionID: 'ses_new' } })
      calls.length = 0
      const older = await service.messages({ threadId: 'ses_new', cursor: 'older-1' })
      expect(older).not.toHaveProperty('pending')
      expect(calls.map((call) => call.operation)).not.toContain('session.inbox.list')
      service.stop()
    })

    it('says an empty inbox is empty, and an inbox it could not read is unknown', async () => {
      const read = (answer: unknown) => {
        const { service, folder } = setup({
          'session.create': { data: { id: 'ses_new' } },
          'session.message.list': { data: [{ id: 'msg_1', type: 'user', text: 'Hi', time: { created: 1 } }] },
          'session.active': { data: {} },
          'session.inbox.list': answer,
        })
        return service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model }).then(() => service.messages({ threadId: 'ses_new' }))
      }
      expect((await read({ data: [] })).pending).toEqual([])
      // The conversation still loads when the inbox answers with something else, or does not answer.
      for (const answer of [null, { data: 'no' }, new OpenCodeServiceError('Not found', 404), new Error('The OpenCode service sent an invalid answer.')]) {
        const page = await read(answer)
        expect(page.messages).toHaveLength(1)
        expect(page).not.toHaveProperty('pending')
      }
    })

    it('returns the message as OpenCode took it, so that a busy agent\'s holding of it can be shown', async () => {
      const { service, folder, calls } = setup({
        'session.create': { data: { id: 'ses_new' } },
        'session.prompt': { data: inboxItem('msg_p1', 'Also add a test') },
      })
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
      calls.length = 0
      await expect(service.send({ threadId: 'ses_new', text: 'Also add a test' })).resolves.toEqual({
        id: 'msg_p1', delivery: 'steer', message: { kind: 'user', id: 'msg_p1', time: 7, text: 'Also add a test' },
      })
      // Left alone, the way of delivery is the service's to choose; nothing about it is sent.
      expect(calls.map((call) => call.operation)).toEqual(['session.prompt'])
      expect(calls[0]?.request.body).toEqual({ text: 'Also add a test' })
      service.stop()
    })

    it('sends the chosen way of delivery with the prompt, along with the rest of it', async () => {
      const { service, folder, calls } = setup({
        'session.create': { data: { id: 'ses_new' } },
        'session.prompt': { data: inboxItem('msg_p1', 'Then lint', 'queue') },
      })
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
      for (const delivery of ['queue', 'steer'] as const) {
        calls.length = 0
        const held = await service.send({ threadId: 'ses_new', text: 'Then lint', delivery })
        expect(calls.map((call) => call.operation)).toEqual(['session.prompt'])
        expect(calls[0]?.request.body).toEqual({ text: 'Then lint', delivery })
        expect(held).toMatchObject({ id: 'msg_p1', delivery: 'queue' })
      }
      service.stop()
    })

    it('does not send a way of delivery with the first message of a thread', async () => {
      const { service, folder, calls } = setup({ 'session.create': { data: { id: 'ses_new' } } })
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
      const prompt = calls.find((call) => call.operation === 'session.prompt')
      expect(prompt?.request.body).toEqual({ text: 'Hi' })
      service.stop()
    })

    it('still sends when the answer to the prompt cannot be read', async () => {
      const { service, folder } = setup({ 'session.create': { data: { id: 'ses_new' } }, 'session.prompt': null })
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
      await expect(service.send({ threadId: 'ses_new', text: 'Hello' })).resolves.toBeNull()
      service.stop()
    })

    it('takes a held message back with one DELETE on the recorded session and message', async () => {
      const { service, folder, calls, disable } = setup({ 'session.create': { data: { id: 'ses_new' } } })
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
      calls.length = 0
      await service.discardPending({ threadId: 'ses_new', messageId: 'msg_p1' })
      expect(calls).toEqual([{ operation: 'session.inbox.cancel', request: { params: { sessionID: 'ses_new', inboxID: 'msg_p1' } } }])
      // A thread the Inbox does not hold is not the service's to ask about, and neither is any when the Inbox is off.
      await expect(service.discardPending({ threadId: 'ses_unknown', messageId: 'msg_p1' })).rejects.toThrow()
      disable()
      calls.length = 0
      await expect(service.discardPending({ threadId: 'ses_new', messageId: 'msg_p1' })).rejects.toThrow()
      expect(calls).toEqual([])
      service.stop()
    })

    it('switches how a held message is delivered with one PATCH on the recorded session and message', async () => {
      const { service, folder, calls, disable } = setup({ 'session.create': { data: { id: 'ses_new' } } })
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
      calls.length = 0
      await service.setDelivery({ threadId: 'ses_new', messageId: 'msg_p1', delivery: 'queue' })
      await service.setDelivery({ threadId: 'ses_new', messageId: 'msg_p1', delivery: 'steer' })
      expect(calls).toEqual([
        { operation: 'session.inbox.update', request: { params: { sessionID: 'ses_new', inboxID: 'msg_p1' }, body: { delivery: 'queue' } } },
        { operation: 'session.inbox.update', request: { params: { sessionID: 'ses_new', inboxID: 'msg_p1' }, body: { delivery: 'steer' } } },
      ])
      await expect(service.setDelivery({ threadId: 'ses_unknown', messageId: 'msg_p1', delivery: 'queue' })).rejects.toThrow()
      disable()
      calls.length = 0
      await expect(service.setDelivery({ threadId: 'ses_new', messageId: 'msg_p1', delivery: 'queue' })).rejects.toThrow()
      expect(calls).toEqual([])
      service.stop()
    })

    it('gives the reason, that the agent may have taken the message up, when the service refuses the switch, and passes other failures on', async () => {
      const refused = setup({
        'session.create': { data: { id: 'ses_new' } },
        'session.inbox.update': new OpenCodeServiceError('Pending input cannot change to queue: msg_p1', 409, 'ConflictError'),
      })
      await refused.service.create({ folderId: refused.folder.id, text: 'Hi', agent: 'build', model })
      const failure = await refused.service.setDelivery({ threadId: 'ses_new', messageId: 'msg_p1', delivery: 'queue' }).catch((error: Error) => error)
      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).message).toBe('the agent may already have taken it up.')
      // The service's own wording, with its ID, is not what the reader sees.
      expect((failure as Error).message).not.toContain('msg_p1')
      refused.service.stop()
      const down = setup({
        'session.create': { data: { id: 'ses_new' } },
        'session.inbox.update': new OpenCodeServiceError('Session not found', 404, 'SessionNotFoundError'),
      })
      await down.service.create({ folderId: down.folder.id, text: 'Hi', agent: 'build', model })
      await expect(down.service.setDelivery({ threadId: 'ses_new', messageId: 'msg_p1', delivery: 'queue' })).rejects.toThrow('Session not found')
      down.service.stop()
    })

    it('passes on why the service would not take a message back', async () => {
      const { service, folder } = setup({ 'session.create': { data: { id: 'ses_new' } }, 'session.inbox.cancel': new OpenCodeServiceError('Session not found', 404, 'SessionNotFoundError') })
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
      await expect(service.discardPending({ threadId: 'ses_new', messageId: 'msg_p1' })).rejects.toThrow('Session not found')
      service.stop()
    })

    it('refetches the conversation when a message is held, changes how it is delivered, is taken back or is delivered', async () => {
      const { service, folder, events } = setup({ 'session.create': { data: { id: 'ses_new' } } })
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
      service.subscribe('ses_new')
      emit(service, 'session.inbox.enqueued', { sessionID: 'ses_new', inboxID: 'msg_p1', item: { type: 'user', delivery: 'steer', payload: { text: 'x' } } })
      emit(service, 'session.inbox.delivery.changed', { sessionID: 'ses_new', inboxID: 'msg_p1', delivery: 'queue' })
      emit(service, 'session.inbox.cancelled', { sessionID: 'ses_new', inboxID: 'msg_p1' })
      emit(service, 'session.inbox.delivered', { sessionID: 'ses_new', inboxID: 'msg_p2' })
      emit(service, 'session.inbox.enqueued', { sessionID: 'ses_other', inboxID: 'msg_p3', item: { type: 'user', delivery: 'steer', payload: { text: 'y' } } })
      expect(events).toEqual(Array.from({ length: 4 }, () => ({ type: 'messages', threadId: 'ses_new' })))
      service.stop()
    })
  })

  it('redoes a staged revert with one DELETE on the recorded session', async () => {
    const { service, folder, calls, request, store, disable } = setup({ 'session.create': { data: { id: 'ses_new' } } })
    await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
    calls.length = 0
    await service.redo('ses_new')
    expect(calls).toEqual([{ operation: 'session.revert.clear', request: { params: { sessionID: 'ses_new' } } }])
    expect(request).toHaveBeenLastCalledWith(wsl, 'session.revert.clear', { params: { sessionID: 'ses_new' } })
    // Nothing about the thread changes: the status and read state belong to the run, not to a redo.
    expect(store.get('ses_new')?.status).toBe('working')
    await expect(service.redo('ses_other')).rejects.toThrow('no longer in the Inbox')
    disable()
    await expect(service.redo('ses_new')).rejects.toThrow('only available on macOS')
    service.stop()
  })

  it.each([
    [new OpenCodeServiceError('Session is busy: ses_new', 409, 'SessionBusyError'), 'still working on this thread'],
    [new OpenCodeServiceError('OpenCode answered with status 404.', 404), 'does not support redo'],
    [new OpenCodeServiceError('Session not found: ses_new', 404, 'SessionNotFoundError'), 'Session not found: ses_new'],
    [new OpenCodeServiceError('Location not found', 404, 'LocationNotFoundError'), 'Location not found'],
    [new Error('The OpenCode service did not answer in time.'), 'did not answer in time'],
  ])('explains why a redo failed (%s)', async (error, message) => {
    const { service, folder } = setup({ 'session.create': { data: { id: 'ses_new' } }, 'session.revert.clear': error })
    await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
    await expect(service.redo('ses_new')).rejects.toThrow(message as string)
    service.stop()
  })

  describe('reverting to a message', () => {
    const staged = {
      data: {
        messageID: 'msg_3',
        snapshot: 'abc',
        files: [{ file: 'src/a.ts', patch: 'diff --git a/src/a.ts b/src/a.ts', additions: 2, deletions: 1, status: 'modified' }],
      },
    }

    it('stops the thread, stages the revert on the recorded session, and returns what OpenCode staged', async () => {
      const { service, folder, calls, request, store, disable } = setup({
        'session.create': { data: { id: 'ses_new' } },
        'session.interrupt': { interrupted: true },
        'session.revert.stage': staged,
      })
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
      calls.length = 0
      const revert = await service.revert({ threadId: 'ses_new', messageId: 'msg_3' })
      expect(calls).toEqual([
        { operation: 'session.interrupt', request: { params: { sessionID: 'ses_new' } } },
        { operation: 'session.revert.stage', request: { params: { sessionID: 'ses_new' }, body: { messageID: 'msg_3' } } },
      ])
      expect(request).toHaveBeenLastCalledWith(wsl, 'session.revert.stage', expect.anything())
      // The diff stays in OpenCode.
      expect(revert).toEqual({ messageId: 'msg_3', files: [{ path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1 }] })
      expect(store.get('ses_new')).toBeDefined()
      await expect(service.revert({ threadId: 'ses_other', messageId: 'msg_3' })).rejects.toThrow('no longer in the Inbox')
      disable()
      await expect(service.revert({ threadId: 'ses_new', messageId: 'msg_3' })).rejects.toThrow('only available on macOS')
      service.stop()
    })

    it('leaves the files alone only when asked to', async () => {
      const { service, folder, calls } = setup({
        'session.create': { data: { id: 'ses_new' } },
        'session.revert.stage': { data: { messageID: 'msg_3', files: [] } },
      })
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
      const bodies = async (files?: boolean): Promise<unknown> => {
        calls.length = 0
        await service.revert({ threadId: 'ses_new', messageId: 'msg_3', ...(files === undefined ? {} : { files }) })
        return calls.find((call) => call.operation === 'session.revert.stage')?.request.body
      }
      expect(await bodies()).toEqual({ messageID: 'msg_3' })
      expect(await bodies(true)).toEqual({ messageID: 'msg_3' })
      expect(await bodies(false)).toEqual({ messageID: 'msg_3', files: false })
      service.stop()
    })

    it('tries again while OpenCode is still stopping, and stages as soon as it has', async () => {
      const { service, folder, request } = setup({ 'session.create': { data: { id: 'ses_new' } }, 'session.interrupt': { interrupted: true } })
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
      let busy = 3
      const previous = request.getMockImplementation()!
      request.mockImplementation(async (target, operation, input) => {
        if (operation !== 'session.revert.stage') return previous(target, operation, input)
        if (busy-- > 0) throw new OpenCodeServiceError('Session is busy: ses_new', 409, 'SessionBusyError')
        return staged
      })
      request.mockClear()
      await expect(service.revert({ threadId: 'ses_new', messageId: 'msg_3' })).resolves.toMatchObject({ messageId: 'msg_3' })
      const operations = request.mock.calls.map((call) => call[1])
      expect(operations.filter((operation) => operation === 'session.interrupt')).toHaveLength(1)
      expect(operations.filter((operation) => operation === 'session.revert.stage')).toHaveLength(4)
      service.stop()
    })

    it('gives up with a plain message when the thread never stops', async () => {
      const { service, folder, request } = setup({
        'session.create': { data: { id: 'ses_new' } },
        'session.revert.stage': new OpenCodeServiceError('Session is busy: ses_new', 409, 'SessionBusyError'),
      })
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
      request.mockClear()
      await expect(service.revert({ threadId: 'ses_new', messageId: 'msg_3' })).rejects.toThrow('still stopping this thread')
      expect(request.mock.calls.filter((call) => call[1] === 'session.revert.stage')).toHaveLength(40)
      service.stop()
    })

    it.each([
      [new OpenCodeServiceError('Message not found: msg_3', 404, 'MessageNotFoundError'), 'no longer in the conversation'],
      [new OpenCodeServiceError('OpenCode answered with status 404.', 404), 'does not support reverting'],
      [new OpenCodeServiceError('Session not found: ses_new', 404, 'SessionNotFoundError'), 'Session not found: ses_new'],
      [new OpenCodeServiceError('Bad message', 400, 'InvalidRequestError'), 'Bad message'],
      [new Error('The OpenCode service did not answer in time.'), 'did not answer in time'],
    ])('explains why a revert failed (%s)', async (error, message) => {
      const { service, folder, request } = setup({ 'session.create': { data: { id: 'ses_new' } }, 'session.revert.stage': error })
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
      request.mockClear()
      await expect(service.revert({ threadId: 'ses_new', messageId: 'msg_3' })).rejects.toThrow(message as string)
      // Only a busy thread is tried again.
      expect(request.mock.calls.filter((call) => call[1] === 'session.revert.stage')).toHaveLength(1)
      service.stop()
    })

    it('does not try to revert when stopping the thread failed', async () => {
      const { service, folder, request } = setup({ 'session.create': { data: { id: 'ses_new' } }, 'session.interrupt': new Error('Service unavailable') })
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
      request.mockClear()
      await expect(service.revert({ threadId: 'ses_new', messageId: 'msg_3' })).rejects.toThrow('Service unavailable')
      expect(request.mock.calls.map((call) => call[1])).toEqual(['session.interrupt'])
      service.stop()
    })

    it('still reports the revert when OpenCode answers in a shape MDE cannot read', async () => {
      const { service, folder } = setup({ 'session.create': { data: { id: 'ses_new' } }, 'session.revert.stage': null })
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
      await expect(service.revert({ threadId: 'ses_new', messageId: 'msg_3' })).resolves.toEqual({ messageId: 'msg_3', files: [] })
      service.stop()
    })

    it('puts text above the thread draft through the draft channel', async () => {
      const path = await fs.mkdtemp(join(tmpdir(), 'mde-chat-revert-draft-'))
      const drafts = new InboxDraftStore(path)
      const { service, folder } = setup({ 'session.create': { data: { id: 'ses_new' } } }, drafts)
      try {
        await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
        const key = 'thread:ses_new' as const
        expect((await service.draft({ key, action: 'prepend', text: 'Restored message' })).text).toBe('Restored message')
        await service.draft({ key, action: 'text', text: 'Typed since' })
        expect((await service.draft({ key, action: 'prepend', text: 'Another' })).text).toBe('Another\n\nTyped since')
        // Only a thread MDE holds has a draft to put text in.
        await expect(service.draft({ key: 'thread:ses_unknown', action: 'prepend', text: 'x' })).rejects.toThrow('no longer in the Inbox')
      } finally { service.stop(); await fs.rm(path, { recursive: true, force: true }) }
    })
  })

  describe('forking a thread', () => {
    const forked = { data: { id: 'ses_fork', title: 'Fix login (fork #1)', model: { id: 'free-1', providerID: 'opencode' }, fork: { sessionID: 'ses_new', boundary: { type: 'through', messageID: 'msg_9' } } } }
    const none = { data: {} }
    const running = { data: { ses_new: { type: 'running' } } }
    const started = async (responses: Parameters<typeof setup>[0] = {}) => {
      const context = setup({ 'session.create': { data: { id: 'ses_new', title: 'Fix login' } }, 'session.fork': forked, 'session.get': { data: {} }, 'session.active': none, ...responses })
      await context.service.create({ folderId: context.folder.id, text: 'Hi', agent: 'build', model })
      await vi.waitFor(() => expect(context.store.get('ses_new')?.branch).toBe('main'))
      context.calls.length = 0
      return context
    }
    /** Answers message-list requests from pages, newest first, whatever the other operations do. */
    const pages = (context: Awaited<ReturnType<typeof started>>, answers: unknown[]) => {
      const previous = context.request.getMockImplementation()!
      let next = 0
      context.request.mockImplementation(async (target, operation, input) => {
        if (operation === 'session.message.list') {
          context.calls.push({ operation, request: input ?? {} })
          return answers[Math.min(next++, answers.length - 1)]
        }
        return previous(target, operation, input)
      })
    }
    const user = (id: string, text: string) => ({ id, type: 'user', text })
    const filler = (count: number, prefix: string) => Array.from({ length: count }, (_, index) => ({ id: `msg_${prefix}${String(index).padStart(3, '0')}`, type: 'assistant', content: [] }))

    it('forks the whole conversation of an idle thread and records the new thread beside it', async () => {
      const { service, store, calls } = await started()
      const original = store.get('ses_new')
      const result = await service.fork({ threadId: 'ses_new' })
      expect(calls).toEqual([
        { operation: 'session.get', request: { params: { sessionID: 'ses_new' } } },
        { operation: 'session.active', request: {} },
        { operation: 'session.fork', request: { params: { sessionID: 'ses_new' }, body: { before: null } } },
      ])
      expect(result.text).toBeUndefined()
      expect(result.thread).toMatchObject({
        id: 'ses_fork', title: 'Fix login (fork #1)', status: 'idle', forkedFrom: 'ses_new', folderId: original!.folderId,
        directory: original!.directory, target: original!.target, model: { id: 'free-1', providerId: 'opencode' }, archived: false,
      })
      expect(store.get('ses_fork')).toEqual(result.thread)
      expect(isInboxThreadUnread(result.thread)).toBe(false)
      // Nothing about the original changes.
      expect(store.get('ses_new')).toEqual(original)
      service.stop()
    })

    it('cuts before the message it is asked to, and reads nothing else first', async () => {
      const { service, calls, store } = await started()
      const result = await service.fork({ threadId: 'ses_new', messageId: 'msg_3' })
      expect(calls).toEqual([{ operation: 'session.fork', request: { params: { sessionID: 'ses_new' }, body: { before: 'msg_3' } } }])
      expect(result.text).toBeUndefined()
      expect(store.get('ses_fork')).toMatchObject({ forkedFrom: 'ses_new' })
      service.stop()
    })

    it('cuts at a staged revert, so the fork does not bring the hidden messages back', async () => {
      const { service, calls } = await started({ 'session.get': { data: { revert: { messageID: 'msg_5', files: [] } } }, 'session.active': running })
      const result = await service.fork({ threadId: 'ses_new' })
      expect(calls.map((call) => call.operation)).toEqual(['session.get', 'session.active', 'session.fork'])
      expect(calls[2]!.request.body).toEqual({ before: 'msg_5' })
      expect(result.text).toBeUndefined()
      service.stop()
    })

    it('cuts before the unfinished turn of a working thread and hands back its text', async () => {
      const context = await started({ 'session.active': running })
      pages(context, [{ data: [{ id: 'msg_8', type: 'assistant' }, user('msg_7', 'Now fix the tests'), { id: 'msg_6', type: 'idle', outcome: 'succeeded' }, user('msg_5', 'Earlier request')] }])
      const result = await context.service.fork({ threadId: 'ses_new' })
      expect(context.calls.map((call) => call.operation)).toEqual(['session.get', 'session.active', 'session.message.list', 'session.fork'])
      expect(context.calls[2]!.request).toEqual({ params: { sessionID: 'ses_new' }, query: { limit: '50', order: 'desc' } })
      expect(context.calls[3]!.request.body).toEqual({ before: 'msg_7' })
      expect(result.text).toBe('Now fix the tests')
      context.service.stop()
    })

    it('reads on through older pages until it finds where the turn began', async () => {
      const context = await started({ 'session.active': running })
      pages(context, [
        { data: filler(50, 'a'), cursor: { next: 'cursor-2' } },
        { data: [{ id: 'msg_c', type: 'assistant' }, user('msg_b', 'The long request'), { id: 'msg_a', type: 'idle' }], cursor: { next: 'cursor-3' } },
      ])
      const result = await context.service.fork({ threadId: 'ses_new' })
      const lists = context.calls.filter((call) => call.operation === 'session.message.list')
      expect(lists.map((call) => call.request.query)).toEqual([{ limit: '50', order: 'desc' }, { limit: '50', cursor: 'cursor-2' }])
      expect(context.calls.at(-1)!.request.body).toEqual({ before: 'msg_b' })
      expect(result.text).toBe('The long request')
      context.service.stop()
    })

    it('treats the first turn as unfinished when the thread has no earlier idle, and does not read forever', async () => {
      const first = await started({ 'session.active': running })
      pages(first, [{ data: [{ id: 'msg_2', type: 'assistant' }, user('msg_1', 'The very first request')] }])
      await expect(first.service.fork({ threadId: 'ses_new' })).resolves.toMatchObject({ text: 'The very first request' })
      expect(first.calls.at(-1)!.request.body).toEqual({ before: 'msg_1' })
      first.service.stop()

      // A page that is always full with a cursor stops at ten, keeping the oldest user message it saw.
      const endless = await started({ 'session.active': running })
      const full = (index: number) => ({ data: [...filler(49, `p${index}`), user(`msg_u${index}`, `Request ${index}`)], cursor: { next: `cursor-${index + 1}` } })
      pages(endless, Array.from({ length: 12 }, (_, index) => full(index)))
      const result = await endless.service.fork({ threadId: 'ses_new' })
      expect(endless.calls.filter((call) => call.operation === 'session.message.list')).toHaveLength(10)
      expect(endless.calls.at(-1)!.request.body).toEqual({ before: 'msg_u9' })
      expect(result.text).toBe('Request 9')
      endless.service.stop()
    })

    it('copies everything when nothing started the run, and offers no text for a message without any', async () => {
      const stopped = await started({ 'session.active': running })
      pages(stopped, [{ data: [{ id: 'msg_3', type: 'idle' }, user('msg_2', 'Done')] }])
      const result = await stopped.service.fork({ threadId: 'ses_new' })
      expect(stopped.calls.at(-1)!.request.body).toEqual({ before: null })
      expect(result.text).toBeUndefined()
      stopped.service.stop()

      const silent = await started({ 'session.active': running })
      pages(silent, [{ data: [user('msg_2', '   ')] }])
      const blank = await silent.service.fork({ threadId: 'ses_new' })
      expect(silent.calls.at(-1)!.request.body).toEqual({ before: 'msg_2' })
      expect(blank.text).toBeUndefined()
      silent.service.stop()
    })

    it.each([
      [new OpenCodeServiceError('Message not found: msg_3', 404, 'MessageNotFoundError'), 'no longer in the conversation'],
      [new OpenCodeServiceError('OpenCode answered with status 404.', 404), 'does not support forking'],
      [new OpenCodeServiceError('Session not found: ses_new', 404, 'SessionNotFoundError'), 'Session not found: ses_new'],
      [new OpenCodeServiceError('Expected a string starting with "msg_"', 400, 'InvalidRequestError'), 'Expected a string starting with'],
      [new Error('The OpenCode service did not answer in time.'), 'did not answer in time'],
    ])('explains why a fork failed and records nothing (%s)', async (error, message) => {
      const { service, store, request } = await started({ 'session.fork': error })
      request.mockClear()
      await expect(service.fork({ threadId: 'ses_new', messageId: 'msg_3' })).rejects.toThrow(message as string)
      expect(request.mock.calls.filter((call) => call[1] === 'session.fork')).toHaveLength(1)
      expect(store.list().map((thread) => thread.id)).toEqual(['ses_new'])
      service.stop()
    })

    it('records nothing when the service answers with something that is not a session', async () => {
      for (const answer of [null, { data: {} }, { data: { id: '../x' } }]) {
        const { service, store } = await started({ 'session.fork': answer })
        await expect(service.fork({ threadId: 'ses_new', messageId: 'msg_3' })).rejects.toThrow()
        expect(store.list().map((thread) => thread.id)).toEqual(['ses_new'])
        service.stop()
      }
    })

    it('does not ask the service anything for a thread it does not hold or where the Inbox is off', async () => {
      const { service, request, disable } = await started()
      request.mockClear()
      await expect(service.fork({ threadId: 'ses_other' })).rejects.toThrow('no longer in the Inbox')
      disable()
      await expect(service.fork({ threadId: 'ses_new' })).rejects.toThrow('only available on macOS')
      expect(request).not.toHaveBeenCalled()
      service.stop()
    })

    it('forks a thread whose folder has been removed from the Inbox', async () => {
      const { service, store, folder } = await started()
      store.removeFolder(folder.id)
      const result = await service.fork({ threadId: 'ses_new' })
      expect(result.thread).toMatchObject({ id: 'ses_fork', folderId: folder.id, directory: '/home/me/app' })
      service.stop()
    })

    it('forks a fork, pointing at the thread it came from', async () => {
      const { service, store, request } = await started()
      await service.fork({ threadId: 'ses_new' })
      request.mockImplementation(async (...args) => (args[1] === 'session.fork'
        ? { data: { id: 'ses_grandchild', title: 'Fix login (fork #2)' } }
        : args[1] === 'session.active' ? none : null))
      const result = await service.fork({ threadId: 'ses_fork' })
      expect(result.thread).toMatchObject({ id: 'ses_grandchild', forkedFrom: 'ses_fork' })
      expect(store.get('ses_fork')?.forkedFrom).toBe('ses_new')
      service.stop()
    })
  })

  it('replies to permissions and questions with checked IDs', async () => {
    const { service, folder, calls } = setup({ 'session.create': { data: { id: 'ses_new' } } })
    await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
    calls.length = 0
    await service.replyPermission({ threadId: 'ses_new', requestId: 'per_1', decision: 'always' })
    await service.replyForm({ threadId: 'ses_new', formId: 'frm_1', answer: { q0: 'Red' } })
    expect(calls).toEqual([
      { operation: 'session.permission.reply', request: { params: { sessionID: 'ses_new', requestID: 'per_1' }, body: { decision: 'always' } } },
      { operation: 'session.form.reply', request: { params: { sessionID: 'ses_new', formID: 'frm_1' }, body: { answer: { q0: 'Red' } } } },
    ])
    service.stop()
  })

  it('pushes live changes only for subscribed threads', async () => {
    const { service, folder, events, store } = setup({ 'session.create': { data: { id: 'ses_new' } } })
    await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
    const emit = (type: string, data: Record<string, unknown>) =>
      (service as unknown as { onEvent(event: { type: string; data: Record<string, unknown> }): void }).onEvent({ type, data })
    emit('session.text.delta', { sessionID: 'ses_new', assistantMessageID: 'msg_1', ordinal: 0, delta: 'Hel' })
    expect(events).toEqual([])
    service.subscribe('ses_new')
    emit('session.text.delta', { sessionID: 'ses_new', assistantMessageID: 'msg_1', ordinal: 0, delta: 'Hel' })
    emit('session.reasoning.delta', { sessionID: 'ses_new', assistantMessageID: 'bad id', ordinal: 0, delta: 'x' })
    emit('session.tool.called', { sessionID: 'ses_new' })
    emit('form.created', { form: { sessionID: 'ses_new' } })
    emit('session.execution.succeeded', { sessionID: 'ses_new' })
    expect(events).toEqual([
      { type: 'delta', threadId: 'ses_new', messageId: 'msg_1', part: 'text', ordinal: 0, delta: 'Hel' },
      { type: 'messages', threadId: 'ses_new' },
      { type: 'requests', threadId: 'ses_new' },
      { type: 'running', threadId: 'ses_new', running: false },
      { type: 'messages', threadId: 'ses_new' },
    ])
    // The recorder saw them too.
    expect(store.get('ses_new')?.status).toBe('completed')
    service.unsubscribe('ses_new')
    events.length = 0
    emit('session.tool.called', { sessionID: 'ses_new' })
    expect(events).toEqual([])
    service.stop()
  })
})


describe('Inbox native attachments', () => {
  it('sends copied bytes natively and keeps a failed initial prompt on its created thread', async () => {
    const path = await fs.mkdtemp(join(tmpdir(), 'mde-chat-attachments-'))
    const drafts = new InboxDraftStore(path)
    const { service, folder, calls, request } = setup({
      'session.create': { data: { id: 'ses_new' } },
      'session.prompt': new Error('Unavailable'),
    }, drafts)
    try {
      const key = `folder:${folder.id}` as const
      await drafts.add(key, 'notes.txt', 'text/plain', new Uint8Array([65, 66]))
      const draft = await drafts.get(key)
      const attachmentIds = draft.attachments.map((file) => file.id)
      const thread = await service.create({ folderId: folder.id, text: '', agent: 'build', model, attachmentIds, draftRevision: draft.revision })
      expect(thread.sendError).toContain('draft has been kept')
      expect(calls.find((call) => call.operation === 'session.prompt')?.request.body).toEqual({ text: '', files: [{ name: 'notes.txt', uri: 'data:application/octet-stream;base64,QUI=' }] })
      expect((await drafts.get(key)).attachments).toHaveLength(0)
      const retained = await drafts.get('thread:ses_new')
      expect(retained.attachments).toHaveLength(1)
      request.mockResolvedValue(null)
      await service.send({ threadId: thread.id, text: '', attachmentIds, draftRevision: retained.revision })
      expect((await drafts.get('thread:ses_new')).attachments).toHaveLength(0)
      expect(await fs.readdir(join(path, 'attachments'))).toEqual([])
    } finally { service.stop(); await fs.rm(path, { recursive: true, force: true }) }
  })

  it('reduces oversized history pages while preserving their cursor and pagination', async () => {
    const { service, folder, request } = setup({ 'session.create': { data: { id: 'ses_new' } }, 'session.active': { data: {} } })
    await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
    const previous = request.getMockImplementation()!
    const limits: string[] = []
    request.mockImplementation(async (target, operation, input) => {
      if (operation !== 'session.message.list') return previous(target, operation, input)
      limits.push(input!.query!.limit!)
      expect(input!.query!.cursor).toBe('older-page')
      if (input!.query!.limit === '50') throw new Error('The OpenCode service sent more data than MDE accepts.')
      return { data: Array.from({ length: 25 }, (_, index) => ({ type: 'user', id: `msg_${index}`, text: 'Hello', time: { created: index } })), cursor: { next: 'next-page' } }
    })
    const page = await service.messages({ threadId: 'ses_new', cursor: 'older-page' })
    expect(limits).toEqual(['50', '25'])
    expect(page.older).toBe('next-page')
    service.stop()
  })
})

describe('Inbox chat service worktrees', () => {
  const worktree = { repository: '/home/me/app', root: '/home/me/.mde/worktrees/app-abc/1a2b3c4d', branch: 'mde/1a2b3c4d', base: 'origin/main' }
  const made = { directory: worktree.root, worktree }

  function fake() {
    return {
      info: vi.fn(async () => ({ repository: true, branch: 'main', branches: [{ name: 'main', remote: false }] })),
      create: vi.fn(async () => made),
      remove: vi.fn(async () => {}),
      discard: vi.fn(async () => {}),
    }
  }

  it('starts the session in a new worktree and records the thread there', async () => {
    const worktrees = fake()
    const { service, store, folder, calls } = setup({ 'session.create': { data: { id: 'ses_new', title: 'New session' } } }, undefined, worktrees)
    const thread = await service.create({ folderId: folder.id, text: 'Fix the login', agent: 'plan', model, worktree: { base: 'origin/main' } })
    expect(worktrees.create).toHaveBeenCalledWith(expect.objectContaining({ id: folder.id, directory: '/home/me/app' }), 'origin/main', undefined)
    expect(calls[0]?.request.body).toEqual({
      agent: 'plan', model: { id: 'model-1', providerID: 'provider-1' }, location: { directory: worktree.root },
    })
    expect(thread).toMatchObject({ id: 'ses_new', directory: worktree.root, folderId: folder.id, worktree })
    expect(store.get('ses_new')).toMatchObject({ directory: worktree.root, worktree })
    expect(worktrees.discard).not.toHaveBeenCalled()
    service.stop()
  })

  it('passes a chosen branch name on to the worktree', async () => {
    const worktrees = fake()
    const { service, folder } = setup({ 'session.create': { data: { id: 'ses_new' } } }, undefined, worktrees)
    await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model, worktree: { base: 'main', branch: 'feature/dark-mode' } })
    expect(worktrees.create).toHaveBeenLastCalledWith(expect.objectContaining({ id: folder.id }), 'main', 'feature/dark-mode')
    service.stop()
  })

  it('leaves a thread without a worktree request in the folder, without touching Git', async () => {
    const worktrees = fake()
    const { service, folder, calls } = setup({ 'session.create': { data: { id: 'ses_new' } } }, undefined, worktrees)
    const thread = await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })
    expect(calls[0]?.request.body).toMatchObject({ location: { directory: '/home/me/app' } })
    expect(thread.directory).toBe('/home/me/app')
    expect(thread.worktree).toBeUndefined()
    expect(worktrees.create).not.toHaveBeenCalled()
    service.stop()
  })

  it('removes the new worktree when the session cannot be created', async () => {
    const worktrees = fake()
    const { service, store, folder } = setup({ 'session.create': new Error('Service unavailable') }, undefined, worktrees)
    await expect(service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model, worktree: { base: 'main' } })).rejects.toThrow('Service unavailable')
    expect(worktrees.discard).toHaveBeenCalledWith(wsl, worktree)
    expect(store.list()).toEqual([])
    service.stop()
  })

  it('keeps the worktree when only the first message fails, because the thread exists and its draft is kept', async () => {
    const worktrees = fake()
    const { service, store, folder } = setup({
      'session.create': { data: { id: 'ses_new' } },
      'session.prompt': new Error('Model unavailable'),
    }, undefined, worktrees)
    await expect(service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model, worktree: { base: 'main' } })).rejects.toThrow('Model unavailable')
    expect(worktrees.discard).not.toHaveBeenCalled()
    expect(store.get('ses_new')?.worktree).toEqual(worktree)
    service.stop()
  })

  it('does not start a session when the worktree cannot be made', async () => {
    const worktrees = fake()
    worktrees.create.mockRejectedValue(new Error('Could not create the worktree: no space left'))
    const { service, folder, calls } = setup({}, undefined, worktrees)
    await expect(service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model, worktree: { base: 'main' } })).rejects.toThrow('no space left')
    expect(calls).toEqual([])
    expect(worktrees.discard).not.toHaveBeenCalled()
  })

  describe('worktree folders', () => {
    it('lists a new worktree as a folder of its own, cut from the folder it was started in', async () => {
      const worktrees = fake()
      const { service, store, folder } = setup({ 'session.create': { data: { id: 'ses_new' } } }, undefined, worktrees)
      const thread = await service.create({ folderId: folder.id, text: 'Fix the login', agent: 'plan', model, worktree: { base: 'origin/main' } })
      const listed = store.folders().filter((item) => item.worktree)
      expect(listed).toEqual([{
        id: expect.stringMatching(/^fld_/), name: 'app · mde/1a2b3c4d', directory: worktree.root, target: wsl,
        createdAt: expect.any(Number), lastUsedAt: expect.any(Number), worktree,
      }])
      expect(listed[0]!.id).not.toBe(folder.id)
      // The thread itself belongs to the folder it was started in, and the composer stays there.
      expect(thread.folderId).toBe(folder.id)
      expect(store.composer()).toMatchObject({ folderId: folder.id })
      expect(service.folders().folders.map((item) => item.id)).toContain(listed[0]!.id)
      service.stop()
    })

    it('lists no folder when there is no worktree, or when the thread could not be started', async () => {
      const plain = setup({ 'session.create': { data: { id: 'ses_one' } } }, undefined, fake())
      await plain.service.create({ folderId: plain.folder.id, text: 'Hi', agent: 'build', model })
      expect(plain.store.folders()).toHaveLength(1)
      plain.service.stop()

      const failing = setup({ 'session.create': new Error('Service unavailable') }, undefined, fake())
      await expect(failing.service.create({ folderId: failing.folder.id, text: 'Hi', agent: 'build', model, worktree: { base: 'main' } })).rejects.toThrow('Service unavailable')
      expect(failing.store.folders()).toHaveLength(1)
      failing.service.stop()
    })

    const listedTree = { id: 'fld_tree', name: 'app · mde/1a2b3c4d', directory: worktree.root, target: wsl, createdAt: 1, lastUsedAt: 1, worktree }

    it('starts a thread in a worktree folder inside it, with its worktree record and without making another', async () => {
      const worktrees = fake()
      const { service, store, calls } = setup({ 'session.create': { data: { id: 'ses_second' } } }, undefined, worktrees)
      store.putFolder(listedTree)
      const thread = await service.create({ folderId: 'fld_tree', text: 'Second', agent: 'build', model })
      expect(worktrees.create).not.toHaveBeenCalled()
      expect(calls[0]?.request.body).toMatchObject({ location: { directory: worktree.root } })
      expect(thread).toMatchObject({ id: 'ses_second', directory: worktree.root, folderId: 'fld_tree', worktree })
      expect(store.get('ses_second')?.worktree).toEqual(worktree)
      // Using it counts as use, and it is what the composer comes back to.
      expect(store.folder('fld_tree')!.lastUsedAt).toBe(1_000)
      expect(store.composer()).toMatchObject({ folderId: 'fld_tree' })
      expect(store.folders().filter((item) => item.worktree)).toHaveLength(1)
      service.stop()
    })

    it('does not cut a worktree from a worktree folder', async () => {
      const worktrees = fake()
      const { service, store, calls } = setup({}, undefined, worktrees)
      store.putFolder(listedTree)
      await expect(service.create({ folderId: 'fld_tree', text: 'Hi', agent: 'build', model, worktree: { base: 'main' } })).rejects.toThrow('already a worktree')
      expect(worktrees.create).not.toHaveBeenCalled()
      expect(calls).toEqual([])
      service.stop()
    })

    it('drops the folder, its draft and a composer pointing at it when the worktree is removed', async () => {
      const worktrees = fake()
      const { service, store, folder } = setup({ 'session.create': { data: { id: 'ses_new' } } }, undefined, worktrees)
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model, worktree: { base: 'main' } })
      const listed = store.folders().find((item) => item.worktree)!
      service.setComposer({ folderId: listed.id })
      await service.removeThreadWorktree('ses_new')
      expect(store.folder(listed.id)).toBeUndefined()
      expect(store.folder(folder.id)).toBeDefined()
      expect(store.composer().folderId).toBeUndefined()
      service.stop()
    })

    it('keeps the folder when the worktree cannot be removed, and leaves other worktrees alone', async () => {
      const worktrees = fake()
      const { service, store, folder } = setup({ 'session.create': { data: { id: 'ses_new' } } }, undefined, worktrees)
      await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model, worktree: { base: 'main' } })
      store.putFolder({ id: 'fld_other', name: 'app · mde/other', directory: '/home/me/.mde/worktrees/app-abc/other', target: wsl, createdAt: 1, lastUsedAt: 1, worktree: { ...worktree, root: '/home/me/.mde/worktrees/app-abc/other' } })
      worktrees.remove.mockRejectedValueOnce(new Error('Could not remove the worktree: it has changes'))
      await expect(service.removeThreadWorktree('ses_new')).rejects.toThrow('it has changes')
      expect(store.folders().filter((item) => item.worktree)).toHaveLength(2)
      await service.removeThreadWorktree('ses_new')
      expect(store.folders().filter((item) => item.worktree).map((item) => item.id)).toEqual(['fld_other'])
      service.stop()
    })
  })

  it('refuses a worktree request when worktrees are unavailable', async () => {
    const { service, folder, calls } = setup()
    await expect(service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model, worktree: { base: 'main' } })).rejects.toThrow('Git worktrees are unavailable.')
    expect(calls).toEqual([])
  })

  it('reports Git details for a folder, and none when worktrees are unavailable', async () => {
    const worktrees = fake()
    const { service, folder } = setup({}, undefined, worktrees)
    await expect(service.gitInfo({ folderId: folder.id })).resolves.toEqual({ repository: true, branch: 'main', branches: [{ name: 'main', remote: false }] })
    expect(worktrees.info).toHaveBeenCalledWith(expect.objectContaining({ id: folder.id }))
    const bare = setup()
    await expect(bare.service.gitInfo({ folderId: bare.folder.id })).resolves.toEqual({ repository: false, branch: null, branches: [] })
    await expect(service.gitInfo({ folderId: 'fld_gone' })).rejects.toThrow('no longer in the Inbox')
  })

  it('removes a thread’s worktree with the other threads in view, and passes Git’s refusal on', async () => {
    const worktrees = fake()
    const { service, store, folder } = setup({ 'session.create': { data: { id: 'ses_new' } } }, undefined, worktrees)
    await service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model, worktree: { base: 'main' } })
    await service.removeThreadWorktree('ses_new')
    expect(worktrees.remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'ses_new' }), store.list())
    worktrees.remove.mockRejectedValue(new Error('Could not remove the worktree: it has changes'))
    await expect(service.removeThreadWorktree('ses_new')).rejects.toThrow('it has changes')
    await expect(service.removeThreadWorktree('ses_gone')).rejects.toThrow('no longer in the Inbox')
    service.stop()
  })
})
