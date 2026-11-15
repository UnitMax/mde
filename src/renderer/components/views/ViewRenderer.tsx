import { Component, useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChartColumn, CircleAlert, CircleCheck, Info, Table2, TriangleAlert } from 'lucide-react'
import type { View, ViewColumn, ViewNode, ViewTone } from '@shared/view-spec'
import { BarChartView, DonutChartView, LineChartView, Sparkline } from '@/components/views/ViewCharts'
import { formatCell, formatDelta, formatValue, TONE_COLORS } from '@/lib/view-format'
import { cn } from '@/lib/utils'

/*
 * Draws a checked view (see @shared/view-spec). Every component is MDE's own, and the agent's text only ever
 * reaches the page as React text: there is no HTML, no Markdown, no link, no image and no style from the agent.
 */

const GAPS = { sm: 'gap-2', md: 'gap-3', lg: 'gap-5' } as const

const TONE_TEXT: Record<ViewTone, string> = {
  neutral: 'text-fg-muted',
  info: 'text-accent',
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
}

const TONE_ICONS = { info: Info, ok: CircleCheck, warn: TriangleAlert, danger: CircleAlert } as const

type Table = Extract<ViewNode, { type: 'Table' }>
type Chart = Extract<ViewNode, { type: 'BarChart' | 'LineChart' }>

function compare(a: string | number | null, b: string | number | null): number {
  if (a === null) return b === null ? 0 : 1
  if (b === null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

export function ViewTable({ columns, rows }: { columns: ViewColumn[]; rows: Table['rows'] }): JSX.Element {
  const [sort, setSort] = useState<{ column: number; descending: boolean } | null>(null)
  const sorted = useMemo(() => {
    if (!sort) return rows
    const order = rows.map((row, index) => ({ row, index }))
    order.sort((a, b) => {
      const result = compare(a.row[sort.column] ?? null, b.row[sort.column] ?? null)
      // Empty cells stay last either way.
      if (a.row[sort.column] === null || b.row[sort.column] === null) return result || a.index - b.index
      return (sort.descending ? -result : result) || a.index - b.index
    })
    return order.map((entry) => entry.row)
  }, [rows, sort])
  return (
    <div className="max-h-[420px] min-w-0 overflow-auto rounded-md border border-line" data-testid="view-table">
      <table className="w-full border-collapse text-[12.5px]">
        <thead className="sticky top-0 bg-elevated">
          <tr>
            {columns.map((column, index) => {
              const active = sort?.column === index
              return (
                <th
                  key={index}
                  scope="col"
                  aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}
                  className={cn('border-b border-line px-2.5 py-1.5 font-medium text-fg-muted', column.align === 'right' ? 'text-right' : 'text-left')}
                >
                  <button
                    type="button"
                    className={cn('inline-flex items-center gap-1 hover:text-fg', active && 'text-fg', column.align === 'right' && 'flex-row-reverse')}
                    onClick={() => setSort(active ? (sort.descending ? null : { column: index, descending: true }) : { column: index, descending: false })}
                  >
                    {column.label}
                    {active && (sort.descending ? <ArrowDown aria-hidden className="h-3 w-3" /> : <ArrowUp aria-hidden className="h-3 w-3" />)}
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-line/60 last:border-b-0 hover:bg-hover/60">
              {columns.map((column, index) => (
                <td key={index} className={cn('px-2.5 py-1 text-fg', column.align === 'right' && 'text-right tabular-nums')}>
                  {formatCell(row[index] ?? null, column.format)}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} className="px-2.5 py-2 text-fg-subtle">No rows</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

/** A chart, with its numbers one click away as a table. */
function ChartBlock({ chart }: { chart: Chart }): JSX.Element {
  const [table, setTable] = useState(false)
  const labels = chart.type === 'BarChart' ? chart.categories : chart.x
  const columns: ViewColumn[] = [
    { label: '', align: 'left', format: 'text' },
    ...chart.series.map((entry): ViewColumn => ({ label: entry.name, align: 'right', format: 'number' })),
  ]
  const rows = labels.map((label, index) => [label, ...chart.series.map((entry) => entry.data[index] ?? null)])
  return (
    <div className="group/chart relative min-w-0">
      <button
        type="button"
        aria-pressed={table}
        title={table ? 'Show the chart' : 'Show the numbers as a table'}
        aria-label={table ? 'Show the chart' : 'Show the numbers as a table'}
        onClick={() => setTable((value) => !value)}
        className="absolute right-0 top-0 z-10 rounded p-1 text-fg-subtle opacity-0 transition-opacity hover:bg-hover hover:text-fg focus-visible:opacity-100 group-hover/chart:opacity-100"
      >
        {table ? <ChartColumn className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}
      </button>
      {table ? (
        <div>
          {chart.title && <p className="mb-1.5 text-[12.5px] font-medium text-fg">{chart.title}</p>}
          <ViewTable columns={columns} rows={rows} />
        </div>
      ) : chart.type === 'BarChart' ? <BarChartView chart={chart} /> : <LineChartView chart={chart} />}
    </div>
  )
}

function Tabs({ node }: { node: Extract<ViewNode, { type: 'Tabs' }> }): JSX.Element {
  const [current, setCurrent] = useState(0)
  const child = node.children[current]
  return (
    <div className="min-w-0">
      <div role="tablist" className="mb-3 flex flex-wrap gap-1 border-b border-line">
        {node.tabs.map((tab, index) => (
          <button
            key={index}
            type="button"
            role="tab"
            aria-selected={index === current}
            onClick={() => setCurrent(index)}
            className={cn(
              '-mb-px border-b-2 px-2.5 py-1.5 text-[12.5px] transition-colors',
              index === current ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {tab}
          </button>
        ))}
      </div>
      <div role="tabpanel">{child && <ViewNodeView node={child} />}</div>
    </div>
  )
}

function Stat({ node }: { node: Extract<ViewNode, { type: 'Stat' }> }): JSX.Element {
  const value = typeof node.value === 'number' ? formatValue(node.value, node.unit) : node.unit ? `${node.value} ${node.unit}` : node.value
  const better = node.delta === undefined || node.delta === 0 || node.good === 'none' ? null : (node.delta > 0) === (node.good === 'up')
  return (
    <div className="min-w-0 rounded-md border border-line bg-panel px-3 py-2.5" data-testid="view-stat">
      <p className="truncate text-[12px] text-fg-muted">{node.label}</p>
      <p className="mt-0.5 truncate text-[22px] font-semibold leading-tight text-fg" title={value}>{value}</p>
      {(node.delta !== undefined || node.trend) && (
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11.5px]">
          {node.delta !== undefined && (
            <span className={cn('shrink-0 tabular-nums font-medium', better === null ? 'text-fg-muted' : better ? 'text-ok' : 'text-danger')}>
              {formatDelta(node.delta)}{node.unit === '%' ? '%' : ''}
            </span>
          )}
          {node.deltaLabel && node.delta !== undefined && <span className="min-w-0 truncate text-fg-subtle">{node.deltaLabel}</span>}
          {node.trend && <span className="ml-auto shrink-0"><Sparkline data={node.trend} width={56} height={18} label={`${node.label} trend`} /></span>}
        </div>
      )}
    </div>
  )
}

function ViewNodeView({ node }: { node: ViewNode }): JSX.Element {
  switch (node.type) {
    case 'Stack':
      return (
        <div className={cn('flex min-w-0', node.direction === 'horizontal' ? 'flex-row flex-wrap items-start' : 'flex-col', GAPS[node.gap])}>
          {node.children.map((child) => <ViewNodeView key={child.id} node={child} />)}
        </div>
      )
    case 'Grid':
      return (
        <div className="view-grid min-w-0" data-columns={node.columns}>
          {node.children.map((child) => <div key={child.id} className="min-w-0"><ViewNodeView node={child} /></div>)}
        </div>
      )
    case 'Card':
      return (
        <section className="min-w-0 rounded-lg border border-line bg-panel/60 p-3">
          {node.title && <h4 className="text-[13px] font-semibold text-fg">{node.title}</h4>}
          {node.description && <p className="mt-0.5 whitespace-pre-line text-[12px] text-fg-muted">{node.description}</p>}
          {node.children.length > 0 && (
            <div className={cn('flex min-w-0 flex-col gap-3', (node.title || node.description) && 'mt-2.5')}>
              {node.children.map((child) => <ViewNodeView key={child.id} node={child} />)}
            </div>
          )}
        </section>
      )
    case 'Tabs':
      return <Tabs node={node} />
    case 'Heading': {
      const size = node.level === 1 ? 'text-[16px]' : node.level === 2 ? 'text-[14px]' : 'text-[13px]'
      return <p role="heading" aria-level={node.level + 2} className={cn('font-semibold text-fg', size)}>{node.text}</p>
    }
    case 'Text':
      return <p className={cn('whitespace-pre-line text-[13px] leading-relaxed', node.tone === 'muted' ? 'text-fg-muted' : 'text-[var(--chat-text)]')}>{node.text}</p>
    case 'Callout': {
      const Icon = TONE_ICONS[node.tone]
      return (
        <div className="flex min-w-0 gap-2 rounded-md border border-line bg-panel px-3 py-2" style={{ borderLeftColor: TONE_COLORS[node.tone], borderLeftWidth: 3 }}>
          <Icon aria-hidden className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', TONE_TEXT[node.tone])} />
          <div className="min-w-0">
            {node.title && <p className="text-[12.5px] font-medium text-fg">{node.title}</p>}
            <p className="whitespace-pre-line text-[12.5px] text-fg-muted">{node.text}</p>
          </div>
        </div>
      )
    }
    case 'Badge':
      return (
        <span className={cn('inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border border-line px-2 py-px text-[11.5px]', 'text-fg-muted')}>
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TONE_COLORS[node.tone] }} />
          <span className="truncate">{node.text}</span>
        </span>
      )
    case 'Divider':
      return <hr className="border-line" />
    case 'Stat':
      return <Stat node={node} />
    case 'Progress': {
      const share = Math.max(0, Math.min(1, node.value / node.max))
      return (
        <div className="min-w-0">
          <div className="mb-1 flex justify-between gap-2 text-[12px]">
            <span className="truncate text-fg-muted">{node.label}</span>
            <span className="tabular-nums text-fg">{formatValue(node.value)}{node.max !== 100 ? ` / ${formatValue(node.max)}` : '%'}</span>
          </div>
          <div
            role="meter"
            aria-label={node.label}
            aria-valuenow={node.value}
            aria-valuemin={0}
            aria-valuemax={node.max}
            className="h-1.5 overflow-hidden rounded-full bg-hover"
          >
            <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: TONE_COLORS[node.tone] }} />
          </div>
        </div>
      )
    }
    case 'KeyValue':
      return (
        <dl className="grid min-w-0 grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12.5px]">
          {node.items.map((item, index) => (
            <div key={index} className="contents">
              <dt className="truncate text-fg-muted">{item.key}</dt>
              <dd className="min-w-0 whitespace-pre-line break-words text-fg">{item.value}</dd>
            </div>
          ))}
        </dl>
      )
    case 'Table':
      return <ViewTable columns={node.columns} rows={node.rows} />
    case 'BarChart':
    case 'LineChart':
      return <ChartBlock chart={node} />
    case 'DonutChart':
      return <DonutChartView chart={node} />
    case 'Sparkline':
      return (
        <div className="flex min-w-0 items-center gap-2">
          {node.label && <span className="truncate text-[12px] text-fg-muted">{node.label}</span>}
          <Sparkline data={node.data} width={120} height={28} label={node.label} />
        </div>
      )
  }
}

/** A view whose drawing failed shows that instead of taking the conversation down with it. */
class ViewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override render(): ReactNode {
    if (this.state.failed) return <p className="text-[12.5px] text-danger">MDE could not draw this view.</p>
    return this.props.children
  }
}

export function ViewRenderer({ view }: { view: View }): JSX.Element {
  return (
    <ViewBoundary>
      <div className="min-w-0" data-testid="view">
        <ViewNodeView node={view.root} />
      </div>
    </ViewBoundary>
  )
}
