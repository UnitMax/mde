import { describe, expect, it } from 'vitest'
import {
  createSessionTerminalLayout,
  layoutClass,
  layoutForCount,
  panesToTrim,
  paneClass,
  terminalCount
} from '../src/renderer/terminal/layout'

describe('terminal layouts', () => {
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
