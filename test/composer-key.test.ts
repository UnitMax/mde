import { describe, expect, it } from 'vitest'
import { ComposerKey, getComposerKeyAction } from '../src/main/composer-key'

const key = { type: 'keyDown', key: 'F9', code: 'F9', control: false, meta: false, alt: false, shift: false, isAutoRepeat: false }

describe('getComposerKeyAction', () => {
  it('puts the keyboard in the message box on F9 while the Inbox is on screen', () => {
    expect(getComposerKeyAction(key, true)).toBe('focus')
    expect(getComposerKeyAction({ ...key, key: 'Unidentified' }, true)).toBe('focus')
  })

  it('leaves F9 alone outside the Inbox', () => {
    expect(getComposerKeyAction(key, false)).toBeNull()
  })

  it('swallows auto-repeat so a held key never reaches a shell', () => {
    expect(getComposerKeyAction({ ...key, isAutoRepeat: true }, true)).toBe('ignore')
  })

  it.each([
    ['key release', { type: 'keyUp' }],
    ['Ctrl', { control: true }],
    ['Shift', { shift: true }],
    ['Alt', { alt: true }],
    ['Meta', { meta: true }],
    ['F11, which is the terminal', { key: 'F11', code: 'F11' }],
    ['a letter', { key: 'q', code: 'KeyQ' }],
  ])('ignores %s', (_name, change) => {
    expect(getComposerKeyAction({ ...key, ...change }, true)).toBeNull()
  })
})

describe('ComposerKey', () => {
  it('follows what the renderer last said', () => {
    const composer = new ComposerKey()
    expect(composer.action(key)).toBeNull()
    composer.setActive(true)
    expect(composer.action(key)).toBe('focus')
    composer.setActive(false)
    expect(composer.action(key)).toBeNull()
  })
})
