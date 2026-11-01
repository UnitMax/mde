import { describe, expect, it, vi } from 'vitest'
import type {
  InboxThread,
  OpenCodeTuiThreadSnapshot,
  OpenCodeTuiThreadsUpdate,
  Session
} from '../src/shared/types'
import { InboxStore } from '../src/main/inbox/store'
import { InboxRecorder, isInboxThreadUnread } from '../src/main/inbox/recorder'

const session: Session = {
  id: 'session-1', projectId: 'project-1', name: 'App', kind: 'wsl',
  distro: 'Ubuntu-24.04', path: '/home/me/app', createdAt: '2026-01-01T00:00:00Z'
}

function setup(options: { branch?: () => Promise<string | null> } = {}) {
  let now = 1_000
  const store = new InboxStore('/unused', { writeFile: async () => {}, writeDelayMs: 60_000 })
  const changed: InboxThread[] = []
  const readBranch = vi.fn(options.branch ?? (async () => 'main'))
  const recorder = new InboxRecorder(store, {
    now: () => now,
    lookupSession: async (id) => (id === session.id ? session : null),
    readBranch,
    onChanged: (thread) => changed.push(thread)
  })
  const report = (threads: Partial<OpenCodeTuiThreadSnapshot>[], extra: Partial<OpenCodeTuiThreadsUpdate> = {}) =>
    recorder.apply({
      sessionId: session.id,
      terminalId: 'session-1:pane-1',
      target: { kind: 'wsl', distro: 'Ubuntu-24.04' },
      closed: false,
      threads: threads.map((thread) => ({
        id: 'ses_one', directory: '/home/me/app', status: 'working', ...thread
      }) as OpenCodeTuiThreadSnapshot),
      ...extra
    })
  return {
    store, recorder, changed, readBranch, report,
    advance: (ms: number) => { now += ms },
    thread: (id = 'ses_one') => store.get(id)
  }
}

describe('inbox recorder', () => {
  it('does not record a thread that has only been looked at', () => {
    const { report, store } = setup()
    report([{ status: 'idle', title: 'Old work' }])
    expect(store.list()).toEqual([])
  })

  it('records a new thread with its metadata, then fills in the branch', async () => {
    const { report, thread, readBranch } = setup()
    report([{ title: 'Fix login', model: { id: 'model-1', providerId: 'provider-1' } }])
    expect(thread()).toMatchObject({
      id: 'ses_one', title: 'Fix login', directory: '/home/me/app', mdeSessionId: 'session-1',
      target: { kind: 'wsl', distro: 'Ubuntu-24.04' }, model: { id: 'model-1', providerId: 'provider-1' },
      status: 'working', branch: null, createdAt: 1_000, lastActivityAt: 1_000, archived: false
    })
    expect(isInboxThreadUnread(thread()!)).toBe(false)
    await vi.waitFor(() => expect(thread()?.branch).toBe('main'))
    expect(readBranch).toHaveBeenCalledWith(session, '/home/me/app')
  })

  it('moves a thread up and marks it unread only when the agent finishes, fails, or asks', () => {
    const { report, thread, advance, store } = setup()
    report([{ id: 'ses_one' }])
    advance(1_000)
    report([{ id: 'ses_two' }])
    expect(store.list().map((item) => item.id)).toEqual(['ses_two', 'ses_one'])

    advance(1_000)
    report([{ id: 'ses_one', status: 'completed' }])
    expect(store.list().map((item) => item.id)).toEqual(['ses_one', 'ses_two'])
    expect(thread()).toMatchObject({ status: 'completed', lastActivityAt: 3_000 })
    expect(isInboxThreadUnread(thread()!)).toBe(true)

    // Starting work again changes the chip but not the order or the time.
    advance(1_000)
    report([{ id: 'ses_one', status: 'working' }])
    expect(thread()).toMatchObject({ status: 'working', lastActivityAt: 3_000 })

    advance(1_000)
    report([{ id: 'ses_one', status: 'attention', attentionReason: 'question' }])
    expect(thread()).toMatchObject({ status: 'attention', attentionReason: 'question', lastActivityAt: 5_000 })

    advance(1_000)
    report([{ id: 'ses_one', status: 'attention', attentionReason: 'permission' }])
    expect(thread()).toMatchObject({ attentionReason: 'permission', lastActivityAt: 6_000 })

    advance(1_000)
    report([{ id: 'ses_one', status: 'error' }])
    expect(thread()).toMatchObject({ status: 'error', lastActivityAt: 7_000 })
    expect(thread()).not.toHaveProperty('attentionReason')
  })

  it('records a thread first seen finished as unread', () => {
    const { report, thread } = setup()
    report([{ status: 'completed' }])
    expect(isInboxThreadUnread(thread()!)).toBe(true)
  })

  it('brings an archived thread back on new activity and keeps it archived otherwise', () => {
    const { report, recorder, thread, advance } = setup()
    report([{}])
    recorder.setArchived('ses_one', true)
    report([{ title: 'Renamed' }])
    expect(thread()).toMatchObject({ archived: true, title: 'Renamed' })
    advance(10)
    report([{ status: 'completed' }])
    expect(thread()?.archived).toBe(false)
  })

  it('marks read and unread', () => {
    const { report, recorder, thread, advance } = setup()
    report([{ status: 'completed' }])
    advance(5)
    expect(recorder.setRead('ses_one', true)).toMatchObject({ readAt: 1_005 })
    expect(isInboxThreadUnread(thread()!)).toBe(false)
    recorder.setRead('ses_one', false)
    expect(isInboxThreadUnread(thread()!)).toBe(true)
    expect(recorder.setRead('ses_missing', true)).toBeNull()
  })

  it('keeps the title and model when a later report omits them', () => {
    const { report, thread } = setup()
    report([{ title: 'Fix login', model: { id: 'model-1', providerId: 'provider-1' } }])
    report([{ status: 'completed' }])
    expect(thread()).toMatchObject({ title: 'Fix login', model: { id: 'model-1', providerId: 'provider-1' } })
  })

  it('settles working threads when their terminal closes', () => {
    const { report, thread } = setup()
    report([{ id: 'ses_one' }, { id: 'ses_two', status: 'completed' }])
    report([{ id: 'ses_one' }, { id: 'ses_two', status: 'completed' }], { closed: true })
    expect(thread('ses_one')?.status).toBe('idle')
    expect(thread('ses_two')?.status).toBe('completed')
  })

  it('keeps the previous branch when the lookup fails', async () => {
    let fail = false
    const { report, thread, advance } = setup({
      branch: async () => {
        if (fail) throw new Error('git unavailable')
        return 'feature'
      }
    })
    report([{}])
    await vi.waitFor(() => expect(thread()?.branch).toBe('feature'))
    fail = true
    advance(10)
    report([{ status: 'completed' }])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(thread()?.branch).toBe('feature')
  })

  it('forgets a deleted thread until it reports new activity', () => {
    const { report, recorder, store } = setup()
    report([{}])
    recorder.remove('ses_one')
    expect(store.list()).toEqual([])
    report([{ title: 'Back' }])
    expect(store.get('ses_one')?.title).toBe('Back')
  })

  it('reports each change once', () => {
    const { report, changed } = setup()
    report([{}])
    report([{}])
    expect(changed).toHaveLength(1)
  })
})
