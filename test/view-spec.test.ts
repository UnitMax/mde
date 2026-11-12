import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { runBridge } from '../src/main/mcp/bridge'
import { showView } from '../src/main/mcp/views'
import { parseMessagesPage } from '../src/main/opencode/service/parse'
import { MDE_MCP_TOOLS, MDE_VIEW_TOOL } from '../src/shared/mde-mcp'
import type { ChatPart } from '../src/shared/types'
import { checkView, VIEW_LIMITS, VIEW_SPEC_CHARS, type View, type ViewNode } from '../src/shared/view-spec'

const dashboard = {
  title: 'Test run',
  root: 'grid',
  elements: {
    grid: { type: 'Grid', props: { columns: 2 }, children: ['passed', 'time'] },
    passed: { type: 'Stat', props: { label: 'Passed', value: 412, delta: 12, deltaLabel: 'vs main', trend: [380, 400, 412] } },
    time: { type: 'BarChart', props: { categories: ['unit', 'e2e'], series: [{ name: 'seconds', data: [38, 124] }], unit: 's' } },
  },
}

function errors(input: unknown): string[] {
  const check = checkView(input)
  return check.ok ? [] : check.errors
}

function single(type: string, props: Record<string, unknown>): unknown {
  return { root: 'a', elements: { a: { type, props } } }
}

describe('checking a view', () => {
  it('turns the flat elements into a checked tree', () => {
    const check = checkView(dashboard)
    expect(check.ok).toBe(true)
    const view = (check as { view: View }).view
    expect(view.title).toBe('Test run')
    expect(view.root).toMatchObject({ id: 'grid', type: 'Grid', columns: 2 })
    const [stat, chart] = (view.root as Extract<ViewNode, { type: 'Grid' }>).children
    expect(stat).toEqual({ id: 'passed', type: 'Stat', label: 'Passed', value: 412, delta: 12, deltaLabel: 'vs main', good: 'up', trend: [380, 400, 412] })
    expect(chart).toMatchObject({ type: 'BarChart', horizontal: false, stacked: false, unit: 's' })
  })

  it('names only the components it knows, and only their props', () => {
    expect(errors(single('Iframe', { src: 'https://example.com' }))[0]).toMatch(/^\/elements\/a\/props\/type: "Iframe" is not a component/)
    expect(errors(single('Text', { text: 'hi', style: 'color:red', html: '<b>x</b>' }))).toEqual([
      '/elements/a/props/style: is not a prop of this component',
      '/elements/a/props/html: is not a prop of this component',
    ])
    expect(errors({ ...dashboard, script: 'alert(1)' })).toEqual(['/script: is not part of a view; use title, root and elements'])
    expect(errors({ root: 'a', elements: { a: { type: 'Divider', onClick: 'x' } } })).toEqual(['/elements/a/onClick: is not part of an element; use type, props and children'])
  })

  it('keeps every element in exactly one place', () => {
    expect(errors({ root: 'a', elements: { a: { type: 'Stack', children: ['b', 'b'] }, b: { type: 'Divider' } } }))
      .toEqual(['/elements/a/children/1: "b" already has a place in the view; every element appears once'])
    expect(errors({ root: 'a', elements: { a: { type: 'Stack', children: ['b'] }, b: { type: 'Stack', children: ['a'] } } }))
      .toEqual(['/elements/b/children/0: "a" already has a place in the view; every element appears once'])
    expect(errors({ root: 'a', elements: { a: { type: 'Divider' }, lost: { type: 'Divider' } } }))
      .toEqual(['/elements/lost: is not the child of any element, so it would not be shown'])
    expect(errors({ root: 'nope', elements: { a: { type: 'Divider' } } })).toEqual(['/root: must name an element, such as "a"'])
    expect(errors({ root: 'a', elements: { a: { type: 'Stack', children: ['ghost'] } } })).toEqual(['/elements/a/children/0: "ghost" is not an element id'])
    expect(errors({ root: 'a', elements: { a: { type: 'Text', props: { text: 'x' }, children: ['a'] } } })).toEqual(['/elements/a/children: Text has no children'])
  })

  it('stops at its limits', () => {
    const deep: Record<string, unknown> = {}
    for (let index = 0; index < 12; index += 1) deep[`n${index}`] = { type: 'Stack', children: index < 11 ? [`n${index + 1}`] : [] }
    expect(errors({ root: 'n0', elements: deep })[0]).toMatch(/nested more than 8 levels deep/)

    const points = Array.from({ length: VIEW_LIMITS.points + 1 }, (_, index) => index)
    expect(errors(single('LineChart', { x: points, series: [{ name: 'a', data: points }] }))[0]).toBe('/elements/a/props/x: has more than 400 entries')

    const huge = { root: 'a', elements: { a: { type: 'Text', props: { text: 'x'.repeat(VIEW_SPEC_CHARS) } } } }
    expect(errors(huge)[0]).toMatch(/at most 48000 are allowed/)

    const many: Record<string, unknown> = { root: { type: 'Stack', children: [] as string[] } }
    for (let index = 0; index < VIEW_LIMITS.elements; index += 1) many[`e${index}`] = { type: 'Divider' }
    expect(errors({ root: 'root', elements: many })[0]).toMatch(/at most 150 are allowed/)
  })

  it('refuses control and bidirectional characters, and lines in a label', () => {
    expect(errors(single('Heading', { text: 'a‮b' }))).toEqual(['/elements/a/props/text: must be one line without control characters'])
    expect(errors(single('Heading', { text: 'two\nlines' }))).toEqual(['/elements/a/props/text: must be one line without control characters'])
    expect(errors(single('Text', { text: 'two\nlines' }))).toEqual([])
    expect(errors(single('Text', { text: 'bell\u0007' }))).toEqual(['/elements/a/props/text: holds control characters'])
  })

  it('checks numbers and the shape of chart data', () => {
    expect(errors(single('BarChart', { categories: ['a', 'b'], series: [{ name: 's', data: [1] }] })))
      .toEqual(['/elements/a/props/series/0/data: has 1 values for 2 labels'])
    expect(errors(single('BarChart', { categories: ['a'], series: [{ name: 's', data: [-1] }], stacked: true })))
      .toEqual(['/elements/a/props/series: stacked bars cannot be negative'])
    expect(errors(single('LineChart', { x: ['a'], series: [{ name: 's', data: ['1'] }] })))
      .toEqual(['/elements/a/props/series/0/data/0: must be a finite number'])
    expect(errors(single('DonutChart', { segments: [{ label: 'a', value: -2 }] })))
      .toEqual(['/elements/a/props/segments/0/value: cannot be negative'])
    expect(errors(single('Table', { columns: ['a', 'b'], rows: [['x']] })))
      .toEqual(['/elements/a/props/rows/0: has 1 cells for 2 columns'])
    expect(errors({ root: 't', elements: { t: { type: 'Tabs', props: { tabs: ['one', 'two'] }, children: ['x'] }, x: { type: 'Divider' } } }))
      .toEqual(['/elements/t/props/tabs: needs one label per child'])
  })

  it('reads an AreaChart as a line chart with areas', () => {
    const check = checkView(single('AreaChart', { x: [1, 2], series: [{ name: 's', data: [1, null] }] }))
    expect(check.ok && check.view.root).toMatchObject({ type: 'LineChart', area: true, x: ['1', '2'] })
  })

  it('reports at most a dozen problems', () => {
    const elements: Record<string, unknown> = { root: { type: 'Stack', children: [] as string[] } }
    for (let index = 0; index < 30; index += 1) {
      elements[`e${index}`] = { type: 'Bogus' }
      ;(elements.root as { children: string[] }).children.push(`e${index}`)
    }
    expect(errors({ root: 'root', elements })).toHaveLength(VIEW_LIMITS.errors)
  })
})

describe('the show_view tool', () => {
  it('is listed with the catalog in its description', () => {
    const tool = MDE_MCP_TOOLS.find((entry) => entry.name === MDE_VIEW_TOOL)!
    expect(tool.description).toContain('BarChart')
    expect(tool.description).toContain('Example:')
    // The example in the description is itself a view that passes.
    const example = JSON.parse(tool.description.slice(tool.description.indexOf('Example: ') + 9).replace(/\n/g, ''))
    expect(checkView(example).ok).toBe(true)
  })

  it('tells the agent what to fix', () => {
    expect(showView(dashboard)).toEqual({ isError: false, text: expect.stringContaining('MDE shows the view "Test run"') })
    const refused = showView({ root: 'a', elements: { a: { type: 'Chart' } } })
    expect(refused.isError).toBe(true)
    expect(refused.text).toMatch(/- \/elements\/a\/props\/type: "Chart" is not a component/)
  })

  it('is answered by the bridge itself, so it works while MDE is closed', async () => {
    const input = new PassThrough()
    const output: string[] = []
    const done = runBridge({
      connect: () => { throw new Error('the bridge should not connect') },
      readToken: async () => null,
      input,
      write: (text) => output.push(text),
      target: { kind: 'native' },
      cwd: '/home/me/app',
      version: '1',
    })
    input.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: MDE_VIEW_TOOL, arguments: dashboard } })}\n`)
    await done
    const answer = JSON.parse(output.join('').trim()) as { result: { isError: boolean; content: { text: string }[] } }
    expect(answer.result.isError).toBe(false)
    expect(answer.result.content[0]!.text).toContain('MDE shows the view')
  })
})

describe('views in the transcript', () => {
  type ToolPart = Extract<ChatPart, { kind: 'tool' }>
  const big = {
    root: 't',
    elements: { t: { type: 'Table', props: { columns: ['name', 'value'], rows: Array.from({ length: 200 }, (_, index) => [`a longer row name ${index}`, index * 1.5]) } } },
  }

  function toolPart(content: Record<string, unknown>): ToolPart {
    const { messages } = parseMessagesPage({
      data: [{
        id: 'msg_1',
        type: 'assistant',
        time: { created: 1, completed: 2 },
        agent: 'build',
        model: { id: 'm', providerID: 'p' },
        content: [content],
      }],
    }, false, 10)
    const message = messages[0]!
    if (message.kind !== 'assistant') throw new Error('not an assistant message')
    return message.parts[0] as ToolPart
  }

  it('keeps a view\'s arguments whole and compact, beyond the usual cut of a call', () => {
    expect(JSON.stringify(big).length).toBeGreaterThan(4 * 1024)
    const direct = toolPart({ type: 'tool', id: 'call_1', name: 'mde_show_view', state: { status: 'completed', input: big, content: [] } })
    expect(direct.input).toBe(JSON.stringify(big))
    expect(direct.truncated).toBeUndefined()

    const script = toolPart({
      type: 'tool',
      id: 'call_2',
      name: 'execute',
      state: {
        status: 'completed',
        input: { code: 'await tools.mde.show_view(view)' },
        content: [],
        metadata: { toolCalls: [{ tool: 'other.thing', status: 'completed', input: { text: 'y'.repeat(9000) } }, { tool: 'mde.show_view', status: 'completed', input: big }] },
      },
    })
    expect(script.calls![0]!.input.length).toBe(4 * 1024)
    expect(script.calls![1]!.input).toBe(JSON.stringify(big))
  })
})
