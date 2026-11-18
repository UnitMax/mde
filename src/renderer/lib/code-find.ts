/**
 * The file viewer's search in a source view. CodeMirror draws only the lines in view, so the matches are offsets in
 * its document and only the ones in view are marked, with the same `cm-searchMatch` classes as CodeMirror's own search.
 */

import { StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { findOffsets } from '@shared/text-search'
import { firstMatchFrom, type FileFinder } from '@/lib/file-find'

interface Matches {
  offsets: readonly number[]
  length: number
  current: number
}

const NONE: Matches = { offsets: [], length: 0, current: -1 }

const setMatches = StateEffect.define<Matches>()

const matchesField = StateField.define<Matches>({
  create: () => NONE,
  update: (value, transaction) => {
    for (const effect of transaction.effects) if (effect.is(setMatches)) return effect.value
    // The offsets belong to the text they were found in; the search bar finds them again in the new one.
    return transaction.docChanged ? NONE : value
  },
})

const matchMark = Decoration.mark({ class: 'cm-searchMatch' })
const currentMark = Decoration.mark({ class: 'cm-searchMatch cm-searchMatch-selected' })

function decorate(view: EditorView): DecorationSet {
  const { offsets, length, current } = view.state.field(matchesField)
  if (offsets.length === 0) return Decoration.none
  const marks: Range<Decoration>[] = []
  for (const { from, to } of view.visibleRanges) {
    for (let index = firstMatchFrom(offsets, from - length + 1); index < offsets.length; index += 1) {
      const start = offsets[index]!
      if (start >= to) break
      if (start + length <= from) continue
      marks.push((index === current ? currentMark : matchMark).range(start, start + length))
    }
  }
  return Decoration.set(marks, true)
}

const matchMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = decorate(view)
    }
    update(update: ViewUpdate): void {
      if (update.viewportChanged || update.docChanged || update.startState.field(matchesField) !== update.state.field(matchesField)) {
        this.decorations = decorate(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/** The editor extension the finder needs. */
export const codeFindExtension: Extension = [matchesField, matchMarks]

/** Whether the position's line is drawn well inside the scrolled area. */
function inView(view: EditorView, position: number): boolean {
  const coords = view.coordsAtPos(position)
  if (!coords) return false
  const box = view.scrollDOM.getBoundingClientRect()
  const margin = Math.min(48, box.height / 4)
  return coords.top >= box.top + margin && coords.bottom <= box.bottom - margin
}

/** A finder over the editor's whole document, including the lines that are not drawn. */
export function codeFinder(view: EditorView): FileFinder {
  let offsets: number[] = []
  let length = 0
  return {
    search: (query) => {
      offsets = findOffsets(view.state.doc.toString(), query)
      length = query.length
      view.dispatch({ effects: setMatches.of({ offsets, length, current: -1 }) })
      return offsets.length
    },
    startingMatch: () => firstMatchFrom(offsets, view.lineBlockAtHeight(view.scrollDOM.scrollTop).from),
    show: (current, reveal) => {
      const position = offsets[current]
      const scroll = reveal && position !== undefined && !inView(view, position)
      view.dispatch({
        effects: [
          setMatches.of({ offsets, length, current }),
          ...(scroll ? [EditorView.scrollIntoView(position, { y: 'center' })] : []),
        ],
      })
    },
    clear: () => {
      offsets = []
      length = 0
      view.dispatch({ effects: setMatches.of(NONE) })
    },
    selectedText: () => {
      const { from, to } = view.state.selection.main
      return view.state.sliceDoc(from, to)
    },
    focus: () => view.focus(),
  }
}
