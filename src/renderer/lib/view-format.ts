import type { ViewFormat, ViewTone } from '@shared/view-spec'

/**
 * Series colours, in a fixed order, so a series keeps its colour wherever it appears: a checked categorical palette
 * with a step for dark and one for light themes (see `--view-series-*` in index.css). The status colours (ok, warn,
 * danger) are kept for meaning and are not used for series.
 */
export const SERIES_COLORS = [
  'var(--view-series-1)',
  'var(--view-series-2)',
  'var(--view-series-3)',
  'var(--view-series-4)',
  'var(--view-series-5)',
  'var(--view-series-6)',
] as const

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length]!
}

export const TONE_COLORS: Record<ViewTone, string> = {
  neutral: 'var(--color-fg-muted)',
  info: 'var(--color-accent)',
  ok: 'var(--color-ok)',
  warn: 'var(--color-warn)',
  danger: 'var(--color-danger)',
}

const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const FULL = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })
const PERCENT = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 })

/** 1,284 in full below 10,000; 12.9K, 4.2M above. */
export function formatNumber(value: number): string {
  return Math.abs(value) < 10_000 ? FULL.format(value) : COMPACT.format(value)
}

export function formatValue(value: number, unit?: string): string {
  const text = formatNumber(value)
  if (!unit) return text
  // A currency sign goes before the number, everything else after it.
  return /^[$€£¥]$/.test(unit) ? `${unit}${text}` : unit === '%' ? `${text}%` : `${text} ${unit}`
}

export function formatCell(value: string | number | null, format: ViewFormat): string {
  if (value === null) return ''
  if (typeof value === 'string') return value
  if (format === 'percent') return PERCENT.format(value)
  return format === 'number' ? FULL.format(value) : String(value)
}

/** "+12", "−3.5": a change, always signed. */
export function formatDelta(value: number): string {
  const text = formatNumber(Math.abs(value))
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : '0'
}

export interface Scale {
  min: number
  max: number
  ticks: number[]
}

/** Clean ticks (1, 2, 2.5 or 5 times a power of ten) that cover `min`..`max`, about `count` of them. */
export function niceScale(min: number, max: number, count = 4): Scale {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] }
  if (min === max) {
    if (min === 0) return { min: 0, max: 1, ticks: [0, 0.5, 1] }
    const pad = Math.abs(min) * 0.1
    min -= min > 0 ? Math.min(pad, min) : pad
    max += pad
  }
  const raw = (max - min) / count
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 2.5, 5, 10].find((factor) => factor * power >= raw) ?? 10) * power
  const low = Math.floor(min / step + 1e-9) * step
  const high = Math.ceil(max / step - 1e-9) * step
  const ticks: number[] = []
  for (let tick = low; tick <= high + step / 2; tick += step) ticks.push(Math.abs(tick) < step / 1e6 ? 0 : Number(tick.toPrecision(12)))
  return { min: low, max: high, ticks }
}
