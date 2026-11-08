import { describe, expect, it } from 'vitest'
import { FloatingTerminalKey, getFloatingTerminalAction } from '../src/main/floating-terminal-key'

const key = { type: 'keyDown', key: 'F11', code: 'F11', control: false, meta: false, alt: false, shift: false, isAutoRepeat: false }

describe('getFloatingTerminalAction', () => {
  it('toggles on a fresh F11 press while the terminal floats', () => {
    expect(getFloatingTerminalAction(key, true)).toBe('toggle')
    expect(getFloatingTerminalAction({ ...key, key: 'Unidentified' }, true)).toBe('toggle')
  })

  it('leaves F11 alone while there is no floating terminal, so it keeps putting the window in full screen', () => {
    expect(getFloatingTerminalAction(key, false)).toBeNull()
    expect(getFloatingTerminalAction({ ...key, isAutoRepeat: true }, false)).toBeNull()
  })

  it('swallows auto-repeat so a held key neither flickers the window nor reaches the shell', () => {
    expect(getFloatingTerminalAction({ ...key, isAutoRepeat: true }, true)).toBe('ignore')
  })

  it.each([
    ['key release', { type: 'keyUp' }],
    ['Ctrl', { control: true }],
    ['Shift', { shift: true }],
    ['Alt', { alt: true }],
    ['Meta', { meta: true }],
    ['F12, which is the mini window', { key: 'F12', code: 'F12' }],
    ['a letter', { key: 'f', code: 'KeyF' }],
  ])('ignores %s', (_name, change) => {
    expect(getFloatingTerminalAction({ ...key, ...change }, true)).toBeNull()
  })
})

describe('FloatingTerminalKey', () => {
  it('follows what the renderer last said', () => {
    const floating = new FloatingTerminalKey()
    expect(floating.action(key)).toBeNull()
    floating.setActive(true)
    expect(floating.action(key)).toBe('toggle')
    floating.setActive(false)
    expect(floating.action(key)).toBeNull()
  })
})
