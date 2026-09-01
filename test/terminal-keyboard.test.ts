import { describe, expect, it } from 'vitest'
import { terminalKeyboardAction } from '../src/renderer/terminal/keyboard'

const key = (overrides: Partial<Parameters<typeof terminalKeyboardAction>[0]> = {}) => ({
  type: 'keydown',
  key: 'Enter',
  code: 'Enter',
  control: true,
  meta: false,
  alt: false,
  shift: false,
  ...overrides
})

describe('terminal keyboard compatibility', () => {
  it('maps Ctrl+Enter to a newline in alternate-screen TUIs', () => {
    expect(terminalKeyboardAction(key(), true)).toBe('\n')
    expect(terminalKeyboardAction(key({ key: 'Enter', code: 'NumpadEnter' }), true)).toBe('\n')
  })

  it('leaves normal-screen terminals and unrelated keys unchanged', () => {
    expect(terminalKeyboardAction(key(), false)).toBeNull()
    expect(terminalKeyboardAction(key({ key: 'a', code: 'KeyA' }), true)).toBeNull()
  })

  it('requires an exact Ctrl+Enter keydown', () => {
    for (const overrides of [
      { type: 'keyup' },
      { type: 'keypress' },
      { shift: true },
      { alt: true },
      { meta: true },
      { control: false }
    ]) {
      expect(terminalKeyboardAction(key(overrides), true)).toBeNull()
    }
  })
})
