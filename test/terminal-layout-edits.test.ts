import { describe, expect, it } from 'vitest'
import {
  layoutReduced,
  layoutReordered,
  layoutResized,
  layoutSwitched,
  layoutTitled,
} from '../src/renderer/terminal/layout-edits'
import { defaultTerminalLayoutSizes, type SessionTerminalLayout } from '../src/renderer/terminal/layout'

const single: SessionTerminalLayout = {
  layout: 'single',
  panes: [{ terminalId: 's:tab:t:pane:pane-1', paneId: 'pane-1' }],
  sizes: defaultTerminalLayoutSizes('single'),
}

describe('terminal layout edits', () => {
  it('switches to a layout with more panes by adding panes named after the session and tab', () => {
    const next = layoutSwitched(single, 'quadrant', 's', 't')!
    expect(next.layout).toBe('quadrant')
    expect(next.panes.map((pane) => pane.terminalId)).toEqual([
      's:tab:t:pane:pane-1', 's:tab:t:pane:pane-2', 's:tab:t:pane:pane-3', 's:tab:t:pane:pane-4',
    ])
    expect(next.panes[0]).toBe(single.panes[0])
    expect(next.sizes).toEqual(defaultTerminalLayoutSizes('quadrant'))
  })

  it('reuses a free pane key rather than one that is taken', () => {
    const gap: SessionTerminalLayout = { ...single, layout: 'columns', panes: [{ terminalId: 'a', paneId: 'pane-2' }, { terminalId: 'b', paneId: 'pane-3' }] }
    const next = layoutSwitched(gap, 'three', 's', 't')!
    expect(next.panes[2]).toEqual({ terminalId: 's:tab:t:pane:pane-1', paneId: 'pane-1' })
  })

  it('switches between layouts with as many panes by keeping every pane and resetting the dividers', () => {
    const columns = layoutSwitched(single, 'columns', 's', 't')!
    const moved = layoutResized(columns, 'column', 0.3)
    const next = layoutSwitched({ ...moved, layout: 'columns' }, 'columns', 's', 't')!
    expect(next.panes).toEqual(columns.panes)
    expect(next.sizes).toEqual(defaultTerminalLayoutSizes('columns'))
  })

  it('leaves a switch to a smaller layout to the caller, who has to ask first', () => {
    const four = layoutSwitched(single, 'quadrant', 's', 't')!
    expect(layoutSwitched(four, 'columns', 's', 't')).toBeNull()
  })

  it('reduces to a smaller layout by dropping the named panes', () => {
    const four = layoutSwitched(single, 'quadrant', 's', 't')!
    const dropped = ['s:tab:t:pane:pane-3', 's:tab:t:pane:pane-4']
    const next = layoutReduced(four, 'columns', dropped)
    expect(next.layout).toBe('columns')
    expect(next.panes.map((pane) => pane.paneId)).toEqual(['pane-1', 'pane-2'])
    expect(next.sizes).toEqual(defaultTerminalLayoutSizes('columns'))
  })

  it('moves the first or the second divider of a split', () => {
    const base = { ...single, layout: 'nineGrid' as const, sizes: defaultTerminalLayoutSizes('nineGrid') }
    expect(layoutResized(base, 'column', 0.4).sizes.columnRatio).toBe(0.4)
    expect(layoutResized(base, 'column', 0.7, 1).sizes.secondColumnRatio).toBe(0.7)
    expect(layoutResized(base, 'row', 0.2).sizes.rowRatio).toBe(0.2)
    expect(layoutResized(base, 'row', 0.8, 1).sizes.secondRowRatio).toBe(0.8)
    // Only the divider that moved changes.
    expect(layoutResized(base, 'column', 0.4).sizes.rowRatio).toBe(base.sizes.rowRatio)
  })

  it('reorders panes, and refuses anything that is not an order of the same panes', () => {
    const two = layoutSwitched(single, 'columns', 's', 't')!
    const [a, b] = two.panes.map((pane) => pane.terminalId) as [string, string]
    expect(layoutReordered(two, [b, a])!.panes.map((pane) => pane.terminalId)).toEqual([b, a])
    expect(layoutReordered(two, [a])).toBeNull()
    expect(layoutReordered(two, [a, a])).toBeNull()
    expect(layoutReordered(two, [a, 'other'])).toBeNull()
  })

  it('names a pane, trims the name, clears it when empty, and ignores a pane that is not there', () => {
    const id = single.panes[0]!.terminalId
    expect(layoutTitled(single, id, '  build  ')!.panes[0]!.title).toBe('build')
    const named = layoutTitled(single, id, 'build')!
    expect('title' in layoutTitled(named, id, '   ')!.panes[0]!).toBe(false)
    expect('title' in layoutTitled(named, id, null)!.panes[0]!).toBe(false)
    expect(layoutTitled(single, 'other', 'x')).toBeNull()
  })
})
