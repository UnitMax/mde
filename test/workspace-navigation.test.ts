import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getWorkspaceNavigation, saveWorkspaceNavigation, WORKSPACE_NAVIGATION_STORAGE_KEY } from '../src/renderer/lib/workspace-navigation'

describe('workspace navigation preference', () => {
  const storage = new Map<string, string>()
  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('defaults to Sessions until navigation is saved', () => {
    expect(getWorkspaceNavigation()).toEqual({ view: 'sessions', selectedInboxThreadId: null })
    saveWorkspaceNavigation({ view: 'inbox', selectedInboxThreadId: 'ses_one' })
    expect(getWorkspaceNavigation()).toEqual({ view: 'inbox', selectedInboxThreadId: 'ses_one' })
  })

  it.each(['{broken', 'null', '[]', '42', '"inbox"', '{"view":"unknown","selectedInboxThreadId":123}'])(
    'ignores missing or malformed fields in %s', (value) => {
      storage.set(WORKSPACE_NAVIGATION_STORAGE_KEY, value)
      expect(getWorkspaceNavigation()).toEqual({ view: 'sessions', selectedInboxThreadId: null })
    },
  )

  it.each(['../ses_one', 'ses_', '', 'ses_'.concat('a'.repeat(201))])('drops an invalid thread ID (%s) while keeping the tab', (selectedInboxThreadId) => {
    storage.set(WORKSPACE_NAVIGATION_STORAGE_KEY, JSON.stringify({ view: 'inbox', selectedInboxThreadId }))
    expect(getWorkspaceNavigation()).toEqual({ view: 'inbox', selectedInboxThreadId: null })
  })

  it('tolerates unavailable storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('unavailable') },
      setItem: () => { throw new Error('unavailable') },
    })
    expect(getWorkspaceNavigation()).toEqual({ view: 'sessions', selectedInboxThreadId: null })
    expect(() => saveWorkspaceNavigation({ view: 'todo', selectedInboxThreadId: null })).not.toThrow()
  })
})
