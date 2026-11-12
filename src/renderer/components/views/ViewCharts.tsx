import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { ViewNode, ViewSeries } from '@shared/view-spec'
import { formatNumber, formatValue, niceScale, seriesColor } from '@/lib/view-format'
import { cn } from '@/lib/utils'

type Bar = Extract<ViewNode, { type: 'BarChart' }>
type Line = Extract<ViewNode, { type: 'LineChart' }>
type Donut = Extract<ViewNode, { type: 'DonutChart' }>

/*
 * The charts a view can hold, drawn as SVG from checked data. Marks are thin and quiet: bars at most 24 px thick
 * with a rounded end away from the baseline, 2 px lines, hairline gridlines, one value axis, a legend from two
 * series on, and the values on hover. Text always uses the text colours; only the marks carry series colours.
 */

const FONT = 11
const CHAR = 6.4
const PLOT_HEIGHT = 200
const BAR_MAX = 24
const GAP = 2

/** The width the chart has to draw in, followed as the chat is resized. */
function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(520)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const measure = (): void => {
      const next = Math.round(element.clientWidth)
      if (next > 0) setWidth((current) => (Math.abs(current - next) >= 1 ? next : current))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

/** Where the pointer is inside the chart's SVG. */
function svgPoint(event: React.MouseEvent<SVGElement>): { x: number; y: number } {
  const svg = event.currentTarget instanceof SVGSVGElement ? event.currentTarget : event.currentTarget.ownerSVGElement
  const box = svg?.getBoundingClientRect()
  return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) }
}

function textWidth(text: string): number {
  return text.length * CHAR
}

function ellipsis(text: string, width: number): string {
  const fits = Math.floor(width / CHAR)
  return text.length <= fits ? text : fits <= 1 ? '' : `${text.slice(0, fits - 1)}…`
}

/** A rectangle with 4 px rounded corners on the end away from the baseline; `toward` is where the value points. */
function barPath(x: number, y: number, width: number, height: number, toward: 'up' | 'down' | 'right' | 'left'): string {
  const r = Math.max(0, Math.min(4, (toward === 'up' || toward === 'down' ? height : width) / 2, (toward === 'up' || toward === 'down' ? width : height) / 2))
  const [x2, y2] = [x + width, y + height]
  switch (toward) {
    case 'up':
      return `M${x},${y2}V${y + r}Q${x},${y} ${x + r},${y}H${x2 - r}Q${x2},${y} ${x2},${y + r}V${y2}Z`
    case 'down':
      return `M${x},${y}V${y2 - r}Q${x},${y2} ${x + r},${y2}H${x2 - r}Q${x2},${y2} ${x2},${y2 - r}V${y}Z`
    case 'right':
      return `M${x},${y}H${x2 - r}Q${x2},${y} ${x2},${y + r}V${y2 - r}Q${x2},${y2} ${x2 - r},${y2}H${x}Z`
    case 'left':
      return `M${x2},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y2 - r}Q${x},${y2} ${x + r},${y2}H${x2}Z`
  }
}

export function Legend({ names }: { names: string[] }): JSX.Element | null {
  if (names.length < 2) return null
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-fg-muted" data-testid="view-legend">
      {names.map((name, index) => (
        <li key={index} className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: seriesColor(index) }} />
          <span className="truncate">{name}</span>
        </li>
      ))}
    </ul>
  )
}

interface TooltipState {
  x: number
  y: number
  title: string
  rows: Array<{ color: string; name: string; value: string }>
}

function Tooltip({ state, width }: { state: TooltipState | null; width: number }): JSX.Element | null {
  if (!state) return null
  const left = Math.min(Math.max(state.x + 12, 0), Math.max(0, width - 180))
  return (
    <div
      role="presentation"
      data-testid="view-tooltip"
      className="pointer-events-none absolute z-10 min-w-[120px] max-w-[220px] rounded-md border border-line bg-elevated px-2.5 py-1.5 text-[11.5px] shadow-lg"
      style={{ left, top: Math.max(0, state.y - 8) }}
    >
      <p className="mb-0.5 truncate font-medium text-fg">{state.title}</p>
      {state.rows.map((row, index) => (
        <p key={index} className="flex items-center gap-1.5 text-fg-muted">
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color }} />
          <span className="min-w-0 flex-1 truncate">{row.name}</span>
          <span className="tabular-nums text-fg">{row.value}</span>
        </p>
      ))}
    </div>
  )
}

function ChartFrame({ title, label, children, legend }: { title?: string; label: string; children: (width: number) => ReactNode; legend?: string[] }): JSX.Element {
  const [ref, width] = useWidth()
  return (
    <figure className="m-0 min-w-0" data-testid="view-chart">
      {title && <figcaption className="mb-1.5 text-[12.5px] font-medium text-fg">{title}</figcaption>}
      <div ref={ref} className="relative min-w-0" role="img" aria-label={label}>
        {children(width)}
      </div>
      {legend && <Legend names={legend} />}
    </figure>
  )
}

function seriesLabel(series: ViewSeries[], count: number, noun: string): string {
  return `${series.length === 1 ? series[0]!.name : `${series.length} series`} over ${count} ${noun}${count === 1 ? '' : 's'}`
}

function seriesRows(series: ViewSeries[], index: number, unit?: string): TooltipState['rows'] {
  return series.map((entry, position) => ({
    color: seriesColor(position),
    name: entry.name,
    value: entry.data[index] === null || entry.data[index] === undefined ? '—' : formatValue(entry.data[index]!, unit),
  }))
}

/** The extent of the values, including 0; stacked bars add up per category. */
function barExtent(chart: Bar): [number, number] {
  let min = 0
  let max = 0
  chart.categories.forEach((_category, index) => {
    if (chart.stacked) {
      const total = chart.series.reduce((sum, entry) => sum + (entry.data[index] ?? 0), 0)
      max = Math.max(max, total)
    } else {
      for (const entry of chart.series) {
        const value = entry.data[index]
        if (value === null || value === undefined) continue
        min = Math.min(min, value)
        max = Math.max(max, value)
      }
    }
  })
  return [min, max]
}

export function BarChartView({ chart }: { chart: Bar }): JSX.Element {
  const [hover, setHover] = useState<TooltipState | null>(null)
  const [min, max] = barExtent(chart)
  const scale = niceScale(min, max)
  const names = chart.series.map((entry) => entry.name)
  const label = `Bar chart: ${seriesLabel(chart.series, chart.categories.length, 'category')}`
  return (
    <ChartFrame title={chart.title} label={label} legend={names}>
      {(width) => {
        const tickText = scale.ticks.map((tick) => formatValue(tick, chart.unit))
        if (chart.horizontal) {
          const labelWidth = Math.min(Math.max(...chart.categories.map(textWidth), 24) + 16, width * 0.35)
          const thickness = 14
          const band = Math.max(22, (chart.stacked ? 1 : chart.series.length) * (thickness + GAP) + 10)
          const top = 4
          const height = top + chart.categories.length * band + 20
          const plotLeft = labelWidth
          const plotWidth = Math.max(40, width - plotLeft - 12)
          const x = (value: number): number => plotLeft + ((value - scale.min) / (scale.max - scale.min)) * plotWidth
          const zero = x(0)
          return (
            <>
              <svg width={width} height={height} className="block overflow-visible" onMouseLeave={() => setHover(null)}>
                {scale.ticks.map((tick, index) => (
                  <g key={index}>
                    <line x1={x(tick)} x2={x(tick)} y1={top} y2={height - 20} stroke="var(--color-line)" strokeWidth={1} />
                    <text x={x(tick)} y={height - 6} fontSize={FONT} textAnchor="middle" fill="var(--color-fg-subtle)" className="tabular-nums">{tickText[index]}</text>
                  </g>
                ))}
                {chart.categories.map((category, index) => {
                  const y0 = top + index * band
                  const perBar = chart.stacked ? 1 : chart.series.length
                  const groupHeight = perBar * thickness + GAP * (perBar - 1)
                  let sum = 0
                  const marks = chart.series.map((entry, position) => {
                    const value = entry.data[index]
                    if (value === null || value === undefined || value === 0) return null
                    const last = !chart.stacked || chart.series.slice(position + 1).every((next) => !next.data[index])
                    const y = y0 + (band - groupHeight) / 2 + (chart.stacked ? 0 : position * (thickness + GAP))
                    const from = chart.stacked ? x(sum) : zero
                    sum += value
                    const to = chart.stacked ? x(sum) : x(value)
                    const left = Math.min(from, to)
                    const span = Math.max(0, Math.abs(to - from) - (last ? 0 : GAP))
                    return last
                      ? <path key={position} d={barPath(left, y, span, thickness, value >= 0 ? 'right' : 'left')} fill={seriesColor(position)} />
                      : <rect key={position} x={left} y={y} width={span} height={thickness} fill={seriesColor(position)} />
                  })
                  return (
                    <g key={index}>
                      <text x={plotLeft - 8} y={y0 + band / 2 + 4} fontSize={FONT} textAnchor="end" fill="var(--color-fg-muted)">{ellipsis(category, labelWidth - 8)}</text>
                      {marks}
                      <rect
                        x={0}
                        y={y0}
                        width={width}
                        height={band}
                        fill="transparent"
                        onMouseMove={(event) => setHover({ x: svgPoint(event).x, y: y0 + band, title: category, rows: seriesRows(chart.series, index, chart.unit) })}
                      />
                    </g>
                  )
                })}
              </svg>
              <Tooltip state={hover} width={width} />
            </>
          )
        }
        const axisWidth = Math.max(...tickText.map(textWidth)) + 10
        const top = 6
        const bottom = 22
        const plotLeft = axisWidth
        const plotWidth = Math.max(40, width - plotLeft - 4)
        const height = top + PLOT_HEIGHT + bottom
        const y = (value: number): number => top + PLOT_HEIGHT - ((value - scale.min) / (scale.max - scale.min)) * PLOT_HEIGHT
        const band = plotWidth / Math.max(1, chart.categories.length)
        const perBar = chart.stacked ? 1 : chart.series.length
        const thickness = Math.max(2, Math.min(BAR_MAX, (band * 0.72 - GAP * (perBar - 1)) / perBar))
        const every = Math.max(1, Math.ceil(chart.categories.reduce((most, category) => Math.max(most, textWidth(category) + 8), 0) / band))
        const zero = y(0)
        return (
          <>
            <svg width={width} height={height} className="block overflow-visible" onMouseLeave={() => setHover(null)}>
              {scale.ticks.map((tick, index) => (
                <g key={index}>
                  <line x1={plotLeft} x2={width} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? 'var(--color-line-strong)' : 'var(--color-line)'} strokeWidth={1} />
                  <text x={plotLeft - 6} y={y(tick) + 4} fontSize={FONT} textAnchor="end" fill="var(--color-fg-subtle)" className="tabular-nums">{tickText[index]}</text>
                </g>
              ))}
              {chart.categories.map((category, index) => {
                const center = plotLeft + band * index + band / 2
                const groupWidth = perBar * thickness + GAP * (perBar - 1)
                let stacked = 0
                const marks = chart.series.map((entry, position) => {
                  const value = entry.data[index]
                  if (value === null || value === undefined || value === 0) return null
                  const x = chart.stacked ? center - thickness / 2 : center - groupWidth / 2 + position * (thickness + GAP)
                  if (chart.stacked) {
                    const last = chart.series.slice(position + 1).every((next) => !next.data[index])
                    const from = y(stacked)
                    stacked += value
                    const to = y(stacked)
                    const height = Math.max(0, from - to - (position > 0 ? GAP : 0))
                    return last
                      ? <path key={position} d={barPath(x, to, thickness, height, 'up')} fill={seriesColor(position)} />
                      : <rect key={position} x={x} y={to} width={thickness} height={height} fill={seriesColor(position)} />
                  }
                  const end = y(value)
                  return <path key={position} d={barPath(x, Math.min(end, zero), thickness, Math.abs(zero - end), value >= 0 ? 'up' : 'down')} fill={seriesColor(position)} />
                })
                return (
                  <g key={index}>
                    {marks}
                    {index % every === 0 && (
                      <text x={center} y={height - 6} fontSize={FONT} textAnchor="middle" fill="var(--color-fg-muted)">{ellipsis(category, band * every - 6)}</text>
                    )}
                    <rect
                      x={plotLeft + band * index}
                      y={top}
                      width={band}
                      height={PLOT_HEIGHT}
                      fill="transparent"
                      onMouseMove={(event) => setHover({ ...svgPoint(event), title: category, rows: seriesRows(chart.series, index, chart.unit) })}
                    />
                  </g>
                )
              })}
            </svg>
            <Tooltip state={hover} width={width} />
          </>
        )
      }}
    </ChartFrame>
  )
}

/** The pieces of a series' line, broken where a value is missing. */
function lineRuns(data: Array<number | null>): Array<Array<[number, number]>> {
  const runs: Array<Array<[number, number]>> = []
  let run: Array<[number, number]> = []
  data.forEach((value, index) => {
    if (value === null) {
      if (run.length) runs.push(run)
      run = []
    } else run.push([index, value])
  })
  if (run.length) runs.push(run)
  return runs
}

export function LineChartView({ chart }: { chart: Line }): JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  const values = chart.series.flatMap((entry) => entry.data.filter((value): value is number => value !== null))
  const scale = niceScale(chart.area ? Math.min(0, ...values) : Math.min(...values), chart.area ? Math.max(0, ...values) : Math.max(...values))
  const names = chart.series.map((entry) => entry.name)
  const label = `${chart.area ? 'Area' : 'Line'} chart: ${seriesLabel(chart.series, chart.x.length, 'point')}`
  return (
    <ChartFrame title={chart.title} label={label} legend={names}>
      {(width) => {
        const tickText = scale.ticks.map((tick) => formatValue(tick, chart.unit))
        const top = 8
        const bottom = 22
        const plotLeft = Math.max(...tickText.map(textWidth)) + 10
        const plotWidth = Math.max(40, width - plotLeft - 8)
        const height = top + PLOT_HEIGHT + bottom
        const count = chart.x.length
        const x = (index: number): number => plotLeft + (count <= 1 ? plotWidth / 2 : (index / (count - 1)) * plotWidth)
        const y = (value: number): number => top + PLOT_HEIGHT - ((value - scale.min) / (scale.max - scale.min)) * PLOT_HEIGHT
        const step = count <= 1 ? plotWidth : plotWidth / (count - 1)
        const every = Math.max(1, Math.ceil(chart.x.reduce((most, entry) => Math.max(most, textWidth(entry) + 10), 0) / step))
        const base = y(Math.max(scale.min, Math.min(0, scale.max)))
        const point = (event: React.MouseEvent<SVGRectElement>): void => {
          const offset = svgPoint(event).x - plotLeft
          setHover(Math.max(0, Math.min(count - 1, Math.round(offset / Math.max(step, 1)))))
        }
        return (
          <>
            <svg width={width} height={height} className="block overflow-visible" onMouseLeave={() => setHover(null)}>
              {scale.ticks.map((tick, index) => (
                <g key={index}>
                  <line x1={plotLeft} x2={width} y1={y(tick)} y2={y(tick)} stroke="var(--color-line)" strokeWidth={1} />
                  <text x={plotLeft - 6} y={y(tick) + 4} fontSize={FONT} textAnchor="end" fill="var(--color-fg-subtle)" className="tabular-nums">{tickText[index]}</text>
                </g>
              ))}
              {chart.x.map((entry, index) => index % every === 0 ? (
                <text key={index} x={x(index)} y={height - 6} fontSize={FONT} textAnchor={index === 0 && count > 1 ? 'start' : index === count - 1 && count > 1 ? 'end' : 'middle'} fill="var(--color-fg-muted)">{ellipsis(entry, step * every - 6)}</text>
              ) : null)}
              {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={top} y2={top + PLOT_HEIGHT} stroke="var(--color-line-strong)" strokeWidth={1} />}
              {chart.series.map((entry, position) => lineRuns(entry.data).map((run, index) => {
                const d = run.map(([at, value], order) => `${order === 0 ? 'M' : 'L'}${x(at)},${y(value)}`).join('')
                return (
                  <g key={`${position}-${index}`}>
                    {chart.area && run.length > 1 && (
                      <path d={`${d}L${x(run[run.length - 1]![0])},${base}L${x(run[0]![0])},${base}Z`} fill={seriesColor(position)} fillOpacity={0.1} />
                    )}
                    <path d={d} fill="none" stroke={seriesColor(position)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    {run.length === 1 && <circle cx={x(run[0]![0])} cy={y(run[0]![1])} r={2.5} fill={seriesColor(position)} />}
                  </g>
                )
              }))}
              {hover !== null && chart.series.map((entry, position) => {
                const value = entry.data[hover]
                return value === null || value === undefined ? null : (
                  <circle key={position} cx={x(hover)} cy={y(value)} r={4} fill={seriesColor(position)} stroke="var(--color-panel)" strokeWidth={2} />
                )
              })}
              <rect x={plotLeft - step / 2} y={top} width={plotWidth + step} height={PLOT_HEIGHT} fill="transparent" onMouseMove={point} />
            </svg>
            <Tooltip
              state={hover === null ? null : { x: x(hover), y: top + 8, title: chart.x[hover] ?? '', rows: seriesRows(chart.series, hover, chart.unit) }}
              width={width}
            />
          </>
        )
      }}
    </ChartFrame>
  )
}

function arc(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  const point = (radius: number, angle: number): string => `${cx + radius * Math.sin(angle)},${cy - radius * Math.cos(angle)}`
  const large = end - start > Math.PI ? 1 : 0
  return `M${point(outer, start)}A${outer},${outer} 0 ${large} 1 ${point(outer, end)}L${point(inner, end)}A${inner},${inner} 0 ${large} 0 ${point(inner, start)}Z`
}

export function DonutChartView({ chart }: { chart: Donut }): JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  const total = chart.segments.reduce((sum, segment) => sum + segment.value, 0)
  const size = 168
  const center = size / 2
  const outer = center - 2
  const inner = outer - 22
  let angle = 0
  const share = (value: number): string => (total > 0 ? `${Math.round((value / total) * 1000) / 10}%` : '0%')
  return (
    <figure className="m-0 min-w-0" data-testid="view-chart">
      {chart.title && <figcaption className="mb-1.5 text-[12.5px] font-medium text-fg">{chart.title}</figcaption>}
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative shrink-0" role="img" aria-label={`Donut chart: ${chart.segments.map((segment) => `${segment.label} ${share(segment.value)}`).join(', ')}`}>
          <svg width={size} height={size} className="block" onMouseLeave={() => setHover(null)}>
            {total === 0 && <circle cx={center} cy={center} r={outer - 11} fill="none" stroke="var(--color-line)" strokeWidth={22} />}
            {chart.segments.map((segment, index) => {
              const sweep = total > 0 ? (segment.value / total) * Math.PI * 2 : 0
              const start = angle
              angle += sweep
              if (sweep <= 0) return null
              // A whole circle cannot be one arc; it is drawn as two halves.
              const d = sweep >= Math.PI * 2 - 1e-6
                ? `${arc(center, center, outer, inner, 0, Math.PI)}${arc(center, center, outer, inner, Math.PI, Math.PI * 2)}`
                : arc(center, center, outer, inner, start, start + sweep)
              return (
                <path
                  key={index}
                  d={d}
                  fill={seriesColor(index)}
                  stroke="var(--color-panel)"
                  strokeWidth={GAP}
                  opacity={hover === null || hover === index ? 1 : 0.45}
                  onMouseEnter={() => setHover(index)}
                />
              )
            })}
            <text x={center} y={center + 2} fontSize={18} fontWeight={600} textAnchor="middle" fill="var(--color-fg)">
              {hover !== null ? share(chart.segments[hover]!.value) : chart.total ?? formatValue(total, chart.unit)}
            </text>
            <text x={center} y={center + 18} fontSize={FONT} textAnchor="middle" fill="var(--color-fg-subtle)">
              {hover !== null ? ellipsis(chart.segments[hover]!.label, inner * 2 - 16) : 'total'}
            </text>
          </svg>
        </div>
        <ul className="flex min-w-[140px] flex-1 flex-col gap-1 text-[12px]" data-testid="view-legend">
          {chart.segments.map((segment, index) => (
            <li
              key={index}
              className={cn('flex items-center gap-2 rounded px-1 text-fg-muted', hover === index && 'bg-hover')}
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
            >
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: seriesColor(index) }} />
              <span className="min-w-0 flex-1 truncate">{segment.label}</span>
              <span className="tabular-nums text-fg">{formatValue(segment.value, chart.unit)}</span>
              <span className="w-12 text-right tabular-nums text-fg-subtle">{share(segment.value)}</span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  )
}

/** A small trend line, for a stat or on its own; the last value is marked. */
export function Sparkline({ data, width = 96, height = 24, label }: { data: number[]; width?: number; height?: number; label?: string }): JSX.Element {
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const x = (index: number): number => 2 + (index / Math.max(1, data.length - 1)) * (width - 6)
  const y = (value: number): number => 3 + (1 - (value - min) / span) * (height - 6)
  const d = data.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(value)}`).join('')
  const last = data.length - 1
  return (
    <svg width={width} height={height} className="block shrink-0" role="img" aria-label={label ?? `Trend from ${formatNumber(data[0]!)} to ${formatNumber(data[last]!)}`}>
      <path d={d} fill="none" stroke="var(--color-fg-subtle)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(data[last]!)} r={2.5} fill="var(--color-accent)" />
    </svg>
  )
}
