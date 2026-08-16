import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SESSION_COLOR,
  SESSION_COLORS,
  isSessionColor,
  sessionColorHex
} from '../src/shared/session-colors'

describe('session colors', () => {
  it('exposes ten readable predefined colors with the current default', () => {
    expect(SESSION_COLORS).toHaveLength(10)
    expect(DEFAULT_SESSION_COLOR).toBe('default')
    expect(sessionColorHex(DEFAULT_SESSION_COLOR)).toBe('#232c3b')
    expect(new Set(SESSION_COLORS.map((option) => option.hex)).size).toBe(10)
  })

  it('recognizes only predefined color ids', () => {
    expect(isSessionColor('teal')).toBe(true)
    expect(isSessionColor('not-a-color')).toBe(false)
    expect(isSessionColor(undefined)).toBe(false)
  })
})
