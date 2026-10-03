import { describe, expect, it } from 'vitest'
import type { OpenCodeSessionSummary } from '../src/shared/types'
import { groupOpenCodeSessions, isOpenCodeSessionsShortcut, sessionAge } from '../src/renderer/lib/opencode-sessions'

const sessions: OpenCodeSessionSummary[] = [
  { id: 'ses_a', title: 'Old frontend', directory: '/workspace/frontend', createdAt: 1, updatedAt: 2 },
  { id: 'ses_b', title: 'Backend fix', directory: '/workspace/backend', createdAt: 1, updatedAt: 4, agent: 'build' },
  { id: 'ses_c', title: 'Frontend fix', directory: '/workspace/frontend', createdAt: 1, updatedAt: 6,
    parentId: 'ses_a', archivedAt: 8, model: { id: 'model-1', providerId: 'provider-1' } }
]

describe('OpenCode history grouping and search', () => {
  it('groups by full directory and orders groups and rows by most recent activity', () => {
    expect(groupOpenCodeSessions(sessions, '').map((group) => [group.directory, group.sessions.map((item) => item.id)]))
      .toEqual([['/workspace/frontend', ['ses_c', 'ses_a']], ['/workspace/backend', ['ses_b']]])
    expect(sessions.map((item) => item.id)).toEqual(['ses_a', 'ses_b', 'ses_c'])
  })

  it('matches case-insensitive title, directory, ID, model, and agent without losing groups', () => {
    const ids = (query: string) => groupOpenCodeSessions(sessions, query).flatMap((group) => group.sessions.map((item) => item.id))
    expect(ids('FRONT')).toEqual(['ses_c', 'ses_a'])
    expect(ids('workspace backend')).toEqual(['ses_b'])
    expect(ids('ses_c')).toEqual(['ses_c'])
    expect(ids('provider model')).toEqual(['ses_c'])
    expect(ids('build')).toEqual(['ses_b'])
    expect(ids('unmatched')).toEqual([])
  })

  it('pins the current directory first while preserving recent-first session order and filtering', () => {
    expect(groupOpenCodeSessions(sessions, '', '/workspace/backend/').map((group) => group.directory))
      .toEqual(['/workspace/backend', '/workspace/frontend'])
    expect(groupOpenCodeSessions(sessions, 'front', '/workspace/backend').map((group) => group.directory))
      .toEqual(['/workspace/frontend'])
    expect(groupOpenCodeSessions(sessions, '', '/workspace/absent').map((group) => group.directory))
      .toEqual(['/workspace/frontend', '/workspace/backend'])
  })

  it('shows compact ages while retaining full dates separately', () => {
    const now = Date.UTC(2026, 0, 1)
    expect(sessionAge(now, now)).toBe('Just now')
    expect(sessionAge(now - 120_000, now)).toBe('2m ago')
    expect(sessionAge(now - 7_200_000, now)).toBe('2h ago')
    expect(sessionAge(now - 172_800_000, now)).toBe('2d ago')
    expect(sessionAge(NaN, now)).toBe('Unknown')
  })

  it('matches only Ctrl+Shift+O keydown outside composition', () => {
    const input = { type: 'keydown', key: 'O', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true }
    expect(isOpenCodeSessionsShortcut(input)).toBe(true)
    for (const change of [{ shiftKey: false }, { ctrlKey: false }, { metaKey: true }, { altKey: true },
      { type: 'keyup' }, { isComposing: true }, { key: 'N' }]) {
      expect(isOpenCodeSessionsShortcut({ ...input, ...change })).toBe(false)
    }
  })
})
