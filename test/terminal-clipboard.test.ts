import { describe, expect, it } from 'vitest'
import { decodeOsc52Clipboard, terminalClipboardAction } from '../src/renderer/terminal/clipboard'

const key = (overrides: Partial<Parameters<typeof terminalClipboardAction>[0]> = {}) => ({
  key: '',
  code: '',
  control: false,
  meta: false,
  alt: false,
  shift: false,
  ...overrides
})

describe('terminal clipboard shortcuts', () => {
  it('copies selected text with Ctrl+C and Ctrl+Shift+C', () => {
    expect(terminalClipboardAction(key({ key: 'c', code: 'KeyC', control: true }), true, false)).toBe('copy')
    expect(terminalClipboardAction(key({ key: 'C', code: 'KeyC', control: true, shift: true }), true, false)).toBe('copy')
  })

  it('leaves Ctrl+C without a selection available for terminal interrupts', () => {
    expect(terminalClipboardAction(key({ key: 'c', code: 'KeyC', control: true }), false, false)).toBeNull()
  })

  it('supports paste shortcuts and Insert variants', () => {
    expect(terminalClipboardAction(key({ key: 'v', code: 'KeyV', control: true }), false, false)).toBe('native-paste')
    expect(terminalClipboardAction(key({ key: 'v', code: 'KeyV', control: true, shift: true }), false, false)).toBe('native-paste')
    expect(terminalClipboardAction(key({ key: 'Insert', code: 'Insert', control: true }), true, false)).toBe('copy')
    expect(terminalClipboardAction(key({ key: 'Insert', code: 'Insert', shift: true }), false, false)).toBe('native-paste')
  })

  it('uses Command shortcuts on macOS and ignores Alt combinations', () => {
    expect(terminalClipboardAction(key({ key: 'c', code: 'KeyC', meta: true }), true, true)).toBe('copy')
    expect(terminalClipboardAction(key({ key: 'v', code: 'KeyV', meta: true }), false, true)).toBe('native-paste')
    expect(terminalClipboardAction(key({ key: 'c', code: 'KeyC', control: true, alt: true }), true, false)).toBeNull()
  })
})

describe('OSC 52 clipboard payloads', () => {
  it('decodes UTF-8 text, including non-ASCII characters', () => {
    const payload = Buffer.from('Hello, 你好 🙂', 'utf8').toString('base64')
    expect(decodeOsc52Clipboard(`c;${payload}`)).toBe('Hello, 你好 🙂')
  })

  it('rejects queries, other selections, malformed base64, and invalid UTF-8', () => {
    expect(decodeOsc52Clipboard('c;?')).toBeNull()
    expect(decodeOsc52Clipboard('p;SGVsbG8=')).toBeNull()
    expect(decodeOsc52Clipboard('c;not-base64')).toBeNull()
    expect(decodeOsc52Clipboard('c;//8=')).toBeNull()
  })
})
