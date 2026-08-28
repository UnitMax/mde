import { describe, expect, it } from 'vitest'
import {
  isTerminalFullscreenShortcut,
  shouldExitTerminalFullscreen,
  terminalFullscreenPane
} from '../src/renderer/terminal/fullscreen'

const panes = [
  { terminalId: 'pane-1' },
  { terminalId: 'pane-2' }
]

describe('terminal fullscreen behavior', () => {
  it('matches only Ctrl+Shift+F', () => {
    const input = {
      type: 'keydown',
      key: 'f',
      code: 'KeyF',
      control: true,
      meta: false,
      alt: false,
      shift: true
    }

    expect(isTerminalFullscreenShortcut(input)).toBe(true)
    expect(isTerminalFullscreenShortcut({ ...input, key: 'F' })).toBe(true)
    expect(isTerminalFullscreenShortcut({ ...input, type: 'keyup' })).toBe(false)
    expect(isTerminalFullscreenShortcut({ ...input, control: false })).toBe(false)
    expect(isTerminalFullscreenShortcut({ ...input, shift: false })).toBe(false)
    expect(isTerminalFullscreenShortcut({ ...input, meta: true })).toBe(false)
    expect(isTerminalFullscreenShortcut({ ...input, alt: true })).toBe(false)
    expect(isTerminalFullscreenShortcut({ ...input, key: 'g', code: 'KeyG' })).toBe(false)
  })

  it('selects the requested pane and safely falls back when it is gone', () => {
    expect(terminalFullscreenPane(panes, 'pane-2')).toEqual(panes[1])
    expect(terminalFullscreenPane(panes, 'missing')).toBeNull()
    expect(terminalFullscreenPane(panes, null)).toBeNull()
  })

  it('exits fullscreen for Escape when enabled outside dialogs', () => {
    expect(shouldExitTerminalFullscreen({
      key: 'Escape',
      escapeExitsFullscreen: true,
      fullscreenTerminalId: 'split-1',
      inDialog: false
    })).toBe(true)
  })

  it('does not intercept disabled, unrelated, or dialog Escape events', () => {
    const input = {
      key: 'Escape',
      escapeExitsFullscreen: true,
      fullscreenTerminalId: 'split-1',
      inDialog: false
    }

    expect(shouldExitTerminalFullscreen({ ...input, escapeExitsFullscreen: false })).toBe(false)
    expect(shouldExitTerminalFullscreen({ ...input, key: 'Enter' })).toBe(false)
    expect(shouldExitTerminalFullscreen({ ...input, fullscreenTerminalId: null })).toBe(false)
    expect(shouldExitTerminalFullscreen({ ...input, inDialog: true })).toBe(false)
  })
})
