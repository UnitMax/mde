import { describe, expect, it } from 'vitest'
import type { InboxGitInfo, InboxThread } from '../src/shared/types'
import {
  countUnreadInboxThreads,
  defaultWorktreeBase,
  inboxFileRoot,
  inboxFolderLabel,
  inboxLocked,
  inboxModelLabel,
  inboxStatusChip,
  inboxThreadHome,
  inboxWorktreeShared,
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
    folderId: 'fld_app',
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

  it('is locked except on macOS and on Windows with WSL', () => {
    const mac = { platform: 'darwin', isWindows: false }
    const windows = { platform: 'win32', isWindows: true }
    expect(inboxLocked(null, false)).toBe(true)
    expect(inboxLocked({ platform: 'linux', isWindows: false }, false)).toBe(true)
    expect(inboxLocked(windows, false)).toBe(true)
    expect(inboxLocked(windows, true)).toBe(false)
    expect(inboxLocked(mac, false)).toBe(false)
  })
})

describe('inbox worktree helpers', () => {
  const worktree = { repository: '/home/me/app', root: '/home/me/.mde/worktrees/app-abc/1a2b3c4d', branch: 'mde/1a2b3c4d', base: 'main' }
  const inWorktree = (overrides: Partial<InboxThread> = {}): InboxThread =>
    thread({ directory: worktree.root, worktree, ...overrides })

  it('labels a worktree thread by the folder it belongs to', () => {
    expect(inboxThreadHome(thread())).toBe('/home/me/app')
    expect(inboxThreadHome(inWorktree())).toBe('/home/me/app')
    expect(inboxFileRoot(thread()).name).toBe('app')
    const root = inboxFileRoot(inWorktree())
    // The file tree opens the worktree's own files, under the folder's name.
    expect(root).toMatchObject({ name: 'app', path: worktree.root })
  })

  it('knows when another thread runs in the same worktree', () => {
    const mine = inWorktree()
    expect(inboxWorktreeShared(mine, [mine])).toBe(false)
    expect(inboxWorktreeShared(mine, [mine, inWorktree({ id: 'ses_fork' })])).toBe(true)
    expect(inboxWorktreeShared(mine, [mine, thread({ id: 'ses_plain' })])).toBe(false)
    expect(inboxWorktreeShared(mine, [mine, inWorktree({ id: 'ses_other', target: { kind: 'wsl', distro: 'Ubuntu' } })])).toBe(false)
    expect(inboxWorktreeShared(thread(), [thread(), inWorktree({ id: 'ses_fork' })])).toBe(false)
  })

  describe('default worktree base', () => {
    const info = (branch: string | null, ...names: string[]): InboxGitInfo => ({
      repository: true,
      branch,
      branches: names.map((name) => ({ name, remote: name.includes('/') && name.startsWith('origin') })),
    })

    it('starts from the current branch when it is a local one', () => {
      expect(defaultWorktreeBase(info('feature', 'main', 'feature'))).toBe('feature')
    })

    it('falls back to main, then master, then the first local branch', () => {
      expect(defaultWorktreeBase(info(null, 'dev', 'main', 'master'))).toBe('main')
      expect(defaultWorktreeBase(info(null, 'dev', 'master'))).toBe('master')
      expect(defaultWorktreeBase(info(null, 'dev', 'topic'))).toBe('dev')
    })

    it('uses a remote-tracking branch only when there is no local one, and none when there is no branch', () => {
      expect(defaultWorktreeBase(info(null, 'origin/main'))).toBe('origin/main')
      expect(defaultWorktreeBase(info('gone', 'origin/main', 'main'))).toBe('main')
      expect(defaultWorktreeBase(info(null))).toBeNull()
    })
  })
})
