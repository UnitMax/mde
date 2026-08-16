import { describe, expect, it } from 'vitest'
import {
  createSessionTerminalLayout,
  getTerminalLayoutShortcut,
  layoutClass,
  layoutForCount,
  panesToTrim,
  paneClass,
  terminalCount
} from '../src/renderer/terminal/layout'

describe('terminal layouts', () => {
  it('maps Ctrl+1 through Ctrl+4 to the supported layouts', () => {
    const input = (key: string, overrides: Partial<{ code: string; control: boolean; meta: boolean; alt: boolean; shift: boolean; type: string }> = {}) => ({
      type: 'keydown',
      key,
      code: `Digit${key}`,
      control: true,
      meta: false,
      alt: false,
      shift: false,
      ...overrides
    })

    expect(getTerminalLayoutShortcut(input('1'))).toBe('single')
    expect(getTerminalLayoutShortcut(input('2'))).toBe('columns')
    expect(getTerminalLayoutShortcut(input('3'))).toBe('three')
    expect(getTerminalLayoutShortcut(input('4'))).toBe('quadrant')
  })

  it('ignores layout shortcuts without plain Ctrl modifier state', () => {
    const input = (overrides: Partial<{ key: string; code: string; control: boolean; meta: boolean; alt: boolean; shift: boolean; type: string }> = {}) => ({
      type: 'keydown',
      key: '1',
      code: 'Digit1',
      control: true,
      meta: false,
      alt: false,
      shift: false,
      ...overrides
    })

    expect(getTerminalLayoutShortcut(input({ control: false }))).toBeNull()
    expect(getTerminalLayoutShortcut(input({ meta: true }))).toBeNull()
    expect(getTerminalLayoutShortcut(input({ alt: true }))).toBeNull()
    expect(getTerminalLayoutShortcut(input({ shift: true }))).toBeNull()
    expect(getTerminalLayoutShortcut(input({ type: 'keyup' }))).toBeNull()
    expect(getTerminalLayoutShortcut(input({ key: '5', code: 'Digit5' }))).toBeNull()
  })

  it('maps each supported layout to its pane count', () => {
    expect(terminalCount('single')).toBe(1)
    expect(terminalCount('columns')).toBe(2)
    expect(terminalCount('three')).toBe(3)
    expect(terminalCount('quadrant')).toBe(4)
    expect(layoutForCount(1)).toBe('single')
    expect(layoutForCount(2)).toBe('columns')
    expect(layoutForCount(3)).toBe('three')
    expect(layoutForCount(4)).toBe('quadrant')
  })

  it('describes the requested grid geometry', () => {
    expect(layoutClass('single')).toContain('grid-cols-1')
    expect(layoutClass('columns')).toContain('grid-rows-1')
    expect(layoutClass('three')).toContain('grid-rows-2')
    expect(paneClass('three', 2)).toBe('col-span-2')
    expect(paneClass('quadrant', 2)).toBe('')
  })

  it('keeps the primary pane and trims newest split panes first', () => {
    const panes = [
      { terminalId: 'primary', primary: true },
      { terminalId: 'split-1', primary: false },
      { terminalId: 'split-2', primary: false },
      { terminalId: 'split-3', primary: false }
    ]

    expect(panesToTrim(panes, 2)).toEqual(['split-3', 'split-2'])
    expect(panesToTrim(panes, 1)).toEqual(['split-3', 'split-2', 'split-1'])
  })

  it('starts every workspace session with one primary pane', () => {
    expect(createSessionTerminalLayout('session-1')).toEqual({
      layout: 'single',
      panes: [{ terminalId: 'session-1', primary: true }]
    })
  })
})
