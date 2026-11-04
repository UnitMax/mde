import { describe, expect, it } from 'vitest'
import { layoutReordered, layoutResized, layoutTitled } from '../src/renderer/terminal/layout-edits'
import { createRuntimeLayout, defaultSessionTab, splitRuntimePane } from '../src/renderer/terminal/tabs'
import { terminalPaneIds } from '../src/shared/terminal-layouts'

const single = createRuntimeLayout('s', defaultSessionTab('s'))
const two = () => splitRuntimePane('s', 't', single, single.panes[0]!.terminalId, 'right')!

describe('terminal layout edits', () => {
  it('moves only the named divider and ignores invalid ratios', () => {
    const base = two()
    if (base.tree.type !== 'split') throw new Error('Expected split')
    const nested = splitRuntimePane('s', 't', base, base.panes[1]!.terminalId, 'bottom')!
    const next = layoutResized(nested, base.tree.id, 0.3)
    expect(next.tree).toMatchObject({ ratio: 0.3, second: { ratio: 0.5 } })
    expect(next.panes).toBe(nested.panes)
    for (const ratio of [0, 1, Infinity, NaN, -1]) expect(layoutResized(next, base.tree.id, ratio)).toBe(next)
  })

  it('reorders pane identities in the tree while preserving geometry and metadata', () => {
    const base = two()
    const [a, b] = base.panes.map((pane) => pane.terminalId) as [string, string]
    const next = layoutReordered(base, [b, a])!
    expect(next.panes).toEqual([...base.panes].reverse())
    expect(terminalPaneIds(next.tree)).toEqual(['pane-2', 'pane-1'])
    if (base.tree.type !== 'split') throw new Error('Expected split')
    expect(next.tree).toMatchObject({ id: base.tree.id, ratio: base.tree.ratio, axis: base.tree.axis })
    expect(layoutReordered(base, [a])).toBeNull()
    expect(layoutReordered(base, [a, a])).toBeNull()
    expect(layoutReordered(base, [a, 'other'])).toBeNull()
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
