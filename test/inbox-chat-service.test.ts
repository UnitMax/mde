import { describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '../src/shared/types'
import { InboxChatService } from '../src/main/inbox/chat'
import { InboxRecorder } from '../src/main/inbox/recorder'
import { InboxStore } from '../src/main/inbox/store'
import type { ServiceOperation, ServiceRequest } from '../src/main/opencode/service/client'

const wsl = { kind: 'wsl' as const, distro: 'Ubuntu-24.04' }
const model = { id: 'model-1', providerId: 'provider-1' }

function setup(responses: Partial<Record<ServiceOperation, unknown>> = {}) {
  let now = 1_000
  let enabled = true
  const store = new InboxStore('/unused', { writeFile: async () => {}, writeDelayMs: 60_000 })
  const recorder = new InboxRecorder(store, {
    now: () => now,
    lookupSession: async () => null,
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
    client: { request, openEvents, reset: vi.fn() },
    store,
    recorder,
    send: (event) => events.push(event),
    enabled: () => enabled,
    now: () => now,
    createId: () => 'abc',
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
    })
    expect(calls[0]?.request.query).toEqual({ 'location[directory]': '/home/me/app' })
    await service.chatOptions({ folderId: folder.id })
    expect(calls).toHaveLength(4)
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

  it('creates a session in the folder, records it, and sends the first message', async () => {
    const { service, store, folder, calls, openEvents } = setup({ 'session.create': { data: { id: 'ses_new', title: 'New session' } } })
    const thread = await service.create({ folderId: folder.id, text: 'Fix the login', agent: 'plan', model })
    expect(calls.map((call) => call.operation)).toEqual(['session.create', 'session.prompt'])
    expect(calls[0]?.request.body).toEqual({
      agent: 'plan', model: { id: 'model-1', providerID: 'provider-1' }, location: { directory: '/home/me/app' },
    })
    expect(calls[1]?.request).toEqual({ params: { sessionID: 'ses_new' }, body: { text: 'Fix the login' } })
    expect(thread).toMatchObject({ id: 'ses_new', title: 'New session', origin: 'chat', folderId: 'fld_abc', status: 'working' })
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

  it('refuses to start threads while the Inbox is locked or with an empty message', async () => {
    const { service, folder, disable } = setup()
    await expect(service.create({ folderId: folder.id, text: '   ', agent: 'build', model })).rejects.toThrow('Type a message first.')
    disable()
    await expect(service.create({ folderId: folder.id, text: 'Hi', agent: 'build', model })).rejects.toThrow('status reporting')
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
    expect(calls[0]?.request.query).toEqual({ limit: '50', order: 'desc' })
    await service.messages({ threadId: 'ses_new', cursor: 'older-1' })
    expect(calls[2]?.request.query).toEqual({ limit: '50', cursor: 'older-1' })
    service.stop()
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
