/**
 * Find in the file viewer (Ctrl+F). One search bar (`FileFindBar`) works on both views of a file through a
 * `FileFinder`: the rendered Markdown is searched where it is drawn, like a conversation (`lib/chat-find.ts`), and
 * the source view searches CodeMirror's document, which draws only the lines in view.
 */

import { clearMatches, matchRanges, paintMatches, revealSideways, startingMatch, type HighlightNames } from '@/lib/chat-find'
import { scrollBehavior } from '@/lib/chat-timeline'

/** What the file viewer's search bar needs from the view it searches. */
export interface FileFinder {
  /** Finds every match of the query and returns how many there are. */
  search: (query: string) => number
  /** The match to start a new search at: the first one from the top of the view down. */
  startingMatch: () => number
  /** Marks the current match apart from the others, and brings it into view when `reveal` is set. */
  show: (current: number, reveal: boolean) => void
  /** Removes the marks. */
  clear: () => void
  /** The text selected in the view, which becomes the query when the search opens. */
  selectedText: () => string
  /** Gives the view the keyboard focus back when the search closes. */
  focus: () => void
  /** Calls back when what is drawn changes under the search (a diagram drawn late); returns the unsubscribe. */
  watch?: (onChange: () => void) => () => void
}

/** The highlight names the rendered Markdown's matches are painted with (see `::highlight` in chat-find.css). */
export const FILE_FIND_HIGHLIGHTS: HighlightNames = { all: 'file-find', current: 'file-find-current' }

/** The index of the first offset at or after `position`, or the last one when all of them are before it. */
export function firstMatchFrom(offsets: readonly number[], position: number): number {
  if (offsets.length === 0) return -1
  let low = 0
  let high = offsets.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (offsets[middle]! < position) low = middle + 1
    else high = middle
  }
  return low < offsets.length ? low : offsets.length - 1
}

/** A query worth putting in the search field: one line of reasonable length. */
export function seedQuery(selected: string): string {
  const text = selected.trim()
  return text && !text.includes('\n') && text.length <= 200 ? text : ''
}

/**
 * Scrolls the element so the range sits a third of the way down, unless it is already well inside the view, and
 * brings it into view sideways inside a wide diagram or table.
 */
export function revealRange(scroller: HTMLElement, range: Range): void {
  revealSideways(range)
  const box = range.getBoundingClientRect()
  const view = scroller.getBoundingClientRect()
  const margin = Math.min(48, view.height / 4)
  if (box.top >= view.top + margin && box.bottom <= view.bottom - margin) return
  const top = Math.max(0, scroller.scrollTop + box.top - view.top - view.height / 3)
  scroller.scrollTo({ top, behavior: scrollBehavior() })
}

/** A finder over drawn text: the elements marked `data-chat-searchable` under `scroller`, which scrolls them. */
export function domFinder(scroller: HTMLElement, focus: () => void): FileFinder {
  let ranges: Range[] = []
  return {
    search: (query) => {
      ranges = matchRanges(scroller, query)
      return ranges.length
    },
    startingMatch: () => startingMatch(ranges.map((range) => range.getBoundingClientRect().top), scroller.getBoundingClientRect().top),
    show: (current, reveal) => {
      paintMatches(ranges, current, FILE_FIND_HIGHLIGHTS)
      const range = ranges[current]
      if (reveal && range) revealRange(scroller, range)
    },
    clear: () => {
      ranges = []
      clearMatches(FILE_FIND_HIGHLIGHTS)
    },
    selectedText: () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !selection.anchorNode || !scroller.contains(selection.anchorNode)) return ''
      return selection.toString()
    },
    focus,
    watch: (onChange) => {
      if (typeof MutationObserver === 'undefined') return () => undefined
      const observer = new MutationObserver(onChange)
      observer.observe(scroller, { childList: true, subtree: true, characterData: true })
      return () => observer.disconnect()
    },
  }
}
