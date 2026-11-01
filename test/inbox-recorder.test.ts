import { describe, expect, it, vi } from 'vitest'
import type { InboxThread } from '../src/shared/types'
import { InboxStore } from '../src/main/inbox/store'
import { InboxRecorder, isInboxThreadUnread, serviceEventReport } from '../src/main/inbox/recorder'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseServiceEvent, type ServiceEvent } from '../src/main/opencode/service/events'

function fixtureEvents(name: string): ServiceEvent[] {
  return readFileSync(join(__dirname, 'fixtures/opencode-chat', name), 'utf8')
    .trim().split('\n').map((line) => parseServiceEvent(line)).filter((event): event is ServiceEvent => event !== null)
}

const folder = {
  id: 'fld_app', name: 'app', directory: '/home/me/app',
  target: { kind: 'wsl' as const, distro: 'Ubuntu-24.04' }, createdAt: 1, lastUsedAt: 1
}

const model = { id: 'model-1', providerId: 'provider-1' }

function setup(options: { branch?: () => Promise<string | null> } = {}) {
  let now = 1_000
  const store = new InboxStore('/unused', { writeFile: async () => {}, writeDelayMs: 60_000 })
  const changed: InboxThread[] = []
  const readBranch = vi.fn(options.branch ?? (async () => 'main'))
  const recorder = new InboxRecorder(store, {
    now: () => now,
    readBranch,
    onChanged: (thread) => changed.push(thread)
  })
  const start = (id = 'ses_one', title: string | null = 'Fix login') => recorder.recordChatThread({ id, title, folder, model })
  const emit = (id: string, type: string, data: Record<string, unknown> = {}) =>
    recorder.applyServiceEvent({ type, data: { sessionID: id, ...data } })
  return {
    store, recorder, changed, readBranch, start, emit,
    advance: (ms: number) => { now += ms },
    thread: (id = 'ses_one') => store.get(id)
  }
}

describe('inbox recorder', () => {
  it('moves a thread up and marks it unread only when the agent finishes, fails, or asks', () => {
    const { start, emit, thread, advance, store } = setup()
    start('ses_one')
    advance(1_000)
    start('ses_two')
    expect(store.list().map((item) => item.id)).toEqual(['ses_two', 'ses_one'])

    advance(1_000)
    emit('ses_one', 'session.execution.succeeded')
    expect(store.list().map((item) => item.id)).toEqual(['ses_one', 'ses_two'])
    expect(thread()).toMatchObject({ status: 'completed', lastActivityAt: 3_000 })
    expect(isInboxThreadUnread(thread()!)).toBe(true)

    // Starting work again changes the chip but not the order or the time.
    advance(1_000)
    emit('ses_one', 'session.execution.started')
    expect(thread()).toMatchObject({ status: 'working', lastActivityAt: 3_000 })

    advance(1_000)
    emit('ses_one', 'form.created')
    expect(thread()).toMatchObject({ status: 'attention', attentionReason: 'question', lastActivityAt: 5_000 })

    advance(1_000)
    emit('ses_one', 'permission.asked')
    expect(thread()).toMatchObject({ attentionReason: 'permission', lastActivityAt: 6_000 })

    advance(1_000)
    emit('ses_one', 'session.execution.failed')
    expect(thread()).toMatchObject({ status: 'error', lastActivityAt: 7_000 })
    expect(thread()).not.toHaveProperty('attentionReason')
  })

  it('brings an archived thread back on new activity and keeps it archived otherwise', () => {
    const { start, emit, recorder, thread, advance } = setup()
    start()
    recorder.setArchived('ses_one', true)
    emit('ses_one', 'session.renamed', { title: 'Renamed' })
    expect(thread()).toMatchObject({ archived: true, title: 'Renamed' })
    advance(10)
    emit('ses_one', 'session.execution.succeeded')
    expect(thread()?.archived).toBe(false)
  })

  it('marks read and unread', () => {
    const { start, emit, recorder, thread, advance } = setup()
    start()
    emit('ses_one', 'session.execution.succeeded')
    advance(5)
    expect(recorder.setRead('ses_one', true)).toMatchObject({ readAt: 1_005 })
    expect(isInboxThreadUnread(thread()!)).toBe(false)
    recorder.setRead('ses_one', false)
    expect(isInboxThreadUnread(thread()!)).toBe(true)
    expect(recorder.setRead('ses_missing', true)).toBeNull()
  })

  it('keeps the title and model when a later event omits them', () => {
    const { start, emit, thread } = setup()
    start()
    emit('ses_one', 'session.execution.succeeded')
    expect(thread()).toMatchObject({ title: 'Fix login', model })
  })

  it('keeps the previous branch when the lookup fails', async () => {
    let fail = false
    const { start, emit, thread, advance } = setup({
      branch: async () => {
        if (fail) throw new Error('git unavailable')
        return 'feature'
      }
    })
    start()
    await vi.waitFor(() => expect(thread()?.branch).toBe('feature'))
    fail = true
    advance(10)
    emit('ses_one', 'session.execution.succeeded')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(thread()?.branch).toBe('feature')
  })

  it('forgets a deleted thread for good', () => {
    const { start, emit, recorder, store } = setup()
    start()
    recorder.remove('ses_one')
    expect(store.list()).toEqual([])
    emit('ses_one', 'session.execution.succeeded')
    expect(store.list()).toEqual([])
  })

  it('reports each change once', () => {
    const { start, emit, changed } = setup()
    start()
    emit('ses_one', 'session.execution.started')
    emit('ses_one', 'session.execution.started')
    expect(changed).toHaveLength(1)
  })

  it('records a chat thread as working and read, then follows its service events', async () => {
    const { recorder, thread, advance, readBranch } = setup()
    const events = fixtureEvents('run-tools.jsonl')
    const id = events.find((event) => event.type === 'session.created')!.data.sessionID as string
    const created = recorder.recordChatThread({ id, title: null, folder, model: { id: 'model-1', providerId: 'provider-1' } })
    expect(created).toMatchObject({
      id, title: 'Untitled session', folderId: 'fld_app', status: 'working',
      directory: '/home/me/app', target: { kind: 'wsl', distro: 'Ubuntu-24.04' }
    })
    expect(isInboxThreadUnread(created)).toBe(false)
    // Git runs through a stand-in session for the folder's target.
    await vi.waitFor(() => expect(readBranch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'wsl', distro: 'Ubuntu-24.04', path: '/home/me/app' }), '/home/me/app'))

    advance(1_000)
    for (const event of events) recorder.applyServiceEvent(event)
    expect(thread(id)).toMatchObject({
      title: 'MDE spike', status: 'completed', lastActivityAt: 2_000,
      model: { id: 'deepseek-v4.1-flash-free', providerId: 'opencode' }
    })
    expect(isInboxThreadUnread(thread(id)!)).toBe(true)
  })

  it('shows permission requests and questions as needing input until they are answered', () => {
    const { recorder, thread } = setup()
    const permission = fixtureEvents('permission.jsonl')
    const id = permission.find((event) => event.type === 'permission.asked')!.data.sessionID as string
    recorder.recordChatThread({ id, folder, model: { id: 'm', providerId: 'p' } })
    const until = (events: ServiceEvent[], type: string) => events.slice(0, events.findIndex((event) => event.type === type) + 1)
    for (const event of until(permission, 'permission.asked')) recorder.applyServiceEvent(event)
    expect(thread(id)).toMatchObject({ status: 'attention', attentionReason: 'permission' })
    for (const event of until(permission, 'permission.replied')) recorder.applyServiceEvent(event)
    expect(thread(id)?.status).toBe('working')

    const question = fixtureEvents('question.jsonl')
    const formId = (question.find((event) => event.type === 'form.created')!.data.form as { sessionID: string }).sessionID
    recorder.recordChatThread({ id: formId, folder, model: { id: 'm', providerId: 'p' } })
    for (const event of until(question, 'form.created')) recorder.applyServiceEvent(event)
    expect(thread(formId)).toMatchObject({ status: 'attention', attentionReason: 'question' })
  })

  it('ignores service events for sessions the inbox never recorded', () => {
    const { recorder, store } = setup()
    for (const event of fixtureEvents('run-tools.jsonl')) recorder.applyServiceEvent(event)
    expect(store.list()).toEqual([])
  })

  it('does not resume a thread on a reply it was not waiting for', () => {
    const { recorder, thread } = setup()
    recorder.recordChatThread({ id: 'ses_one', folder, model: { id: 'm', providerId: 'p' } })
    recorder.applyServiceEvent({ type: 'session.execution.succeeded', data: { sessionID: 'ses_one' } })
    recorder.applyServiceEvent({ type: 'permission.replied', data: { sessionID: 'ses_one', requestID: 'per_1' } })
    expect(thread()?.status).toBe('completed')
    recorder.applyServiceEvent({ type: 'session.execution.interrupted', data: { sessionID: 'ses_one' } })
    expect(thread()?.status).toBe('idle')
  })

  it('reads only valid titles and models from events', () => {
    expect(serviceEventReport({ type: 'session.renamed', data: { title: 'bad\u0007' } })).toBeNull()
    expect(serviceEventReport({ type: 'session.renamed', data: { title: ' Fix ' } })).toEqual({ title: 'Fix' })
    expect(serviceEventReport({ type: 'session.step.started', data: { model: { id: 'm' } } })).toBeNull()
    expect(serviceEventReport({ type: 'session.text.delta', data: {} })).toBeNull()
  })
})

