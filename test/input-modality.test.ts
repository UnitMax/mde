// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { lastInputWasKeyboard, quietCloseFocus } from '../src/renderer/lib/input-modality'

const closeEvent = (): Event => new Event('focusout', { cancelable: true })

describe('input modality', () => {
  it('follows the last thing the user did, a key or a pointer press', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    expect(lastInputWasKeyboard()).toBe(true)
    window.dispatchEvent(new Event('pointerdown'))
    expect(lastInputWasKeyboard()).toBe(false)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(lastInputWasKeyboard()).toBe(true)
  })

  it('keeps the focus where it is after a menu was closed with the pointer, and hands it back after a key', () => {
    window.dispatchEvent(new Event('pointerdown'))
    const pointer = closeEvent()
    quietCloseFocus(pointer)
    expect(pointer.defaultPrevented).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    const key = closeEvent()
    quietCloseFocus(key)
    expect(key.defaultPrevented).toBe(false)
  })
})
