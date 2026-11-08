import { describe, expect, it } from 'vitest'
import type { InboxFolder, InboxThread } from '../src/shared/types'
import { miniInboxChips, miniInboxProject, summarizeThreads } from '../src/renderer/lib/mini-inbox'

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
  it('names the project of GUI and Terminal threads by their Inbox folder, with its path', () => {
    expect(miniInboxProject(thread('ses_one'), [folder])).toEqual({ name: 'Application', directory: '/workspace/app' })
    expect(miniInboxProject(thread('ses_terminal', { mode: 'terminal' }), [folder]).name).toBe('Application')
    expect(miniInboxProject(thread('ses_other', { folderId: 'fld_other', directory: '/workspace/other' }), [folder]))
      .toEqual({ name: 'other', directory: '/workspace/other' })
  })

  it('keeps folders apart that share a name and path, by the folder the thread belongs to', () => {
    const wsl = thread('ses_wsl', { folderId: 'fld_wsl', target: { kind: 'wsl', distro: 'TestDistro' } })
    const named = { ...folder, id: 'fld_wsl', name: 'Application (WSL)', target: wsl.target }
    expect(miniInboxProject(wsl, [folder, named]).name).toBe('Application (WSL)')
    expect(miniInboxProject(thread('ses_native'), [folder, named]).name).toBe('Application')
  })

  it('keeps threads whose folder was removed and labels worktrees by the original repository', () => {
    const worktree = thread('ses_worktree', {
      directory: '/workspace/worktrees/random-id',
      worktree: { repository: '/workspace/app', root: '/workspace/worktrees/random-id', branch: 'feature', base: 'main' },
    })
    expect(miniInboxProject(worktree, [])).toMatchObject({ name: 'app', directory: '/workspace/app' })
  })

  it('gives the project its icon, or none, and a worktree the icon of its project', () => {
    const rocket = { kind: 'emoji', emoji: '🚀' } as const
    const iconed: InboxFolder = { ...folder, icon: rocket }
    const worktreeFolder: InboxFolder = {
      id: 'fld_tree', name: 'Application · feature', directory: '/workspace/worktrees/random-id', target: folder.target, createdAt: 2, lastUsedAt: 2,
      worktree: { repository: folder.directory, root: '/workspace/worktrees/random-id', branch: 'feature', base: 'main' },
    }
    const inWorktree = thread('ses_worktree', {
      folderId: worktreeFolder.id, directory: worktreeFolder.directory, worktree: worktreeFolder.worktree,
    })
    expect([thread('ses_one'), inWorktree].map((item) => { const project = miniInboxProject(item, [iconed, worktreeFolder]); return [project.name, project.icon] }))
      .toEqual([['Application', rocket], ['Application · feature', rocket]])
    // No project icon, no key at all; a folder that is gone has none either.
    expect(miniInboxProject(thread('ses_one'), [folder])).not.toHaveProperty('icon')
    expect(miniInboxProject(thread('ses_one'), [])).not.toHaveProperty('icon')
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
