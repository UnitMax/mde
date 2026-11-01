import { describe, expect, it } from 'vitest'
import type { InboxThread } from '../src/shared/types'
import {
  countUnreadInboxThreads,
  inboxFolderLabel,
  inboxLockReason,
  inboxModelLabel,
  inboxStatusChip,
  visibleInboxThreads
} from '../src/renderer/lib/inbox'

function thread(overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id: 'ses_one',
    title: 'Fix login',
    directory: '/home/me/app',
    target: { kind: 'native' },
    branch: 'main',
    status: 'completed',
    createdAt: 1,
    lastActivityAt: 10,
    readAt: 0,
    archived: false,
    ...overrides
  }
}

describe('inbox list helpers', () => {
  const threads = [
    thread({ id: 'ses_read', title: 'Read work', readAt: 20, lastActivityAt: 15 }),
    thread({ id: 'ses_unread', title: 'Unread work', lastActivityAt: 30, branch: 'feature/login' }),
    thread({ id: 'ses_question', title: 'Question', status: 'attention', attentionReason: 'question', lastActivityAt: 20,
      model: { id: 'claude-sonnet', providerId: 'anthropic' } }),
    thread({ id: 'ses_archived', title: 'Archived', archived: true, lastActivityAt: 40 })
  ]

  it('filters by mailbox and sorts newest first', () => {
    const ids = (filter: Parameters<typeof visibleInboxThreads>[1]) =>
      visibleInboxThreads(threads, filter, '').map((item) => item.id)
    expect(ids('all')).toEqual(['ses_unread', 'ses_question', 'ses_read'])
    expect(ids('unread')).toEqual(['ses_unread', 'ses_question'])
    expect(ids('attention')).toEqual(['ses_question'])
    expect(ids('archived')).toEqual(['ses_archived'])
  })

  it('searches title, folder, branch and model', () => {
    const ids = (query: string) => visibleInboxThreads(threads, 'all', query).map((item) => item.id)
    expect(ids('feature')).toEqual(['ses_unread'])
    expect(ids('anthropic')).toEqual(['ses_question'])
    expect(ids('read work')).toEqual(['ses_unread', 'ses_read'])
    expect(ids('nothing-matches')).toEqual([])
  })

  it('counts unread threads outside the archive', () => {
    expect(countUnreadInboxThreads(threads)).toBe(2)
  })

  it('labels folders, models and statuses', () => {
    expect(inboxFolderLabel('/home/me/app/')).toBe('app')
    expect(inboxFolderLabel('C:\\src\\app')).toBe('app')
    expect(inboxFolderLabel('/')).toBe('/')
    expect(inboxModelLabel(undefined)).toBeNull()
    expect(inboxModelLabel({ id: 'gpt-x', providerId: 'openai', variant: 'high' })).toBe('gpt-x (high)')
    expect(inboxStatusChip(thread({ status: 'attention', attentionReason: 'permission' }))?.label).toBe('Needs permission')
    expect(inboxStatusChip(thread({ status: 'attention', attentionReason: 'question' }))?.label).toBe('Needs input')
    expect(inboxStatusChip(thread({ status: 'completed' }))).toEqual({ label: 'Done', tone: 'ok' })
    expect(inboxStatusChip(thread({ status: 'error' }))?.label).toBe('Failed')
    expect(inboxStatusChip(thread({ status: 'working' }))?.label).toBe('Working')
    expect(inboxStatusChip(thread({ status: 'idle' }))).toBeNull()
  })

  it('locks the inbox until status reporting is available and on', () => {
    const mac = { platform: 'darwin', isWindows: false }
    const windows = { platform: 'win32', isWindows: true }
    expect(inboxLockReason(null, false, true)).toBe('unsupported')
    expect(inboxLockReason({ platform: 'linux', isWindows: false }, false, true)).toBe('unsupported')
    expect(inboxLockReason(windows, false, true)).toBe('unsupported')
    expect(inboxLockReason(windows, true, false)).toBe('disabled')
    expect(inboxLockReason(windows, true, true)).toBeNull()
    expect(inboxLockReason(mac, false, false)).toBe('disabled')
    expect(inboxLockReason(mac, false, true)).toBeNull()
  })
})
