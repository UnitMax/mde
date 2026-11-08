/**
 * Find in a conversation (Ctrl+F). The text that counts is what the person and the agent wrote: the DOM nodes marked
 * with `data-chat-searchable`. The search runs on what is drawn, so it finds what can be seen and highlights it in
 * place, Markdown formatting and all.
 */

/** Marks the elements whose text the search looks through (`data-chat-searchable` in the markup). */
export const SEARCHABLE_ATTRIBUTE = 'data-chat-searchable'

/** The names of the two highlights the search paints (see `::highlight` in chat-find.css). */
export const FIND_HIGHLIGHT = 'chat-find'
export const FIND_CURRENT_HIGHLIGHT = 'chat-find-current'

/** Where `query` occurs in `text`, ignoring case, as start offsets of matches that do not overlap. */
export function findOffsets(text: string, query: string): number[] {
  if (!query) return []
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  // A letter that changes length when lowercased (a dotted capital I) would put the offsets out of step with the text.
  if (haystack.length !== text.length || needle.length !== query.length) return exactOffsets(text, query)
  return exactOffsets(haystack, needle)
}

function exactOffsets(text: string, query: string): number[] {
  const offsets: number[] = []
  for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + query.length)) offsets.push(at)
  return offsets
}

/** Whether the element takes part in the layout (not hidden, not in a closed branch). Without the check, everything counts. */
function drawn(element: Element): boolean {
  const check = (element as Element & { checkVisibility?: () => boolean }).checkVisibility
  return typeof check === 'function' ? check.call(element) : true
}

interface TextSpan {
  node: Text
  start: number
}

/** One searchable element's text nodes, in order, with where each begins in the element's whole text. */
function textSpans(root: Element, visible: Map<Element, boolean>): { spans: TextSpan[]; text: string } {
  const spans: TextSpan[] = []
  let text = ''
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    if (!parent) continue
    let shown = visible.get(parent)
    if (shown === undefined) {
      shown = drawn(parent)
      visible.set(parent, shown)
    }
    if (!shown) continue
    spans.push({ node: node as Text, start: text.length })
    text += (node as Text).data
  }
  return { spans, text }
}

/** The span that holds the offset; an end offset on a boundary belongs to the span before it. */
function locate(spans: readonly TextSpan[], offset: number, from: number, end: boolean): { index: number; at: number } {
  let index = from
  while (index < spans.length - 1) {
    const next = spans[index + 1]!
    if (end ? offset <= next.start : offset < next.start) break
    index += 1
  }
  return { index, at: offset - spans[index]!.start }
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
    const { spans, text } = textSpans(element, visible)
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
  return ranges
}

/** The Custom Highlight API, which paints ranges without touching the document; undefined where it is missing. */
function highlights(): HighlightRegistry | undefined {
  return typeof CSS !== 'undefined' ? (CSS as unknown as { highlights?: HighlightRegistry }).highlights : undefined
}

interface HighlightRegistry {
  set: (name: string, highlight: unknown) => void
  delete: (name: string) => void
}

/** Paints the matches, the current one apart from the rest. */
export function paintMatches(ranges: readonly Range[], current: number): void {
  const registry = highlights()
  const Highlight = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
  if (!registry || !Highlight) return
  const others = ranges.filter((_, index) => index !== current)
  if (others.length > 0) registry.set(FIND_HIGHLIGHT, new Highlight(...others))
  else registry.delete(FIND_HIGHLIGHT)
  const chosen = ranges[current]
  if (chosen) registry.set(FIND_CURRENT_HIGHLIGHT, new Highlight(chosen))
  else registry.delete(FIND_CURRENT_HIGHLIGHT)
}

export function clearMatches(): void {
  const registry = highlights()
  registry?.delete(FIND_HIGHLIGHT)
  registry?.delete(FIND_CURRENT_HIGHLIGHT)
}

/** The match to start at: the first one that is not above the top of the view, or the last one when all of them are. */
export function startingMatch(tops: readonly number[], viewTop: number): number {
  if (tops.length === 0) return -1
  const index = tops.findIndex((top) => top >= viewTop)
  return index === -1 ? tops.length - 1 : index
}
