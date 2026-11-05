import { describe, expect, it } from 'vitest'
import type { InboxFolder, InboxThread } from '../src/shared/types'
import { groupThreadsByFolder, miniInboxChips, summarizeThreads } from '../src/renderer/lib/mini-inbox'

const folder: InboxFolder = {
  id: 'fld_app', name: 'Application', directory: '/workspace/app', target: { kind: 'native' }, createdAt: 1, lastUsedAt: 1,
}

function thread(id: string, overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id, title: id, folderId: folder.id, directory: folder.directory, target: folder.target,
    branch: 'main', status: 'idle', createdAt: 1, lastActivityAt: 1, readAt: 1, archived: false,
    ...overrides,
  }
}

describe('mini Inbox helpers', () => {
  it('groups GUI and Terminal threads by their Inbox folder, preserving their order', () => {
    const threads = [thread('ses_one'), thread('ses_other', { folderId: 'fld_other', directory: '/workspace/other' }), thread('ses_terminal', { mode: 'terminal' })]
    const groups = groupThreadsByFolder(threads, [folder])
    expect(groups.map((group) => group.name)).toEqual(['Application', 'other'])
    expect(groups[0]?.threads.map((item) => item.id)).toEqual(['ses_one', 'ses_terminal'])
  })

  it('keeps separate folders separate even when their names and paths match', () => {
    const native = thread('ses_native')
    const wsl = thread('ses_wsl', { folderId: 'fld_wsl', target: { kind: 'wsl', distro: 'TestDistro' } })
    expect(groupThreadsByFolder([native, wsl], [folder, { ...folder, id: 'fld_wsl', target: wsl.target }])).toHaveLength(2)
  })

  it('keeps threads whose folder was removed and labels worktrees by the original repository', () => {
    const worktree = thread('ses_worktree', {
      directory: '/workspace/worktrees/random-id',
      worktree: { repository: '/workspace/app', root: '/workspace/worktrees/random-id', branch: 'feature', base: 'main' },
    })
    expect(groupThreadsByFolder([worktree], [])[0]).toMatchObject({ name: 'app', directory: '/workspace/app', threads: [worktree] })
  })

  it('gives each group its project’s icon, or none, and a worktree group the icon of its project', () => {
    const rocket = { kind: 'emoji', emoji: '🚀' } as const
    const iconed: InboxFolder = { ...folder, icon: rocket }
    const worktreeFolder: InboxFolder = {
      id: 'fld_tree', name: 'Application · feature', directory: '/workspace/worktrees/random-id', target: folder.target, createdAt: 2, lastUsedAt: 2,
      worktree: { repository: folder.directory, root: '/workspace/worktrees/random-id', branch: 'feature', base: 'main' },
    }
    const inWorktree = thread('ses_worktree', {
      folderId: worktreeFolder.id, directory: worktreeFolder.directory, worktree: worktreeFolder.worktree,
    })
    const groups = groupThreadsByFolder([thread('ses_one'), inWorktree], [iconed, worktreeFolder])
    expect(groups.map((group) => [group.name, group.icon])).toEqual([['Application', rocket], ['Application · feature', rocket]])
    // No project icon, no key at all; a folder that is gone has none either.
    expect(groupThreadsByFolder([thread('ses_one')], [folder])[0]).not.toHaveProperty('icon')
    expect(groupThreadsByFolder([thread('ses_one')], [])[0]).not.toHaveProperty('icon')
  })

  it('summarizes thread activity and leaves idle threads out of the chips', () => {
    const summary = summarizeThreads([
      thread('ses_working', { status: 'working' }), thread('ses_attention', { status: 'attention' }),
      thread('ses_done', { status: 'completed' }), thread('ses_error', { status: 'error' }), thread('ses_idle'),
    ])
    expect(miniInboxChips(summary)).toEqual([
      { key: 'attention', label: '1 needs input', tone: 'accent' },
      { key: 'working', label: '1 working', tone: 'accent' },
      { key: 'completed', label: '1 done', tone: 'ok' },
      { key: 'error', label: '1 failed', tone: 'danger' },
    ])
    expect(miniInboxChips(summarizeThreads([thread('ses_idle')]))).toEqual([])
  })
})
