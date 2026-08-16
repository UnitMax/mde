import { describe, expect, it } from 'vitest'
import type { Project, Session } from '../src/shared/types'
import {
  isSessionSwitcherShortcut,
  searchSessions,
  type SessionSearchItem
} from '../src/renderer/lib/session-switcher'

const project: Project = {
  id: 'project-1',
  name: 'Workspace',
  createdAt: '2026-01-01T00:00:00.000Z'
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    projectId: project.id,
    name: 'Frontend',
    mode: 'terminal',
    kind: 'native',
    path: '/workspace/frontend',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function item(value: Session, order: number): SessionSearchItem {
  return { session: value, project, order }
}

describe('session search', () => {
  it('matches session names as case-insensitive subsequences', () => {
    const results = searchSessions([item(session(), 0)], 'fed')

    expect(results.map((result) => result.item.session.id)).toEqual(['session-1'])
    expect(results[0]?.matches.name).toEqual([0, 5, 7])
  })

  it('matches across project, path, distro, and mode fields', () => {
    const results = searchSessions(
      [
        item(session({ id: 'wsl-session', name: 'Agent', kind: 'wsl', distro: 'Ubuntu-24.04' }), 0),
        item(session({ id: 'gui-session', name: 'Design', mode: 'gui' }), 1)
      ],
      'ubuntu'
    )
    expect(searchSessions([item(session(), 0)], 'worksp')[0]?.item.session.id).toBe('session-1')
    expect(searchSessions([item(session(), 0)], 'frontend')[0]?.item.session.id).toBe('session-1')
    expect(results[0]?.item.session.id).toBe('wsl-session')

    expect(searchSessions([item(session({ id: 'gui-session', mode: 'gui' }), 0)], 'gui')[0]?.item.session.id).toBe(
      'gui-session'
    )
  })

  it('ranks stronger fuzzy matches first and preserves input order for ties', () => {
    const results = searchSessions(
      [
        item(session({ id: 'later', name: 'Backend' }), 1),
        item(session({ id: 'first', name: 'Front' }), 0)
      ],
      'fr'
    )

    expect(results.map((result) => result.item.session.id)).toEqual(['first', 'later'])
    expect(searchSessions([item(session({ id: 'a', name: 'Same' }), 0), item(session({ id: 'b', name: 'Same' }), 1)], 'same').map((result) => result.item.session.id)).toEqual(['a', 'b'])
  })

  it('returns all sessions for an empty query and none for an unmatched query', () => {
    const items = [item(session({ id: 'a' }), 0), item(session({ id: 'b' }), 1)]

    expect(searchSessions(items, '').map((result) => result.item.session.id)).toEqual(['a', 'b'])
    expect(searchSessions(items, 'does-not-exist')).toEqual([])
  })
})

describe('session switcher shortcut', () => {
  const base = {
    key: 'o',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    type: 'keydown'
  }

  it('accepts Ctrl+O and Cmd+O', () => {
    expect(isSessionSwitcherShortcut({ ...base, ctrlKey: true })).toBe(true)
    expect(isSessionSwitcherShortcut({ ...base, metaKey: true })).toBe(true)
  })

  it('rejects unrelated keys, extra modifiers, and non-keydown events', () => {
    expect(isSessionSwitcherShortcut({ ...base, key: 'p', ctrlKey: true })).toBe(false)
    expect(isSessionSwitcherShortcut({ ...base, ctrlKey: true, shiftKey: true })).toBe(false)
    expect(isSessionSwitcherShortcut({ ...base, ctrlKey: true, altKey: true })).toBe(false)
    expect(isSessionSwitcherShortcut({ ...base, ctrlKey: true, type: 'keyup' })).toBe(false)
    expect(isSessionSwitcherShortcut({ ...base, ctrlKey: true, isComposing: true })).toBe(false)
  })
})
