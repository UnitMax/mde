import { describe, expect, it } from 'vitest'
import { isSessionIcon, SESSION_ICONS, sessionIconOption } from '../src/shared/session-icons'

describe('session icons', () => {
  it('provides ten unique predefined icons', () => {
    expect(SESSION_ICONS).toHaveLength(10)
    expect(new Set(SESSION_ICONS.map((option) => option.id)).size).toBe(10)
    expect(new Set(SESSION_ICONS.map((option) => option.emoji)).size).toBe(10)
  })

  it('validates icon ids and resolves their display options', () => {
    expect(isSessionIcon('robot')).toBe(true)
    expect(isSessionIcon('not-an-icon')).toBe(false)
    expect(isSessionIcon(undefined)).toBe(false)
    expect(sessionIconOption('robot')).toEqual({ id: 'robot', label: 'Robot', emoji: '🤖' })
    expect(sessionIconOption(undefined)).toBeUndefined()
  })
})
