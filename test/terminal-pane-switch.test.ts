import { describe, expect, it } from 'vitest'
import {
  getTerminalPaneSwitchIndex,
  terminalPaneSwitchTarget
} from '../src/renderer/terminal/pane-switch'

const panes = [
  { terminalId: 'pane-1' },
  { terminalId: 'pane-2' }
]

describe('terminal pane switching', () => {
  const input = {
    type: 'keydown',
    key: '!',
    code: 'Digit1',
    control: true,
    meta: false,
    alt: false,
    shift: true
  }

  it('matches Ctrl+Shift with a top-row or numpad digit', () => {
    expect(getTerminalPaneSwitchIndex(input)).toBe(0)
    expect(getTerminalPaneSwitchIndex({ ...input, key: '#', code: 'Digit3' })).toBe(2)
    expect(getTerminalPaneSwitchIndex({ ...input, key: 'End', code: 'Numpad1' })).toBe(0)
    expect(getTerminalPaneSwitchIndex({ ...input, key: '(', code: 'Digit9' })).toBe(8)
  })

  it('ignores other keys and modifier combinations', () => {
    expect(getTerminalPaneSwitchIndex({ ...input, type: 'keyup' })).toBeNull()
    expect(getTerminalPaneSwitchIndex({ ...input, control: false })).toBeNull()
    expect(getTerminalPaneSwitchIndex({ ...input, shift: false, key: '1' })).toBeNull()
    expect(getTerminalPaneSwitchIndex({ ...input, meta: true })).toBeNull()
    expect(getTerminalPaneSwitchIndex({ ...input, alt: true })).toBeNull()
    expect(getTerminalPaneSwitchIndex({ ...input, key: ')', code: 'Digit0' })).toBeNull()
    expect(getTerminalPaneSwitchIndex({ ...input, key: 'F', code: 'KeyF' })).toBeNull()
    expect(getTerminalPaneSwitchIndex({ ...input, key: 'Shift', code: 'ShiftLeft' })).toBeNull()
  })

  it('selects the numbered pane and returns null past the last one', () => {
    expect(terminalPaneSwitchTarget(panes, 0)).toEqual(panes[0])
    expect(terminalPaneSwitchTarget(panes, 1)).toEqual(panes[1])
    expect(terminalPaneSwitchTarget(panes, 2)).toBeNull()
  })
})
