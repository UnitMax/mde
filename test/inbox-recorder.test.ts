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

describe('inbox recorder: forked threads', () => {
  it('records a fork as an idle, read thread in the source\'s folder, pointing back at the source', () => {
    const { start, recorder, thread, changed, advance, store } = setup()
    start('ses_one', 'Fix login')
    store.put({ ...thread('ses_one')!, branch: 'feature', archived: true, readAt: 0, status: 'attention', attentionReason: 'question', model: { id: 'old', providerId: 'p' } })
    advance(5_000)
    changed.length = 0
    const created = recorder.recordForkedThread({ id: 'ses_fork', title: 'Fix login (fork #1)', source: thread('ses_one')!, model: { id: 'new', providerId: 'q' } })
    expect(created).toEqual({
      id: 'ses_fork',
      title: 'Fix login (fork #1)',
      directory: folder.directory,
      target: folder.target,
      branch: 'feature',
      model: { id: 'new', providerId: 'q' },
      status: 'idle',
      createdAt: 6_000,
      lastActivityAt: 6_000,
      readAt: 6_000,
      archived: false,
      folderId: folder.id,
      forkedFrom: 'ses_one',
    })
    expect(thread('ses_fork')).toEqual(created)
    expect(changed).toEqual([created])
    expect(isInboxThreadUnread(created)).toBe(false)
    // The original is untouched.
    expect(thread('ses_one')).toMatchObject({ archived: true, readAt: 0, status: 'attention' })
  })

  it('falls back to the source\'s title and model, and records a thread once', () => {
    const { start, recorder, thread, changed } = setup()
    start('ses_one', 'Fix login')
    const created = recorder.recordForkedThread({ id: 'ses_fork', title: '   ', source: thread('ses_one')! })
    expect(created).toMatchObject({ title: 'Fix login', model, forkedFrom: 'ses_one' })
    changed.length = 0
    expect(recorder.recordForkedThread({ id: 'ses_fork', title: 'Other', source: thread('ses_one')! })).toBe(created)
    expect(changed).toEqual([])
  })

  it('works out the fork\'s own branch after recording it', async () => {
    const { start, recorder, thread, readBranch, store } = setup({ branch: async () => 'main' })
    start('ses_one')
    store.put({ ...thread('ses_one')!, branch: null })
    recorder.recordForkedThread({ id: 'ses_fork', source: thread('ses_one')! })
    expect(thread('ses_fork')?.branch).toBeNull()
    await vi.waitFor(() => expect(thread('ses_fork')?.branch).toBe('main'))
    expect(readBranch).toHaveBeenCalled()
  })
})

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

  it('starts a run clock when work starts and keeps it while the agent waits for an answer', () => {
    const { start, emit, thread, advance, recorder } = setup()
    start('ses_one')
    expect(thread()).toMatchObject({ status: 'working', workingSince: 1_000 })

    // Being told it is working again does not restart the clock.
    advance(5_000)
    emit('ses_one', 'session.execution.started')
    expect(thread()?.workingSince).toBe(1_000)
    recorder.markStatus('ses_one', 'working')
    expect(thread()?.workingSince).toBe(1_000)

    // Asking and being answered is still the same run.
    advance(1_000)
    emit('ses_one', 'permission.asked')
    expect(thread()).toMatchObject({ status: 'attention', workingSince: 1_000 })
    advance(1_000)
    emit('ses_one', 'permission.replied')
    expect(thread()).toMatchObject({ status: 'working', workingSince: 1_000 })

    // Stopping ends it, however it stops, and the next run starts a new clock.
    let clock = 1_000 + 5_000 + 1_000 + 1_000
    for (const [type, status] of [
      ['session.execution.succeeded', 'completed'],
      ['session.execution.failed', 'error'],
      ['session.execution.interrupted', 'idle']
    ] as const) {
      advance(1_000)
      clock += 1_000
      emit('ses_one', type)
      expect(thread()).toMatchObject({ status })
      expect(thread()).not.toHaveProperty('workingSince')
      advance(1_000)
      clock += 1_000
      emit('ses_one', 'session.execution.started')
      expect(thread()).toMatchObject({ status: 'working', workingSince: clock })
    }
  })

  it('starts the clock when a thread that needed an answer first goes to work, and tells the app', () => {
    const { start, emit, thread, advance, changed } = setup()
    start('ses_one')
    emit('ses_one', 'session.execution.succeeded')
    advance(1_000)
    emit('ses_one', 'form.created')
    // Waiting for an answer counts as part of a run, even one first seen that way.
    expect(thread()).toMatchObject({ status: 'attention', workingSince: 2_000 })
    advance(3_000)
    changed.length = 0
    emit('ses_one', 'form.replied')
    expect(thread()).toMatchObject({ status: 'working', workingSince: 2_000 })
    expect(changed).toHaveLength(1)
    expect(changed[0]).toMatchObject({ status: 'working', workingSince: 2_000 })
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

