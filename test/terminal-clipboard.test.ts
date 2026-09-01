import { describe, expect, it } from 'vitest'
import {
  createTerminalPrimarySelectionStore,
  decodeOsc52Clipboard,
  OSC52_MAX_BASE64_LENGTH,
  terminalClipboardAction,
  terminalMiddleClickAction,
  terminalPrimarySelectionMode,
  terminalRightClickAction
} from '../src/renderer/terminal/clipboard'

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

describe('terminal mouse clipboard behavior', () => {
  it('selects native or local primary-selection behavior by host and session', () => {
    expect(terminalPrimarySelectionMode('linux', 'native')).toBe('native')
    expect(terminalPrimarySelectionMode('linux', 'wsl')).toBe('native')
    expect(terminalPrimarySelectionMode('win32', 'wsl')).toBe('local')
    expect(terminalPrimarySelectionMode('win32', 'native')).toBe('none')
    expect(terminalPrimarySelectionMode('darwin', 'native')).toBe('none')
  })

  it('copies only selected text on right click outside mouse-tracked TUIs', () => {
    expect(terminalRightClickAction(true, 'none')).toBe('copy')
    expect(terminalRightClickAction(false, 'none')).toBeNull()
    expect(terminalRightClickAction(true, 'vt200')).toBeNull()
  })

  it('pastes local primary selection only in normal WSL terminal mode', () => {
    expect(terminalMiddleClickAction('local', true, 'none')).toBe('local-paste')
    expect(terminalMiddleClickAction('local', false, 'none')).toBeNull()
    expect(terminalMiddleClickAction('native', true, 'none')).toBeNull()
    expect(terminalMiddleClickAction('local', true, 'any')).toBeNull()
  })

  it('shares the latest non-empty local selection and clears it with its owner', () => {
    const store = createTerminalPrimarySelectionStore()
    store.set('pane-1', 'first')
    expect(store.get()).toBe('first')

    store.set('pane-2', 'second')
    expect(store.get()).toBe('second')

    store.set('pane-2', '')
    expect(store.get()).toBe('second')
    store.clear('pane-1')
    expect(store.get()).toBe('second')
    store.clear('pane-2')
    expect(store.get()).toBeNull()
  })
})

describe('OSC 52 clipboard payloads', () => {
  it('decodes UTF-8 text, including non-ASCII characters', () => {
    const payload = Buffer.from('Hello, 你好 🙂', 'utf8').toString('base64')
    expect(decodeOsc52Clipboard(`c;${payload}`)).toEqual({ kind: 'text', text: 'Hello, 你好 🙂' })
  })

  it('ignores queries, other selections, malformed base64, and invalid UTF-8', () => {
    // A query would report the host clipboard back to the program, turning the
    // terminal into a clipboard read channel.
    expect(decodeOsc52Clipboard('c;?')).toEqual({ kind: 'ignored' })
    expect(decodeOsc52Clipboard('p;SGVsbG8=')).toEqual({ kind: 'ignored' })
    expect(decodeOsc52Clipboard('c;not-base64')).toEqual({ kind: 'ignored' })
    expect(decodeOsc52Clipboard('c;//8=')).toEqual({ kind: 'ignored' })
    expect(decodeOsc52Clipboard('no-separator')).toEqual({ kind: 'ignored' })
  })

  it('reports an oversized payload rather than decoding it', () => {
    const atCap = 'A'.repeat(OSC52_MAX_BASE64_LENGTH)
    const overCap = 'A'.repeat(OSC52_MAX_BASE64_LENGTH + 4)

    expect(decodeOsc52Clipboard(`c;${atCap}`).kind).toBe('text')
    expect(decodeOsc52Clipboard(`c;${overCap}`)).toEqual({ kind: 'too-large' })
  })

  it('caps payloads far below the size that could stall the renderer', () => {
    expect(OSC52_MAX_BASE64_LENGTH).toBeLessThanOrEqual(256 * 1024)
  })
})
