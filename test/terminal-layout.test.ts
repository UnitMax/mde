import { describe, expect, it } from 'vitest'
import {
  isTerminalPaneClosable, removeTerminalPane,
  terminalFocusTargetAfterRemoval, swapTerminalPanes, orderTerminalPanes,
  terminalSplitRatio, terminalLayoutGeometry, MAX_TERMINAL_COUNT,
} from '../src/renderer/terminal/layout'
import { appendRuntimePane, createRuntimeLayout, defaultSessionTab, persistRuntimeLayout, splitRuntimePane } from '../src/renderer/terminal/tabs'
import { layoutResized } from '../src/renderer/terminal/layout-edits'
import { isPersistedTerminalLayout, terminalPaneIds } from '../src/shared/terminal-layouts'
import { assertIpcPayload } from '../src/main/ipc-validation'
import { IpcChannels } from '../src/shared/ipc'
import { validateSession } from '../src/main/store/workspace'

const single = () => createRuntimeLayout('s', defaultSessionTab('s'))
const id = (pane: number) => `s:tab:s:tab:default:pane:pane-${pane}`
const split = (layout: ReturnType<typeof single>, source: number, side: 'left' | 'right' | 'top' | 'bottom') =>
  splitRuntimePane('s', 's:tab:default', layout, id(source), side)!

describe('dynamic terminal layouts', () => {
  it('starts with one neutral pane', () => {
    expect(single()).toEqual({ tree: { type: 'pane', paneId: 'pane-1' }, panes: [{ terminalId: id(1), paneId: 'pane-1' }] })
  })

  it.each(['left', 'right', 'top', 'bottom'] as const)('splits a pane to the %s', (side) => {
    const base = single()
    const next = split(base, 1, side)
    expect(next.tree).toMatchObject({ type: 'split', axis: side === 'left' || side === 'right' ? 'column' : 'row', ratio: 0.5 })
    expect(terminalPaneIds(next.tree)).toEqual(side === 'left' || side === 'top' ? ['pane-2', 'pane-1'] : ['pane-1', 'pane-2'])
    expect(next.panes.find((pane) => pane.terminalId === id(1))).toBe(base.panes[0])
    expect(isPersistedTerminalLayout(persistRuntimeLayout(next))).toBe(true)
  })

  it('splits only the chosen pane and preserves other dividers', () => {
    const two = split(single(), 1, 'right')
    if (two.tree.type !== 'split') throw new Error('Expected split')
    const resized = layoutResized(two, two.tree.id, 0.3)
    const nested = split(resized, 2, 'bottom')
    expect(nested.tree).toMatchObject({ ratio: 0.3, first: { type: 'pane', paneId: 'pane-1' }, second: { type: 'split', axis: 'row' } })
    expect(nested.panes.map((pane) => pane.paneId)).toEqual(['pane-1', 'pane-2', 'pane-3'])
    expect(two.panes).toHaveLength(2)
  })

  it('collapses the closed pane’s parent and leaves the other branch intact', () => {
    const three = split(split(single(), 1, 'right'), 2, 'bottom')
    if (three.tree.type !== 'split') throw new Error('Expected split')
    expect(removeTerminalPane(three, id(1))?.tree).toEqual(three.tree.second)
    const two = removeTerminalPane(three, id(2))!
    expect(two.tree).toEqual({ ...three.tree, second: { type: 'pane', paneId: 'pane-3' } })
    const last = removeTerminalPane(two, id(1))!
    expect(last.tree).toEqual({ type: 'pane', paneId: 'pane-3' })
    expect(removeTerminalPane(last, id(3))).toBeNull()
    expect(removeTerminalPane(three, 'missing')).toBeNull()
  })

  it('adds a launcher terminal next to its source without rearranging other panes or persisting the launch', () => {
    const two = split(single(), 1, 'bottom')
    const launch = { sourceTerminalId: id(1), directory: 'terminal' as const }
    const next = appendRuntimePane('s', 's:tab:default', two, launch)!
    expect(next.panes.map((pane) => pane.paneId)).toEqual(['pane-1', 'pane-3', 'pane-2'])
    expect(next.panes[1]?.launch).toBe(launch)
    expect(persistRuntimeLayout(next).panes[1]).toEqual({ id: 'pane-3' })
    expect(appendRuntimePane('s', 't', two, { ...launch, sourceTerminalId: 'missing' })).toBeNull()
  })

  it('allows layouts beyond nine panes and bounds resource use independently of geometry', () => {
    let layout = single()
    for (let count = 2; count <= MAX_TERMINAL_COUNT; count += 1) {
      layout = split(layout, 1, count % 2 ? 'right' : 'bottom')
      expect(layout.panes).toHaveLength(count)
      expect(isPersistedTerminalLayout(persistRuntimeLayout(layout))).toBe(true)
    }
    expect(splitRuntimePane('s', 't', layout, id(1), 'right')).toBeNull()
  })

  it('keeps nested geometry and its dividers aligned including their one pixel gaps', () => {
    const three = split(split(single(), 1, 'right'), 2, 'bottom')
    const geometry = terminalLayoutGeometry(three.tree)
    expect(geometry.panes.map((pane) => pane.style)).toEqual([
      { left: 'calc(0% + 0px)', top: 'calc(0% + 0px)', width: 'calc(50% + -0.5px)', height: 'calc(100% + 0px)' },
      { left: 'calc(50% + 0.5px)', top: 'calc(0% + 0px)', width: 'calc(50% + -0.5px)', height: 'calc(50% + -0.5px)' },
      { left: 'calc(50% + 0.5px)', top: 'calc(50% + 0.5px)', width: 'calc(50% + -0.5px)', height: 'calc(50% + -0.5px)' },
    ])
    expect(geometry.splits[1]?.style).toEqual({ left: 'calc(50% + 0.5px)', top: 'calc(0% + 0px)', width: 'calc(50% + -0.5px)', height: 'calc(100% + 0px)' })
  })

  it('clamps a dragged divider so both sides remain usable', () => {
    expect(terminalSplitRatio(500, 1000)).toBeCloseTo(0.5)
    expect(terminalSplitRatio(0, 1000)).toBeCloseTo(120 / 999)
    expect(terminalSplitRatio(1000, 1000)).toBeCloseTo(879 / 999)
    expect(terminalSplitRatio(0, 100)).toBe(0.5)
    expect(terminalSplitRatio(0, 0)).toBe(0.5)
  })

  it('round trips a mixed arrangement through IPC validation and the workspace store', () => {
    const layout = persistRuntimeLayout(split(split(split(single(), 1, 'top'), 2, 'left'), 1, 'bottom'))
    expect(() => assertIpcPayload(IpcChannels.tabsUpdate, { sessionId: 's', tabId: 't', patch: { layout } })).not.toThrow()
    expect(validateSession({ id: 's', projectId: 'p', name: 'App', kind: 'native', path: '/workspace/app', createdAt: '2026-01-01T00:00:00.000Z', tabs: [{ id: 't', name: 'Tab', layout }] }, new Set(['p']))?.tabs?.[0]?.layout).toEqual(layout)
  })

  it('allows any existing pane to close while another pane remains', () => {
    const panes = [{ terminalId: 'pane-1' }, { terminalId: 'pane-2' }]

    expect(isTerminalPaneClosable(panes, 'pane-1')).toBe(true)
    expect(isTerminalPaneClosable(panes, 'pane-2')).toBe(true)
    expect(isTerminalPaneClosable(panes.slice(0, 1), 'pane-1')).toBe(false)
    expect(isTerminalPaneClosable(panes, 'missing')).toBe(false)
  })

  it('keeps focus on a surviving pane when a different pane is removed', () => {
    const panes = [
      { terminalId: 'pane-1' },
      { terminalId: 'pane-2' },
      { terminalId: 'pane-3' }
    ]

    expect(terminalFocusTargetAfterRemoval(panes, ['pane-1'], 'pane-3')).toBe('pane-3')
  })

  it('selects the preceding pane, or the next pane when the first is removed', () => {
    const panes = [
      { terminalId: 'pane-1' },
      { terminalId: 'pane-2' },
      { terminalId: 'pane-3' }
    ]

    expect(terminalFocusTargetAfterRemoval(panes, ['pane-3'], 'pane-3')).toBe('pane-2')
    expect(terminalFocusTargetAfterRemoval(panes, ['pane-1'], 'pane-1')).toBe('pane-2')
  })

  it('selects the nearest preceding survivor after a focused pane is removed with others', () => {
    const panes = [
      { terminalId: 'pane-1' },
      { terminalId: 'pane-2' },
      { terminalId: 'pane-3' },
      { terminalId: 'pane-4' },
      { terminalId: 'pane-5' }
    ]

    expect(
      terminalFocusTargetAfterRemoval(panes, ['pane-1', 'pane-3', 'pane-4'], 'pane-4')
    ).toBe('pane-2')
  })

  it('uses the first remaining pane when the focused pane is unknown', () => {
    const panes = [
      { terminalId: 'pane-1' },
      { terminalId: 'pane-2' },
      { terminalId: 'pane-3' }
    ]

    expect(terminalFocusTargetAfterRemoval(panes, ['pane-1'], null)).toBe('pane-2')
    expect(terminalFocusTargetAfterRemoval(panes, ['pane-1'], 'missing')).toBe('pane-2')
  })

  it('swaps pane positions while preserving pane metadata', () => {
    const panes = [
      { terminalId: 'pane-1', exited: true },
      { terminalId: 'pane-2' },
      { terminalId: 'pane-3', exited: true }
    ]

    expect(swapTerminalPanes(panes, 'pane-1', 'pane-3')).toEqual([
      panes[2],
      panes[1],
      panes[0]
    ])
    expect(panes).toEqual([
      { terminalId: 'pane-1', exited: true },
      { terminalId: 'pane-2' },
      { terminalId: 'pane-3', exited: true }
    ])
    expect(swapTerminalPanes(panes, 'pane-1', 'pane-1')).toEqual(panes)
    expect(swapTerminalPanes(panes, 'missing', 'pane-2')).toEqual(panes)
  })

  it('accepts only complete pane-order permutations', () => {
    const panes = [
      { terminalId: 'pane-1' },
      { terminalId: 'pane-2' }
    ]

    expect(orderTerminalPanes(panes, ['pane-2', 'pane-1'])).toEqual([panes[1], panes[0]])
    expect(orderTerminalPanes(panes, ['pane-1'])).toBeNull()
    expect(orderTerminalPanes(panes, ['pane-1', 'pane-1'])).toBeNull()
    expect(orderTerminalPanes(panes, ['pane-1', 'missing'])).toBeNull()
  })

})
