/**
 * Views: small dashboards, charts and tables an agent shows the person in the Inbox chat, through the MDE MCP's
 * `show_view` tool. A view is plain data in a fixed format (the idea of the format follows Vercel's json-render:
 * a `root` and a flat map of `elements`), never code: every component is one of MDE's own, every prop is checked
 * here, and what the renderer draws is the checked copy this module returns, never the agent's JSON.
 *
 * The bridge checks a view before it answers the agent, so the agent reads exactly what is wrong; the window
 * checks it again from the transcript before drawing it.
 */

/** The arguments of one `show_view` call, as compact JSON, may be at most this long. */
export const VIEW_SPEC_CHARS = 48_000
/** The parser keeps this much of a `show_view` call's arguments, so a view within the limit is never cut. */
export const VIEW_INPUT_LIMIT = 64 * 1024

export const VIEW_LIMITS = {
  elements: 150,
  depth: 8,
  children: 24,
  /** Text a `Text` or `Callout` holds. */
  text: 2000,
  /** Titles, labels and table cells. */
  label: 160,
  series: 6,
  points: 400,
  /** Numbers in the whole view: chart data, table cells and trends together. */
  numbers: 6000,
  rows: 200,
  columns: 10,
  segments: 8,
  tabs: 8,
  items: 40,
  /** The most errors one answer lists. */
  errors: 12,
} as const

export type ViewTone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger'
export type ViewGap = 'sm' | 'md' | 'lg'
export type ViewFormat = 'text' | 'number' | 'percent'

export interface ViewSeries {
  name: string
  data: Array<number | null>
}

export interface ViewColumn {
  label: string
  align: 'left' | 'right'
  format: ViewFormat
}

export type ViewNode = { id: string } & (
  | { type: 'Stack'; direction: 'vertical' | 'horizontal'; gap: ViewGap; children: ViewNode[] }
  | { type: 'Grid'; columns: 1 | 2 | 3 | 4; children: ViewNode[] }
  | { type: 'Card'; title?: string; description?: string; children: ViewNode[] }
  | { type: 'Tabs'; tabs: string[]; children: ViewNode[] }
  | { type: 'Heading'; text: string; level: 1 | 2 | 3 }
  | { type: 'Text'; text: string; tone: 'default' | 'muted' }
  | { type: 'Callout'; tone: Exclude<ViewTone, 'neutral'>; title?: string; text: string }
  | { type: 'Badge'; text: string; tone: ViewTone }
  | { type: 'Divider' }
  | { type: 'Stat'; label: string; value: string | number; unit?: string; delta?: number; deltaLabel?: string; good: 'up' | 'down' | 'none'; trend?: number[] }
  | { type: 'Progress'; label: string; value: number; max: number; tone: ViewTone }
  | { type: 'KeyValue'; items: Array<{ key: string; value: string }> }
  | { type: 'Table'; columns: ViewColumn[]; rows: Array<Array<string | number | null>> }
  | { type: 'BarChart'; title?: string; categories: string[]; series: ViewSeries[]; horizontal: boolean; stacked: boolean; unit?: string }
  | { type: 'LineChart'; title?: string; x: string[]; series: ViewSeries[]; area: boolean; unit?: string }
  | { type: 'DonutChart'; title?: string; segments: Array<{ label: string; value: number }>; unit?: string; total?: string }
  | { type: 'Sparkline'; label?: string; data: number[] }
)

export type ViewType = ViewNode['type']

export interface View {
  title?: string
  root: ViewNode
}

export type ViewCheck = { ok: true; view: View } | { ok: false; errors: string[] }

// ---------------------------------------------------------------------------------------------------------------
// The catalog: what the agent is told, next to how each component is read

type Children = 'none' | 'some'

interface ComponentSpec {
  children: Children
  /** Props as the agent reads them in the tool's description. */
  props: string
  doc: string
}

export const VIEW_COMPONENTS: Record<string, ComponentSpec> = {
  Stack: { children: 'some', props: 'direction?: "vertical"|"horizontal", gap?: "sm"|"md"|"lg"', doc: 'Lays its children out in a column (default) or a row.' },
  Grid: { children: 'some', props: 'columns: 1-4', doc: 'Lays its children out in equal columns; narrow windows get fewer.' },
  Card: { children: 'some', props: 'title?, description?', doc: 'A bordered panel around its children.' },
  Tabs: { children: 'some', props: 'tabs: string[] (one label per child)', doc: 'Shows one child at a time.' },
  Heading: { children: 'none', props: 'text, level?: 1|2|3', doc: 'A heading.' },
  Text: { children: 'none', props: 'text, tone?: "default"|"muted"', doc: 'Plain text; line breaks are kept. No Markdown.' },
  Callout: { children: 'none', props: 'text, title?, tone?: "info"|"ok"|"warn"|"danger"', doc: 'A highlighted note.' },
  Badge: { children: 'none', props: 'text, tone?: "neutral"|"info"|"ok"|"warn"|"danger"', doc: 'A small label.' },
  Divider: { children: 'none', props: '(none)', doc: 'A horizontal rule.' },
  Stat: {
    children: 'none',
    props: 'label, value: string|number, unit?, delta?: number, deltaLabel?: string (for example "vs last week"), good?: "up"|"down"|"none", trend?: number[]',
    doc: 'One headline number (KPI tile). `delta` is the signed change; `good` says which direction is good (default "up").',
  },
  Progress: { children: 'none', props: 'label, value: number, max?: number (default 100), tone?', doc: 'A meter.' },
  KeyValue: { children: 'none', props: 'items: {key, value}[]', doc: 'A list of labelled values.' },
  Table: {
    children: 'none',
    props: 'columns: (string | {label, align?: "left"|"right", format?: "text"|"number"|"percent"})[], rows: (string|number|null)[][]',
    doc: 'A sortable table. Each row is an array with one cell per column. "percent" cells are fractions (0.25 shows as 25%).',
  },
  BarChart: {
    children: 'none',
    props: 'categories: string[], series: {name, data: (number|null)[]}[], horizontal?: boolean, stacked?: boolean, unit?, title?',
    doc: 'Bars per category, one bar per series (or stacked). Each series has one value per category. Stacked values must not be negative.',
  },
  LineChart: {
    children: 'none',
    props: 'x: (string|number)[], series: {name, data: (number|null)[]}[], area?: boolean, unit?, title?',
    doc: 'Lines over `x`. Each series has one value per x; null leaves a gap.',
  },
  AreaChart: { children: 'none', props: 'as LineChart', doc: 'A LineChart with filled areas.' },
  DonutChart: { children: 'none', props: 'segments: {label, value}[], unit?, total?: string, title?', doc: 'Parts of a whole. Values must not be negative.' },
  Sparkline: { children: 'none', props: 'data: number[], label?', doc: 'A small inline trend line.' },
}

/** How to write a view, for the tool's description. */
export function viewCatalogText(): string {
  const components = Object.entries(VIEW_COMPONENTS)
    .map(([type, spec]) => `- ${type}${spec.children === 'some' ? ' (has children)' : ''}: ${spec.doc} Props: ${spec.props}.`)
    .join('\n')
  return [
    'A view is JSON: {"title"?: string, "root": "<id>", "elements": {"<id>": {"type": "<Component>", "props": {...}, "children"?: ["<id>", ...]}}}.',
    'Every element except the root is the child of exactly one other element. Only these components exist:',
    components,
    `Limits: ${VIEW_LIMITS.elements} elements, ${VIEW_LIMITS.depth} levels, ${VIEW_LIMITS.series} series per chart, ${VIEW_LIMITS.points} points per series,`,
    `${VIEW_LIMITS.rows} table rows, ${VIEW_LIMITS.numbers} numbers and ${VIEW_SPEC_CHARS} characters in all.`,
    'Colours, styles, HTML, Markdown, links and images are not available; the view takes MDE\'s theme.',
    'All data must be in the view itself: compute it first (read files, run commands), then show it.',
  ].join('\n')
}

// ---------------------------------------------------------------------------------------------------------------
// Reading a view

const ID = /^[A-Za-z0-9_-]{1,64}$/
/** Control characters other than the line break, and bidirectional formatting characters. */
const BAD_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x09], [0x0b, 0x1f], [0x7f, 0x9f], [0x61c, 0x61c], [0x200e, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069], [0x2028, 0x2029],
]

function hasBadText(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (BAD_RANGES.some(([from, to]) => code >= from && code <= to)) return true
  }
  return false
}
const MAX_NUMBER = 1e15

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

class Reader {
  readonly errors: string[] = []
  numbers = 0

  fail(path: string, message: string): undefined {
    if (this.errors.length < VIEW_LIMITS.errors) this.errors.push(`${path}: ${message}`)
    return undefined
  }

  keys(props: Json, path: string, allowed: readonly string[]): void {
    for (const key of Object.keys(props)) if (!allowed.includes(key)) this.fail(`${path}/${key}`, 'is not a prop of this component')
  }

  text(value: unknown, path: string, max: number, multiline = false): string | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    if (typeof value !== 'string') return this.fail(path, 'must be a string')
    if (value.length > max) return this.fail(path, `is longer than ${max} characters`)
    if (hasBadText(value) || (!multiline && value.includes('\n'))) return this.fail(path, multiline ? 'holds control characters' : 'must be one line without control characters')
    return value
  }

  required(props: Json, key: string, path: string, max: number = VIEW_LIMITS.label, multiline = false): string {
    if (props[key] === undefined || props[key] === null) {
      this.fail(`${path}/${key}`, 'is required')
      return ''
    }
    return this.text(props[key], `${path}/${key}`, max, multiline) ?? ''
  }

  optional(props: Json, key: string, path: string, max: number = VIEW_LIMITS.label): string | undefined {
    if (props[key] === undefined || props[key] === null) return undefined
    const text = this.text(props[key], `${path}/${key}`, max)
    return text?.trim() ? text : undefined
  }

  choice<T extends string | number>(props: Json, key: string, path: string, values: readonly T[], fallback: T): T {
    const value = props[key]
    if (value === undefined || value === null) return fallback
    if (!values.includes(value as T)) {
      this.fail(`${path}/${key}`, `must be one of ${values.map((entry) => JSON.stringify(entry)).join(', ')}`)
      return fallback
    }
    return value as T
  }

  flag(props: Json, key: string, path: string): boolean {
    const value = props[key]
    if (value === undefined || value === null) return false
    if (typeof value !== 'boolean') this.fail(`${path}/${key}`, 'must be true or false')
    return value === true
  }

  number(value: unknown, path: string): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_NUMBER) return this.fail(path, 'must be a finite number')
    this.count(path)
    return value
  }

  count(path: string, amount = 1): void {
    this.numbers += amount
    if (this.numbers > VIEW_LIMITS.numbers && this.numbers - amount <= VIEW_LIMITS.numbers) this.fail(path, `the view holds more than ${VIEW_LIMITS.numbers} numbers`)
  }

  list(value: unknown, path: string, max: number, min = 1): unknown[] {
    if (!Array.isArray(value)) {
      this.fail(path, 'must be an array')
      return []
    }
    if (value.length < min) this.fail(path, `needs at least ${min} ${min === 1 ? 'entry' : 'entries'}`)
    if (value.length > max) {
      this.fail(path, `has more than ${max} entries`)
      return value.slice(0, max)
    }
    return value
  }

  values(value: unknown, path: string, nulls: boolean): Array<number | null> {
    return this.list(value, path, VIEW_LIMITS.points).map((entry, index) => {
      if (entry === null && nulls) return null
      return this.number(entry, `${path}/${index}`) ?? null
    })
  }

  series(props: Json, path: string, length: number): ViewSeries[] {
    return this.list(props.series, `${path}/series`, VIEW_LIMITS.series).map((entry, index) => {
      const at = `${path}/series/${index}`
      if (!isRecord(entry)) {
        this.fail(at, 'must be an object {name, data}')
        return { name: '', data: [] }
      }
      this.keys(entry, at, ['name', 'data'])
      const name = this.required(entry, 'name', at)
      const data = this.values(entry.data, `${at}/data`, true)
      if (data.length !== length) this.fail(`${at}/data`, `has ${data.length} values for ${length} ${length === 1 ? 'label' : 'labels'}`)
      return { name, data }
    })
  }
}

/** A node without its id and children: what reading one component's props gives. */
type NodeProps = ViewNode extends infer T ? T extends unknown ? Omit<T, 'id' | 'children'> : never : never

/** Reads one component's props into the checked shape; children are filled in by the caller. */
function readProps(r: Reader, type: string, props: Json, path: string): NodeProps | null {
  switch (type) {
    case 'Stack':
      r.keys(props, path, ['direction', 'gap'])
      return { type, direction: r.choice(props, 'direction', path, ['vertical', 'horizontal'] as const, 'vertical'), gap: r.choice(props, 'gap', path, ['sm', 'md', 'lg'] as const, 'md') }
    case 'Grid':
      r.keys(props, path, ['columns'])
      return { type, columns: r.choice(props, 'columns', path, [1, 2, 3, 4] as const, 2) }
    case 'Card': {
      r.keys(props, path, ['title', 'description'])
      const title = r.optional(props, 'title', path)
      const description = r.optional(props, 'description', path, VIEW_LIMITS.text)
      return { type, ...(title ? { title } : {}), ...(description ? { description } : {}) }
    }
    case 'Tabs':
      r.keys(props, path, ['tabs'])
      return { type, tabs: r.list(props.tabs, `${path}/tabs`, VIEW_LIMITS.tabs).map((tab, index) => r.text(tab, `${path}/tabs/${index}`, 60) ?? '') }
    case 'Heading':
      r.keys(props, path, ['text', 'level'])
      return { type, text: r.required(props, 'text', path), level: r.choice(props, 'level', path, [1, 2, 3] as const, 2) }
    case 'Text':
      r.keys(props, path, ['text', 'tone'])
      return { type, text: r.required(props, 'text', path, VIEW_LIMITS.text, true), tone: r.choice(props, 'tone', path, ['default', 'muted'] as const, 'default') }
    case 'Callout': {
      r.keys(props, path, ['text', 'title', 'tone'])
      const title = r.optional(props, 'title', path)
      return {
        type,
        tone: r.choice(props, 'tone', path, ['info', 'ok', 'warn', 'danger'] as const, 'info'),
        ...(title ? { title } : {}),
        text: r.required(props, 'text', path, VIEW_LIMITS.text, true),
      }
    }
    case 'Badge':
      r.keys(props, path, ['text', 'tone'])
      return { type, text: r.required(props, 'text', path, 60), tone: r.choice(props, 'tone', path, ['neutral', 'info', 'ok', 'warn', 'danger'] as const, 'neutral') }
    case 'Divider':
      r.keys(props, path, [])
      return { type }
    case 'Stat': {
      r.keys(props, path, ['label', 'value', 'unit', 'delta', 'deltaLabel', 'good', 'trend'])
      const value = typeof props.value === 'number' ? r.number(props.value, `${path}/value`) ?? '' : r.required(props, 'value', path, 40)
      const unit = r.optional(props, 'unit', path, 20)
      const delta = props.delta === undefined || props.delta === null ? undefined : r.number(props.delta, `${path}/delta`)
      const deltaLabel = r.optional(props, 'deltaLabel', path, 60)
      const trend = props.trend === undefined || props.trend === null
        ? undefined
        : r.values(props.trend, `${path}/trend`, false).filter((entry): entry is number => entry !== null)
      return {
        type,
        label: r.required(props, 'label', path),
        value,
        ...(unit ? { unit } : {}),
        ...(delta !== undefined ? { delta } : {}),
        ...(deltaLabel ? { deltaLabel } : {}),
        good: r.choice(props, 'good', path, ['up', 'down', 'none'] as const, 'up'),
        ...(trend && trend.length > 1 ? { trend } : {}),
      }
    }
    case 'Progress': {
      r.keys(props, path, ['label', 'value', 'max', 'tone'])
      const value = r.number(props.value, `${path}/value`) ?? 0
      const max = props.max === undefined || props.max === null ? 100 : r.number(props.max, `${path}/max`) ?? 100
      if (max <= 0) r.fail(`${path}/max`, 'must be greater than 0')
      return { type, label: r.required(props, 'label', path), value, max: max > 0 ? max : 100, tone: r.choice(props, 'tone', path, ['neutral', 'info', 'ok', 'warn', 'danger'] as const, 'info') }
    }
    case 'KeyValue':
      r.keys(props, path, ['items'])
      return {
        type,
        items: r.list(props.items, `${path}/items`, VIEW_LIMITS.items).map((entry, index) => {
          const at = `${path}/items/${index}`
          if (!isRecord(entry)) {
            r.fail(at, 'must be an object {key, value}')
            return { key: '', value: '' }
          }
          r.keys(entry, at, ['key', 'value'])
          return { key: r.required(entry, 'key', at), value: r.required(entry, 'value', at, VIEW_LIMITS.text) }
        }),
      }
    case 'Table': {
      r.keys(props, path, ['columns', 'rows'])
      const columns = r.list(props.columns, `${path}/columns`, VIEW_LIMITS.columns).map((entry, index): ViewColumn => {
        const at = `${path}/columns/${index}`
        if (typeof entry === 'string') return { label: r.text(entry, at, 60) ?? '', align: 'left', format: 'text' }
        if (!isRecord(entry)) {
          r.fail(at, 'must be a string or an object {label, align?, format?}')
          return { label: '', align: 'left', format: 'text' }
        }
        r.keys(entry, at, ['label', 'align', 'format'])
        const format = r.choice(entry, 'format', at, ['text', 'number', 'percent'] as const, 'text')
        return { label: r.required(entry, 'label', at, 60), align: r.choice(entry, 'align', at, ['left', 'right'] as const, format === 'text' ? 'left' : 'right'), format }
      })
      const rows = r.list(props.rows, `${path}/rows`, VIEW_LIMITS.rows, 0).map((entry, index) => {
        const at = `${path}/rows/${index}`
        if (!Array.isArray(entry)) {
          r.fail(at, 'must be an array with one cell per column')
          return []
        }
        if (entry.length !== columns.length) r.fail(at, `has ${entry.length} cells for ${columns.length} columns`)
        return entry.slice(0, columns.length).map((cell, column) => {
          if (cell === null) return null
          if (typeof cell === 'number') return r.number(cell, `${at}/${column}`) ?? null
          return r.text(cell, `${at}/${column}`, VIEW_LIMITS.label) ?? null
        })
      })
      return { type, columns, rows }
    }
    case 'BarChart': {
      r.keys(props, path, ['categories', 'series', 'horizontal', 'stacked', 'unit', 'title'])
      const categories = r.list(props.categories, `${path}/categories`, VIEW_LIMITS.points).map((entry, index) => r.text(entry, `${path}/categories/${index}`, 60) ?? '')
      const series = r.series(props, path, categories.length)
      const stacked = r.flag(props, 'stacked', path)
      if (stacked && series.some((entry) => entry.data.some((value) => value !== null && value < 0))) r.fail(`${path}/series`, 'stacked bars cannot be negative')
      const unit = r.optional(props, 'unit', path, 20)
      const title = r.optional(props, 'title', path)
      return { type, categories, series, horizontal: r.flag(props, 'horizontal', path), stacked, ...(unit ? { unit } : {}), ...(title ? { title } : {}) }
    }
    case 'LineChart':
    case 'AreaChart': {
      r.keys(props, path, ['x', 'series', 'area', 'unit', 'title'])
      const x = r.list(props.x, `${path}/x`, VIEW_LIMITS.points).map((entry, index) => r.text(entry, `${path}/x/${index}`, 60) ?? '')
      const series = r.series(props, path, x.length)
      const unit = r.optional(props, 'unit', path, 20)
      const title = r.optional(props, 'title', path)
      return { type: 'LineChart', x, series, area: type === 'AreaChart' || r.flag(props, 'area', path), ...(unit ? { unit } : {}), ...(title ? { title } : {}) }
    }
    case 'DonutChart': {
      r.keys(props, path, ['segments', 'unit', 'total', 'title'])
      const segments = r.list(props.segments, `${path}/segments`, VIEW_LIMITS.segments).map((entry, index) => {
        const at = `${path}/segments/${index}`
        if (!isRecord(entry)) {
          r.fail(at, 'must be an object {label, value}')
          return { label: '', value: 0 }
        }
        r.keys(entry, at, ['label', 'value'])
        const value = r.number(entry.value, `${at}/value`) ?? 0
        if (value < 0) r.fail(`${at}/value`, 'cannot be negative')
        return { label: r.required(entry, 'label', at, 60), value: Math.max(0, value) }
      })
      const unit = r.optional(props, 'unit', path, 20)
      const total = r.optional(props, 'total', path, 40)
      const title = r.optional(props, 'title', path)
      return { type, segments, ...(unit ? { unit } : {}), ...(total ? { total } : {}), ...(title ? { title } : {}) }
    }
    case 'Sparkline': {
      r.keys(props, path, ['data', 'label'])
      const data = r.values(props.data, `${path}/data`, false).filter((entry): entry is number => entry !== null)
      if (data.length < 2) r.fail(`${path}/data`, 'needs at least 2 values')
      const label = r.optional(props, 'label', path)
      return { type, data, ...(label ? { label } : {}) }
    }
    default:
      r.fail(`${path}/type`, `${JSON.stringify(type).slice(0, 80)} is not a component; use one of ${Object.keys(VIEW_COMPONENTS).join(', ')}`)
      return null
  }
}

/** Checks a `show_view` call's arguments and returns the view to draw, or what is wrong with them. */
export function checkView(input: unknown): ViewCheck {
  const r = new Reader()
  let size = 0
  try {
    size = JSON.stringify(input)?.length ?? 0
  } catch {
    return { ok: false, errors: ['The view is not plain JSON.'] }
  }
  if (size > VIEW_SPEC_CHARS) return { ok: false, errors: [`The view is ${size} characters of JSON; at most ${VIEW_SPEC_CHARS} are allowed. Show less data, or split it into several views.`] }
  if (!isRecord(input)) return { ok: false, errors: ['The view must be an object {title?, root, elements}.'] }
  for (const key of Object.keys(input)) if (!['title', 'root', 'elements'].includes(key)) r.fail(`/${key}`, 'is not part of a view; use title, root and elements')
  const title = input.title === undefined || input.title === null ? undefined : r.text(input.title, '/title', VIEW_LIMITS.label)
  const elements = input.elements
  if (!isRecord(elements)) return { ok: false, errors: [...r.errors, '/elements: must be an object of elements by id'] }
  const ids = Object.keys(elements)
  if (ids.length === 0) return { ok: false, errors: [...r.errors, '/elements: is empty'] }
  if (ids.length > VIEW_LIMITS.elements) return { ok: false, errors: [`/elements: has ${ids.length} elements; at most ${VIEW_LIMITS.elements} are allowed`] }
  for (const id of ids) if (!ID.test(id)) r.fail(`/elements/${id.slice(0, 64)}`, 'ids are 1-64 letters, digits, "_" or "-"')
  const root = typeof input.root === 'string' ? input.root : ''
  if (!root || !Object.hasOwn(elements, root)) {
    r.fail('/root', ids.length === 1 ? `must name an element, such as "${ids[0]}"` : 'must name one of the elements')
    return { ok: false, errors: r.errors }
  }

  const parents = new Map<string, string>()
  const build = (id: string, depth: number, path: string): ViewNode | null => {
    const element = elements[id]
    if (!isRecord(element)) return r.fail(path, 'must be an object {type, props?, children?}') ?? null
    for (const key of Object.keys(element)) if (!['type', 'props', 'children'].includes(key)) r.fail(`${path}/${key}`, 'is not part of an element; use type, props and children')
    const type = typeof element.type === 'string' ? element.type : ''
    const spec = VIEW_COMPONENTS[type]
    if (element.props !== undefined && element.props !== null && !isRecord(element.props)) r.fail(`${path}/props`, 'must be an object')
    const props = isRecord(element.props) ? element.props : {}
    const read = readProps(r, type, props, `${path}/props`)
    if (!read || !spec) return null
    const childIds = element.children === undefined || element.children === null ? [] : element.children
    if (spec.children === 'none') {
      if (Array.isArray(childIds) ? childIds.length > 0 : true) r.fail(`${path}/children`, `${type} has no children`)
      return { id, ...read } as ViewNode
    }
    if (depth >= VIEW_LIMITS.depth) {
      r.fail(path, `is nested more than ${VIEW_LIMITS.depth} levels deep`)
      return null
    }
    const children: ViewNode[] = []
    r.list(childIds, `${path}/children`, VIEW_LIMITS.children).forEach((child, index) => {
      const at = `${path}/children/${index}`
      if (typeof child !== 'string' || !Object.hasOwn(elements, child)) return r.fail(at, `${JSON.stringify(child)?.slice(0, 80)} is not an element id`)
      if (child === root || parents.has(child)) return r.fail(at, `"${child}" already has a place in the view; every element appears once`)
      parents.set(child, id)
      const node = build(child, depth + 1, `/elements/${child}`)
      if (node) children.push(node)
    })
    if (read.type === 'Tabs' && read.tabs.length !== (Array.isArray(childIds) ? childIds.length : 0)) r.fail(`${path}/props/tabs`, 'needs one label per child')
    return { id, ...read, children } as ViewNode
  }
  const tree = build(root, 1, `/elements/${root}`)
  for (const id of ids) if (id !== root && !parents.has(id)) r.fail(`/elements/${id}`, 'is not the child of any element, so it would not be shown')
  if (r.errors.length > 0 || !tree) return { ok: false, errors: r.errors.length > 0 ? r.errors : ['The view could not be read.'] }
  return { ok: true, view: { ...(title?.trim() ? { title } : {}), root: tree } }
}
