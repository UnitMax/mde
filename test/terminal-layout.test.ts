import { describe, expect, it } from 'vitest'
import {
  createSessionTerminalLayout,
  defaultTerminalLayoutSizes,
  getTerminalLayoutShortcut,
  layoutClass,
  layoutForCount,
  orderTerminalPanes,
  panesToTrim,
  paneClass,
  swapTerminalPanes,
  terminalCount,
  terminalColumnRatios,
  terminalColumnSplitRatio,
  terminalGridTemplates,
  terminalResizeHandles,
  terminalSplitRatio
} from '../src/renderer/terminal/layout'

describe('terminal layouts', () => {
  it('maps Ctrl+1 through Ctrl+6 to the supported layouts', () => {
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
    expect(getTerminalLayoutShortcut(input('5'))).toBe('threeColumns')
    expect(getTerminalLayoutShortcut(input('6'))).toBe('sixGrid')
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
    expect(getTerminalLayoutShortcut(input({ key: '7', code: 'Digit7' }))).toBeNull()
  })

  it('maps each supported layout to its pane count', () => {
    expect(terminalCount('single')).toBe(1)
    expect(terminalCount('columns')).toBe(2)
    expect(terminalCount('three')).toBe(3)
    expect(terminalCount('quadrant')).toBe(4)
    expect(terminalCount('threeColumns')).toBe(3)
    expect(terminalCount('sixGrid')).toBe(6)
    expect(layoutForCount(1)).toBe('single')
    expect(layoutForCount(2)).toBe('columns')
    expect(layoutForCount(3)).toBe('three')
    expect(layoutForCount(4)).toBe('quadrant')
    expect(layoutForCount(6)).toBe('sixGrid')
  })

  it('describes the requested grid geometry', () => {
    expect(layoutClass('single')).toContain('grid-cols-1')
    expect(layoutClass('columns')).toContain('grid-rows-1')
    expect(layoutClass('three')).toContain('grid-rows-2')
    expect(layoutClass('threeColumns')).toEqual('grid-cols-3 grid-rows-1')
    expect(layoutClass('sixGrid')).toEqual('grid-cols-3 grid-rows-2')
    expect(paneClass('three', 2)).toBe('col-span-2')
    expect(paneClass('quadrant', 2)).toBe('')
    expect(paneClass('sixGrid', 2)).toBe('')
  })

  it('defines shared resize tracks for each multi-pane layout', () => {
    expect(terminalResizeHandles('single')).toEqual([])
    expect(terminalResizeHandles('columns')).toEqual([{ axis: 'column', scope: 'full', columnIndex: 0 }])
    expect(terminalResizeHandles('three')).toEqual([
      { axis: 'column', scope: 'top', columnIndex: 0 },
      { axis: 'row', scope: 'full' }
    ])
    expect(terminalResizeHandles('quadrant')).toEqual([
      { axis: 'column', scope: 'full', columnIndex: 0 },
      { axis: 'row', scope: 'full' }
    ])
    expect(terminalResizeHandles('threeColumns')).toEqual([
      { axis: 'column', scope: 'full', columnIndex: 0 },
      { axis: 'column', scope: 'full', columnIndex: 1 }
    ])
    expect(terminalResizeHandles('sixGrid')).toEqual([
      { axis: 'column', scope: 'full', columnIndex: 0 },
      { axis: 'column', scope: 'full', columnIndex: 1 },
      { axis: 'row', scope: 'full' }
    ])
  })

  it('builds grid tracks from the first column and row ratios', () => {
    expect(terminalGridTemplates('single', { columnRatio: 0.25, rowRatio: 0.75 })).toEqual({
      columns: 'minmax(0, 1fr)',
      rows: 'minmax(0, 1fr)'
    })
    expect(terminalGridTemplates('quadrant', { columnRatio: 0.25, rowRatio: 0.75 })).toEqual({
      columns: 'minmax(0, 0.25fr) minmax(0, 0.75fr)',
      rows: 'minmax(0, 0.75fr) minmax(0, 0.25fr)'
    })
    expect(terminalGridTemplates('threeColumns', {
      columnRatio: 0.25,
      secondColumnRatio: 0.6,
      rowRatio: 0.75
    })).toEqual({
      columns: 'minmax(0, 0.25fr) minmax(0, 0.35fr) minmax(0, 0.4fr)',
      rows: 'minmax(0, 1fr)'
    })
    expect(terminalGridTemplates('sixGrid', {
      columnRatio: 1 / 3,
      secondColumnRatio: 2 / 3,
      rowRatio: 0.75
    })).toEqual({
      columns: 'minmax(0, 0.3333333333333333fr) minmax(0, 0.3333333333333333fr) minmax(0, 0.33333333333333337fr)',
      rows: 'minmax(0, 0.75fr) minmax(0, 0.25fr)'
    })
  })

  it('normalizes invalid three-column ratios and constrains both dividers', () => {
    expect(terminalColumnRatios({ columnRatio: 0.8, secondColumnRatio: 0.2, rowRatio: 0.5 })).toEqual([
      1 / 3,
      2 / 3
    ])
    expect(terminalColumnSplitRatio(0, 1000, 0, { columnRatio: 1 / 3, secondColumnRatio: 2 / 3, rowRatio: 0.5 })).toBeCloseTo(120 / 998)
    expect(terminalColumnSplitRatio(1000, 1000, 1, { columnRatio: 1 / 3, secondColumnRatio: 2 / 3, rowRatio: 0.5 })).toBeCloseTo(878 / 998)
    expect(terminalColumnSplitRatio(0, 100, 0, { columnRatio: 1 / 3, secondColumnRatio: 2 / 3, rowRatio: 0.5 })).toBeCloseTo(1 / 3)
  })

  it('clamps a dragged split so both tracks remain usable', () => {
    expect(terminalSplitRatio(500, 1000)).toBeCloseTo(0.5)
    expect(terminalSplitRatio(0, 1000)).toBeCloseTo(120 / 999)
    expect(terminalSplitRatio(1000, 1000)).toBeCloseTo(879 / 999)
    expect(terminalSplitRatio(0, 100)).toBe(0.5)
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
    expect(panesToTrim(panes, 2, 'split-1')).toEqual(['split-1', 'split-3'])

    const sixPanes = [
      { terminalId: 'primary', primary: true },
      { terminalId: 'split-1', primary: false },
      { terminalId: 'split-2', primary: false },
      { terminalId: 'split-3', primary: false },
      { terminalId: 'split-4', primary: false },
      { terminalId: 'split-5', primary: false }
    ]
    expect(panesToTrim(sixPanes, 4, 'split-2')).toEqual(['split-2', 'split-5'])
  })

  it('swaps pane positions while preserving pane metadata', () => {
    const panes = [
      { terminalId: 'primary', primary: true, exited: true },
      { terminalId: 'split-1', primary: false },
      { terminalId: 'split-2', primary: false, exited: true }
    ]

    expect(swapTerminalPanes(panes, 'primary', 'split-2')).toEqual([
      panes[2],
      panes[1],
      panes[0]
    ])
    expect(panes).toEqual([
      { terminalId: 'primary', primary: true, exited: true },
      { terminalId: 'split-1', primary: false },
      { terminalId: 'split-2', primary: false, exited: true }
    ])
    expect(swapTerminalPanes(panes, 'primary', 'primary')).toEqual(panes)
    expect(swapTerminalPanes(panes, 'missing', 'split-1')).toEqual(panes)
  })

  it('accepts only complete pane-order permutations', () => {
    const panes = [
      { terminalId: 'primary', primary: true },
      { terminalId: 'split-1', primary: false }
    ]

    expect(orderTerminalPanes(panes, ['split-1', 'primary'])).toEqual([panes[1], panes[0]])
    expect(orderTerminalPanes(panes, ['primary'])).toBeNull()
    expect(orderTerminalPanes(panes, ['primary', 'primary'])).toBeNull()
    expect(orderTerminalPanes(panes, ['primary', 'missing'])).toBeNull()
  })

  it('starts every workspace session with one primary pane', () => {
    expect(createSessionTerminalLayout('session-1')).toEqual({
      layout: 'single',
      panes: [{ terminalId: 'session-1', primary: true }],
      sizes: defaultTerminalLayoutSizes()
    })
  })
})
