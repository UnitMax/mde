import { describe, expect, it } from 'vitest'
import { IpcChannels } from '../src/shared/ipc'
import { assertIpcPayload } from '../src/main/ipc-validation'
import { validateSession } from '../src/main/store/workspace'
import {
  MAX_TERMINAL_COUNT,
  TERMINAL_LAYOUTS,
  createSessionTerminalLayout,
  defaultTerminalLayoutSizes,
  getTerminalLayoutShortcut,
  isTerminalPaneClosable,
  layoutClass,
  layoutForCount,
  orderTerminalPanes,
  panesToTrim,
  paneClass,
  removeTerminalPane,
  swapTerminalPanes,
  terminalCount,
  terminalColumnRatios,
  terminalColumnSplitRatio,
  terminalGridTemplates,
  terminalFocusTargetAfterRemoval,
  terminalResizeHandles,
  terminalRowColumns,
  terminalRowGroups,
  terminalRowRatios,
  terminalRowSplitRatio,
  terminalSplitRatio
} from '../src/renderer/terminal/layout'
import { appendRuntimePane, persistRuntimeLayout } from '../src/renderer/terminal/tabs'

describe('terminal layouts', () => {
  it('maps Ctrl+1 through Ctrl+9 to the supported layouts', () => {
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
    expect(getTerminalLayoutShortcut(input('5'))).toBe('fiveGrid')
    expect(getTerminalLayoutShortcut(input('6'))).toBe('sixGrid')
    expect(getTerminalLayoutShortcut(input('7'))).toBe('threeColumns')
    expect(getTerminalLayoutShortcut(input('8'))).toBe('eightGrid')
    expect(getTerminalLayoutShortcut(input('9'))).toBe('nineGrid')
    expect(getTerminalLayoutShortcut(input('Dead', { code: 'Numpad9' }))).toBe('nineGrid')
  })

  it('gives each shortcut digit to one layout and leaves Ctrl+0 for zoom', () => {
    const digits = TERMINAL_LAYOUTS.flatMap((candidate) => candidate.shortcut ?? [])

    expect(new Set(digits).size).toBe(digits.length)
    expect(digits.sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(TERMINAL_LAYOUTS.find((candidate) => candidate.value === 'sevenGrid')?.shortcut).toBeUndefined()
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
    expect(getTerminalLayoutShortcut(input({ key: '0', code: 'Digit0' }))).toBeNull()
  })

  it('maps each supported layout to its pane count', () => {
    expect(terminalCount('single')).toBe(1)
    expect(terminalCount('columns')).toBe(2)
    expect(terminalCount('three')).toBe(3)
    expect(terminalCount('quadrant')).toBe(4)
    expect(terminalCount('fiveGrid')).toBe(5)
    expect(terminalCount('threeColumns')).toBe(3)
    expect(terminalCount('sixGrid')).toBe(6)
    expect(layoutForCount(1)).toBe('single')
    expect(layoutForCount(2)).toBe('columns')
    expect(layoutForCount(3)).toBe('three')
    expect(layoutForCount(4)).toBe('quadrant')
    expect(layoutForCount(5)).toBe('fiveGrid')
    expect(layoutForCount(6)).toBe('sixGrid')
    expect(terminalCount('sevenGrid')).toBe(7)
    expect(terminalCount('eightGrid')).toBe(8)
    expect(terminalCount('nineGrid')).toBe(9)
    expect(layoutForCount(7)).toBe('sevenGrid')
    expect(layoutForCount(8)).toBe('eightGrid')
    expect(layoutForCount(9)).toBe('nineGrid')
  })

  it('has a layout for every pane count up to the maximum', () => {
    expect(MAX_TERMINAL_COUNT).toBe(9)
    for (let count = 1; count <= MAX_TERMINAL_COUNT; count += 1) {
      expect(terminalCount(layoutForCount(count))).toBe(count)
    }
  })

  it('describes the requested grid geometry', () => {
    expect(layoutClass('single')).toContain('grid-cols-1')
    expect(layoutClass('columns')).toContain('grid-rows-1')
    expect(layoutClass('three')).toContain('grid-rows-2')
    expect(layoutClass('fiveGrid')).toEqual('grid-cols-1 grid-rows-2')
    expect(layoutClass('threeColumns')).toEqual('grid-cols-3 grid-rows-1')
    expect(layoutClass('sixGrid')).toEqual('grid-cols-3 grid-rows-2')
    expect(paneClass('three', 2)).toBe('col-span-2')
    expect(paneClass('quadrant', 2)).toBe('')
    expect(paneClass('fiveGrid', 4)).toBe('')
    expect(paneClass('sixGrid', 2)).toBe('')
    for (const layout of ['sevenGrid', 'eightGrid', 'nineGrid'] as const) {
      expect(layoutClass(layout)).toEqual('grid-cols-1 grid-rows-3')
    }
  })

  it('stacks the rows of the five- to nine-pane layouts and covers every pane', () => {
    expect(terminalRowGroups('single')).toBeNull()
    expect(terminalRowGroups('sixGrid')).toBeNull()
    expect(terminalRowGroups('fiveGrid')).toEqual([3, 2])
    expect(terminalRowGroups('sevenGrid')).toEqual([3, 3, 1])
    expect(terminalRowGroups('eightGrid')).toEqual([3, 3, 2])
    expect(terminalRowGroups('nineGrid')).toEqual([3, 3, 3])
    for (const layout of ['fiveGrid', 'sevenGrid', 'eightGrid', 'nineGrid'] as const) {
      expect(terminalRowGroups(layout)!.reduce((sum, count) => sum + count, 0)).toBe(terminalCount(layout))
    }
  })

  it('shares the column ratios across full rows and splits a short row evenly', () => {
    const sizes = { columnRatio: 0.25, secondColumnRatio: 0.6, rowRatio: 0.5 }

    expect(terminalRowColumns(3, sizes)).toBe('minmax(0, 0.25fr) minmax(0, 0.35fr) minmax(0, 0.4fr)')
    expect(terminalRowColumns(2, sizes)).toBe('repeat(2, minmax(0, 1fr))')
    expect(terminalRowColumns(1, sizes)).toBe('repeat(1, minmax(0, 1fr))')
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
    expect(terminalResizeHandles('fiveGrid')).toEqual([
      { axis: 'column', scope: 'top', columnIndex: 0 },
      { axis: 'column', scope: 'top', columnIndex: 1 },
      { axis: 'row', scope: 'full' }
    ])
    expect(terminalResizeHandles('sixGrid')).toEqual([
      { axis: 'column', scope: 'full', columnIndex: 0 },
      { axis: 'column', scope: 'full', columnIndex: 1 },
      { axis: 'row', scope: 'full' }
    ])
    expect(terminalResizeHandles('nineGrid')).toEqual([
      { axis: 'column', scope: 'full', columnIndex: 0 },
      { axis: 'column', scope: 'full', columnIndex: 1 },
      { axis: 'row', scope: 'full', rowIndex: 0 },
      { axis: 'row', scope: 'full', rowIndex: 1 }
    ])
  })

  it('stops the shared column dividers above a short last row', () => {
    for (const layout of ['sevenGrid', 'eightGrid'] as const) {
      expect(terminalResizeHandles(layout)).toEqual([
        { axis: 'column', scope: 'upper', columnIndex: 0 },
        { axis: 'column', scope: 'upper', columnIndex: 1 },
        { axis: 'row', scope: 'full', rowIndex: 0 },
        { axis: 'row', scope: 'full', rowIndex: 1 }
      ])
    }
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
    expect(terminalGridTemplates('fiveGrid', {
      columnRatio: 1 / 3,
      secondColumnRatio: 2 / 3,
      rowRatio: 0.5
    })).toEqual({
      columns: 'minmax(0, 1fr)',
      rows: 'minmax(0, 0.5fr) minmax(0, 0.5fr)'
    })
    for (const layout of ['sevenGrid', 'eightGrid', 'nineGrid'] as const) {
      expect(terminalGridTemplates(layout, {
        columnRatio: 1 / 3,
        secondColumnRatio: 2 / 3,
        rowRatio: 0.25,
        secondRowRatio: 0.5
      })).toEqual({
        columns: 'minmax(0, 1fr)',
        rows: 'minmax(0, 0.25fr) minmax(0, 0.25fr) minmax(0, 0.5fr)'
      })
    }
  })

  it('starts the three-row layouts with even rows and columns', () => {
    for (const layout of ['sevenGrid', 'eightGrid', 'nineGrid'] as const) {
      expect(defaultTerminalLayoutSizes(layout)).toEqual({
        columnRatio: 1 / 3,
        secondColumnRatio: 2 / 3,
        rowRatio: 1 / 3,
        secondRowRatio: 2 / 3
      })
    }
  })

  it('normalizes invalid three-row ratios and constrains both row dividers', () => {
    const even = { columnRatio: 1 / 3, secondColumnRatio: 2 / 3, rowRatio: 1 / 3, secondRowRatio: 2 / 3 }

    expect(terminalRowRatios({ ...even, rowRatio: 0.8, secondRowRatio: 0.2 })).toEqual([1 / 3, 2 / 3])
    expect(terminalRowRatios({ columnRatio: 0.5, rowRatio: 0.5 })).toEqual([0.5, 2 / 3])
    expect(terminalRowSplitRatio(0, 1000, 0, even)).toBeCloseTo(120 / 998)
    expect(terminalRowSplitRatio(1000, 1000, 1, even)).toBeCloseTo(878 / 998)
    expect(terminalRowSplitRatio(0, 100, 1, even)).toBeCloseTo(2 / 3)
    // The first divider cannot be dragged into the second.
    expect(terminalRowSplitRatio(990, 1000, 0, even)).toBeCloseTo(2 / 3 - 120 / 998)
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

  it('trims newest panes without protecting a specific terminal', () => {
    const panes = [
      { terminalId: 'pane-1' },
      { terminalId: 'pane-2' },
      { terminalId: 'pane-3' },
      { terminalId: 'pane-4' }
    ]

    expect(panesToTrim(panes, 2)).toEqual(['pane-4', 'pane-3'])
    expect(panesToTrim(panes, 1)).toEqual(['pane-4', 'pane-3', 'pane-2'])
  })

  it('removes one pane and selects the layout for the remaining count', () => {
    const sixLayout = {
      layout: 'sixGrid' as const,
      panes: [
        { terminalId: 'pane-1' },
        { terminalId: 'pane-2' },
        { terminalId: 'pane-3' },
        { terminalId: 'pane-4' },
        { terminalId: 'pane-5' },
        { terminalId: 'pane-6' }
      ],
      sizes: { columnRatio: 1 / 3, secondColumnRatio: 2 / 3, rowRatio: 0.5 }
    }
    const fiveLayout = removeTerminalPane(sixLayout, 'pane-3')

    expect(fiveLayout?.layout).toBe('fiveGrid')
    expect(fiveLayout?.panes.map((pane) => pane.terminalId)).toEqual([
      'pane-1',
      'pane-2',
      'pane-4',
      'pane-5',
      'pane-6'
    ])

    const fourLayout = removeTerminalPane(fiveLayout!, 'pane-5')
    expect(fourLayout?.layout).toBe('quadrant')
    expect(fourLayout?.panes).toHaveLength(4)
    expect(removeTerminalPane(fourLayout!, 'pane-1')?.panes).toHaveLength(3)

    const singleLayout = {
      layout: 'single' as const,
      panes: [{ terminalId: 'pane-1' }],
      sizes: defaultTerminalLayoutSizes()
    }
    expect(removeTerminalPane(singleLayout, 'pane-1')).toBeNull()
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

  it('starts every workspace session with one neutral pane', () => {
    expect(createSessionTerminalLayout('session-1')).toEqual({
      layout: 'single',
      panes: [{ terminalId: 'session-1' }],
      sizes: defaultTerminalLayoutSizes()
    })
  })

  it('appends a runtime pane and strips its launch metadata when persisted', () => {
    const launch = {
      sourceTerminalId: 'session-1:tab:default:pane:pane-1',
      directory: 'terminal' as const,
      agent: {
        kind: 'codex' as const,
        command: { executable: 'codex', args: ['--model', 'gpt-5'] }
      }
    }
    const layout = {
      layout: 'single' as const,
      panes: [{ terminalId: 'session-1:tab:default:pane:pane-1', paneId: 'pane-1' }],
      sizes: defaultTerminalLayoutSizes()
    }

    const next = appendRuntimePane('session-1', 'tab-1', layout, launch)

    expect(next?.layout).toBe('columns')
    expect(next?.panes[1]).toMatchObject({
      paneId: 'pane-2',
      launch
    })
    expect(persistRuntimeLayout(next!)).toEqual({
      layout: 'columns',
      panes: [
        { id: 'pane-1' },
        { id: 'pane-2' }
      ],
      sizes: defaultTerminalLayoutSizes('columns')
    })
  })

  it('does not append beyond the nine-pane limit', () => {
    const layout = {
      layout: 'nineGrid' as const,
      panes: Array.from({ length: 9 }, (_, index) => ({
        terminalId: `pane-${index + 1}`,
        paneId: `pane-${index + 1}`
      })),
      sizes: defaultTerminalLayoutSizes('nineGrid')
    }

    expect(appendRuntimePane('session-1', 'tab-1', layout, {
      sourceTerminalId: 'pane-1',
      directory: 'terminal'
    })).toBeNull()
  })

  it('grows one pane at a time from six to nine and shrinks back down', () => {
    const launch = { sourceTerminalId: 'pane-1', directory: 'terminal' as const }
    let layout = {
      layout: 'sixGrid' as const,
      panes: Array.from({ length: 6 }, (_, index) => ({
        terminalId: `pane-${index + 1}`,
        paneId: `pane-${index + 1}`
      })),
      sizes: defaultTerminalLayoutSizes('sixGrid')
    } as ReturnType<typeof createSessionTerminalLayout>

    for (const expected of ['sevenGrid', 'eightGrid', 'nineGrid'] as const) {
      layout = appendRuntimePane('session-1', 'tab-1', layout, launch)!
      expect(layout.layout).toBe(expected)
      expect(layout.panes).toHaveLength(terminalCount(expected))
      expect(layout.sizes).toEqual(defaultTerminalLayoutSizes(expected))
    }

    for (const expected of ['eightGrid', 'sevenGrid', 'sixGrid'] as const) {
      layout = removeTerminalPane(layout, layout.panes[0]!.terminalId)!
      expect(layout.layout).toBe(expected)
      expect(layout.panes).toHaveLength(terminalCount(expected))
    }
  })

  it('persists every layout at its pane count through both main-process validators', () => {
    const projectIds = new Set(['project-1'])
    const session = {
      id: 'session-1',
      projectId: 'project-1',
      name: 'App',
      kind: 'wsl',
      distro: 'Ubuntu-24.04',
      path: '/home/me/src/app',
      createdAt: '2026-01-01T00:00:00.000Z'
    }

    for (const candidate of TERMINAL_LAYOUTS) {
      const layout = {
        layout: candidate.value,
        panes: Array.from({ length: candidate.count }, (_, index) => ({ id: `pane-${index + 1}` })),
        sizes: defaultTerminalLayoutSizes(candidate.value)
      }

      expect(() => assertIpcPayload(
        IpcChannels.tabsUpdate,
        { sessionId: 'session-1', tabId: 'tab-1', patch: { layout } }
      ), candidate.value).not.toThrow()
      expect(
        validateSession({ ...session, tabs: [{ id: 'tab-1', name: 'Tab', layout }] }, projectIds)?.tabs?.[0]?.layout,
        candidate.value
      ).toEqual(layout)
    }
  })
})
