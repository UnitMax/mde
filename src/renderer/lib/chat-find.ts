/**
 * Find in a conversation (Ctrl+F). The text that counts is what the person and the agent wrote: the DOM nodes marked
 * with `data-chat-searchable`. The search runs on what is drawn, so it finds what can be seen and highlights it in
 * place, Markdown formatting and all. Diagrams (Mermaid) are drawn as SVG in a shadow root of their own; the search
 * goes into it and reads each label (`<text>`) on its own.
 */

import { findOffsets } from '@shared/text-search'

/** Marks the elements whose text the search looks through (`data-chat-searchable` in the markup). */
export const SEARCHABLE_ATTRIBUTE = 'data-chat-searchable'

/** The names of the two highlights the search paints (see `::highlight` in chat-find.css). */
export const FIND_HIGHLIGHT = 'chat-find'
export const FIND_CURRENT_HIGHLIGHT = 'chat-find-current'

export { findOffsets }

/** Whether the element takes part in the layout (not hidden, not in a closed branch). Without the check, everything counts. */
function drawn(element: Element): boolean {
  const check = (element as Element & { checkVisibility?: () => boolean }).checkVisibility
  return typeof check === 'function' ? check.call(element) : true
}

interface TextSpan {
  node: Text
  start: number
}

/** A run of text searched as one: its text nodes, in order, with where each begins in the whole text. */
interface TextUnit {
  spans: TextSpan[]
  text: string
}

function shownText(node: Text, visible: Map<Element, boolean>): boolean {
  const parent = node.parentElement
  if (!parent) return false
  let shown = visible.get(parent)
  if (shown === undefined) {
    shown = drawn(parent)
    visible.set(parent, shown)
  }
  return shown
}

/**
 * The line of an SVG label a text node is on. Mermaid draws a label as one `tspan` per word inside one per line (or
 * one per line with a `dy`), and a word that starts a wrapped line has no space before it.
 */
function svgLine(node: Text, label: Element): Element {
  return node.parentElement?.closest('.text-outer-tspan, tspan[dy], tspan[x]') ?? label
}

/** The text of one SVG label, with a space between its lines where the drawing has none. */
function labelUnit(label: Element, visible: Map<Element, boolean>): TextUnit {
  const spans: TextSpan[] = []
  let text = ''
  let line: Element | null = null
  const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!shownText(node, visible)) continue
    const nodeLine = svgLine(node, label)
    if (line && nodeLine !== line && text && !/\s$/.test(text) && !/^\s/.test(node.data)) text += ' '
    line = nodeLine
    spans.push({ node, start: text.length })
    text += node.data
  }
  return { spans, text }
}

/**
 * A searchable element's text: its own text nodes as one unit (in order), then a unit for each label of each diagram
 * drawn in an open shadow root inside it. Only the labels count there, not the diagram's styles.
 */
function textUnits(root: Element, visible: Map<Element, boolean>): TextUnit[] {
  const own: TextUnit = { spans: [], text: '' }
  const units: TextUnit[] = [own]
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!shownText(node as Text, visible)) continue
      own.spans.push({ node: node as Text, start: own.text.length })
      own.text += (node as Text).data
      continue
    }
    const shadow = (node as Element).shadowRoot
    if (!shadow) continue
    for (const label of Array.from(shadow.querySelectorAll('svg text'))) {
      // A label inside a label is read with the outer one.
      if (label.parentElement?.closest('text')) continue
      const unit = labelUnit(label, visible)
      if (unit.spans.length > 0) units.push(unit)
    }
  }
  return units
}

/**
 * The span that holds the offset; an end offset on a boundary belongs to the span before it. An offset in a space
 * that only the search added (between a label's lines) falls at the end of the span before it.
 */
function locate(spans: readonly TextSpan[], offset: number, from: number, end: boolean): { index: number; at: number } {
  let index = from
  while (index < spans.length - 1) {
    const next = spans[index + 1]!
    if (end ? offset <= next.start : offset < next.start) break
    index += 1
  }
  const span = spans[index]!
  return { index, at: Math.min(offset - span.start, span.node.data.length) }
}

/** Every match of the query inside the searchable elements under `root`, in the order they are read, as ranges. */
export function matchRanges(root: ParentNode, query: string): Range[] {
  if (!query) return []
  const ranges: Range[] = []
  const visible = new Map<Element, boolean>()
  for (const element of Array.from(root.querySelectorAll(`[${SEARCHABLE_ATTRIBUTE}]`))) {
    // A marked element inside a marked element is already searched with the outer one.
    if (element.parentElement?.closest(`[${SEARCHABLE_ATTRIBUTE}]`)) continue
    if (!drawn(element)) continue
    for (const { spans, text } of textUnits(element, visible)) {
      if (spans.length === 0) continue
      let cursor = 0
      for (const offset of findOffsets(text, query)) {
        const start = locate(spans, offset, cursor, false)
        const end = locate(spans, offset + query.length, start.index, true)
        cursor = start.index
        const range = document.createRange()
        range.setStart(spans[start.index]!.node, start.at)
        range.setEnd(spans[end.index]!.node, end.at)
        ranges.push(range)
      }
    }
  }
  return ranges
}

/** The element a node is in, stepping out of a shadow root to its host. */
function outerElement(node: Node): Element | null {
  if (node.parentElement) return node.parentElement
  const root = node.getRootNode()
  return root instanceof ShadowRoot ? root.host : null
}

/**
 * Scrolls the boxes that scroll sideways around the range (a wide diagram, a wide table) so that the range shows,
 * centred when it was out of sight. Up and down is left to the caller.
 */
export function revealSideways(range: Range): void {
  const box = range.getBoundingClientRect()
  for (let element = outerElement(range.startContainer); element; element = outerElement(element)) {
    if (element.scrollWidth <= element.clientWidth) continue
    const overflow = getComputedStyle(element).overflowX
    if (overflow !== 'auto' && overflow !== 'scroll') continue
    const view = element.getBoundingClientRect()
    if (box.left >= view.left && box.right <= view.right) continue
    const left = element.scrollLeft + box.left - view.left - (view.width - box.width) / 2
    element.scrollLeft = Math.max(0, left)
    return
  }
}

/** The Custom Highlight API, which paints ranges without touching the document; undefined where it is missing. */
function highlights(): HighlightRegistry | undefined {
  return typeof CSS !== 'undefined' ? (CSS as unknown as { highlights?: HighlightRegistry }).highlights : undefined
}

interface HighlightRegistry {
  set: (name: string, highlight: unknown) => void
  delete: (name: string) => void
}

/** The two highlight names one search paints with: every match, and the current one. */
export interface HighlightNames {
  all: string
  current: string
}

const CHAT_HIGHLIGHTS: HighlightNames = { all: FIND_HIGHLIGHT, current: FIND_CURRENT_HIGHLIGHT }

/** Paints the matches, the current one apart from the rest. */
export function paintMatches(ranges: readonly Range[], current: number, names: HighlightNames = CHAT_HIGHLIGHTS): void {
  const registry = highlights()
  const Highlight = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
  if (!registry || !Highlight) return
  const others = ranges.filter((_, index) => index !== current)
  if (others.length > 0) registry.set(names.all, new Highlight(...others))
  else registry.delete(names.all)
  const chosen = ranges[current]
  if (chosen) registry.set(names.current, new Highlight(chosen))
  else registry.delete(names.current)
}

export function clearMatches(names: HighlightNames = CHAT_HIGHLIGHTS): void {
  const registry = highlights()
  registry?.delete(names.all)
  registry?.delete(names.current)
}

/** The match to start at: the first one that is not above the top of the view, or the last one when all of them are. */
export function startingMatch(tops: readonly number[], viewTop: number): number {
  if (tops.length === 0) return -1
  const index = tops.findIndex((top) => top >= viewTop)
  return index === -1 ? tops.length - 1 : index
}
