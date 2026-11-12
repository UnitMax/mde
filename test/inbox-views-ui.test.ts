// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolCallView } from '../src/renderer/components/inbox/ChatTools'
import { compactFlow } from '../src/renderer/lib/chat-tools'
import { niceScale } from '../src/renderer/lib/view-format'
import type { ChatPart } from '../src/shared/types'

type ToolPart = Extract<ChatPart, { kind: 'tool' }>

const view = {
  title: 'Latency',
  root: 'stack',
  elements: {
    stack: { type: 'Stack', children: ['note', 'p95', 'bars', 'table'] },
    note: { type: 'Text', props: { text: '<img src=x onerror="alert(1)">' } },
    p95: { type: 'Stat', props: { label: 'p95', value: 212, unit: 'ms', delta: -8, good: 'down' } },
    bars: { type: 'BarChart', props: { categories: ['api', 'web', 'db'], series: [{ name: 'p50', data: [20, 35, 5] }, { name: 'p95', data: [80, 120, null] }] } },
    table: { type: 'Table', props: { columns: ['service', { label: 'ms', format: 'number' }], rows: [['api', 80], ['web', 120], ['db', null]] } },
  },
}

function part(overrides: Partial<ToolPart> = {}): ToolPart {
  return { kind: 'tool', id: 'call_view', name: 'mde_show_view', status: 'completed', input: JSON.stringify(view), ...overrides }
}

let dispose: (() => void) | undefined
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(async () => {
  await act(async () => dispose?.())
  dispose = undefined
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

async function mount(toolPart: ToolPart): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  dispose = () => root.unmount()
  await act(async () => root.render(createElement(ToolCallView, { part: toolPart, directory: '/home/me/app' })))
  return container
}

const q = (selector: string, root: ParentNode = document.body): HTMLElement | null => root.querySelector<HTMLElement>(selector)

describe('a view in the chat', () => {
  it('draws the view the agent sent, with its text as text', async () => {
    const container = await mount(part())
    const card = q('[data-testid="chat-view-call_view"]', container)!
    expect(card.dataset.viewState).toBe('shown')
    expect(card.querySelector('h3')?.textContent).toBe('Latency')
    // Markup in the agent's text is shown, never parsed.
    expect(card.querySelector('img')).toBeNull()
    expect(card.textContent).toContain('<img src=x onerror="alert(1)">')
    expect(q('[data-testid="view-stat"]', card)?.textContent).toContain('212 ms')
    // A fall in a value whose good direction is down reads as good.
    expect(q('[data-testid="view-stat"] .text-ok', card)?.textContent).toBe('−8')
    // Two series: a legend, and one bar per value that is there (the empty one draws none).
    expect(q('[data-testid="view-legend"]', card)?.textContent).toBe('p50p95')
    expect(card.querySelectorAll('[data-testid="view-chart"] path[fill^="var(--view-series-"]')).toHaveLength(5)
  })

  it('shows the JSON the agent sent on request', async () => {
    const container = await mount(part())
    const toggle = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'JSON')!
    await act(async () => toggle.click())
    expect(q('[data-testid="view"]', container)).toBeNull()
    expect(container.querySelector('pre')?.textContent).toContain('"title": "Latency"')
  })

  it('sorts a table by a column, keeping empty cells last', async () => {
    const container = await mount(part())
    const table = q('[data-testid="view-table"]', container)!
    const header = table.querySelectorAll('th button')[1] as HTMLElement
    const cells = (): string[] => Array.from(table.querySelectorAll('tbody tr td:first-child')).map((cell) => cell.textContent ?? '')
    await act(async () => header.click())
    expect(cells()).toEqual(['api', 'web', 'db'])
    await act(async () => header.click())
    expect(cells()).toEqual(['web', 'api', 'db'])
  })

  it('switches a chart to its numbers as a table', async () => {
    const container = await mount(part())
    const toggle = container.querySelector<HTMLElement>('button[aria-label="Show the numbers as a table"]')!
    await act(async () => toggle.click())
    const tables = container.querySelectorAll('[data-testid="view-table"]')
    expect(tables).toHaveLength(2)
    expect(tables[0]!.textContent).toContain('p95')
  })

  it('says it is preparing while the arguments arrive, and why a view cannot be shown', async () => {
    let container = await mount(part({ status: 'running', input: '{"root":' }))
    expect(q('[data-testid="chat-view-call_view"]', container)?.dataset.viewState).toBe('pending')
    await act(async () => dispose?.())

    container = await mount(part({ status: 'error', error: 'MDE cannot show this view:\n- /root: must name one of the elements' }))
    const row = q('[data-testid="chat-view-call_view"]', container)!
    expect(row.dataset.viewState).toBe('error')
    expect(row.textContent).toContain('Could not show')
    await act(async () => dispose?.())

    container = await mount(part({ input: '{"root":"a","elements":{"a":{"type":"Video","props":{"src":"https://example.com/v.mp4"}}}}' }))
    expect(q('[data-testid="chat-view-call_view"]', container)?.dataset.viewState).toBe('error')
    expect(container.querySelector('video')).toBeNull()
    await act(async () => dispose?.())

    container = await mount(part({ input: '{"root":"a","elem', truncated: true }))
    expect(q('[data-testid="chat-view-call_view"]', container)?.dataset.viewState).toBe('error')
  })

  it('draws the views a script showed, below the row of its other calls', async () => {
    const container = await mount(part({
      name: 'execute',
      input: JSON.stringify({ code: 'await tools.mde.list_projects(); await tools.mde.show_view(v)' }, null, 2),
      calls: [
        { tool: 'mde.list_projects', status: 'completed', input: '{}' },
        { tool: 'mde.show_view', status: 'completed', input: JSON.stringify(view) },
      ],
    }))
    expect(q('[data-testid="chat-view-call_view"]', container)?.dataset.viewState).toBe('shown')
    expect(container.textContent).toContain('list_projects')
  })
})

describe('a view in the compact layout', () => {
  it('is drawn as itself with the words that lead up to it, not folded into the work', () => {
    const read: ToolPart = { kind: 'tool', id: 'read', name: 'read', status: 'completed', input: '{}' }
    const plan = compactFlow([{
      id: 'msg',
      live: false,
      parts: [read, { kind: 'text', text: 'Here is how the latency looks:' }, part(), { kind: 'text', text: 'The database is fine.' }],
    }]).get('msg')!
    expect(plan.map((block) => (block.kind === 'part' ? (block.part.kind === 'tool' ? block.part.id : block.part.kind) : block.kind)))
      .toEqual(['activity', 'text', 'call_view', 'text'])
  })
})

describe('chart scales', () => {
  it('picks clean ticks', () => {
    expect(niceScale(0, 124)).toEqual({ min: 0, max: 150, ticks: [0, 50, 100, 150] })
    expect(niceScale(-8, 30).ticks).toEqual([-10, 0, 10, 20, 30])
    expect(niceScale(5, 5)).toEqual({ min: 4.5, max: 5.5, ticks: [4.5, 4.75, 5, 5.25, 5.5] })
  })
})
