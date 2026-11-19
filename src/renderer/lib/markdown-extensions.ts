import { Marked, type marked } from 'marked'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Table, TableKit } from '@tiptap/extension-table'
import { OrderedList, TaskItem, TaskList } from '@tiptap/extension-list'
import type { MarkdownTokenizer } from '@tiptap/core'
import { MathBlock, MathInline } from '@/lib/math-markdown'
import { MermaidCodeBlock } from '@/lib/mermaid-code-block'

const starterKitOptions = { link: { openOnClick: false } }

/**
 * Read-only Markdown also keeps links to files written as `file://…` or `C:\…`, which a chat reply uses to name a
 * file of the project. They are only ever opened in MDE's own viewer: a click on a link that is not http(s) never
 * leaves the app.
 */
const previewLinkOptions = {
  openOnClick: false,
  isAllowedUri: (url: string, context: { defaultValidate: (url: string) => boolean }) =>
    context.defaultValidate(url) || /^file:\/\//i.test(url) || /^[a-z]:[\\/]/i.test(url),
}

/**
 * The Markdown extension with a parser of its own. Without one, every editor adds its extensions' tokenizers to the
 * single global `marked` again, and they are never taken off: each editor ever made then runs in every later parse, so
 * parsing grew slower all the time the app ran (16 KB took 1.5 s after 200 editors, 11 ms with a parser each).
 */
function markdownWithOwnParser() {
  // Typed as the global `marked`, which a `Marked` is in all that Tiptap uses (`use`, `setOptions`, `lexer`).
  return Markdown.configure({ marked: new Marked() as unknown as typeof marked, markedOptions: { gfm: true } })
}

/*
 * Some of the tokenizers Tiptap adds are tried at every block of a document and first split all the rest of it into
 * lines, though they only look at the first line or two. A long text (a model's reasoning can be hundreds of KB) was
 * parsed in quadratic time: 1.1 s for 256 KB. These ask the cheap question first and hand the rest to the original.
 */

function tokenizerOf(extension: { config: { markdownTokenizer?: unknown } }): MarkdownTokenizer {
  return extension.config.markdownTokenizer as MarkdownTokenizer
}

/** The first `count` lines of `src`, without splitting all of it. */
function firstLines(src: string, count: number): string {
  let end = -1
  for (let line = 0; line < count; line += 1) {
    end = src.indexOf('\n', end + 1)
    if (end < 0) return src
  }
  return src.slice(0, end)
}

const taskListTokenizer = tokenizerOf(TaskList)
const TASK_ITEM_START = /^\s*[-+*]\s+\[[ xX]\]\s/
const QuickTaskList = TaskList.extend({
  markdownTokenizer: {
    ...taskListTokenizer,
    tokenize: (src, tokens, lexer) => (TASK_ITEM_START.test(src) ? taskListTokenizer.tokenize(src, tokens, lexer) : undefined),
  },
})

// An ordered list's item line has a marker of digits, a roman numeral or one or two letters, then "." or ")" and a space.
const orderedListTokenizer = tokenizerOf(OrderedList)
const ORDERED_ITEM_START = /^\s*[0-9A-Za-z]+[.)]\s/

/**
 * The text an ordered list at the top of `src` can take: the list's tokenizer stops at a line after a blank one that is
 * neither blank, indented nor an item, so what follows that line is left out (and the newline before it, as the
 * tokenizer's `raw` leaves it out too). A text with many lists was otherwise split whole once for each of them.
 */
export function orderedListRegion(src: string): string {
  let start = 0
  let afterBlank = false
  while (start < src.length) {
    const newline = src.indexOf('\n', start)
    const end = newline < 0 ? src.length : newline
    const line = src.slice(start, end)
    const blank = line.trim() === ''
    if (afterBlank && !blank && !/^\s/.test(line) && !ORDERED_ITEM_START.test(line)) return src.slice(0, start - 1)
    afterBlank = blank
    start = end + 1
  }
  return src
}

const QuickOrderedList = OrderedList.extend({
  markdownTokenizer: {
    ...orderedListTokenizer,
    tokenize: (src, tokens, lexer) =>
      ORDERED_ITEM_START.test(firstLines(src, 1)) ? orderedListTokenizer.tokenize(orderedListRegion(src), tokens, lexer) : undefined,
  },
})

// A table begins where a line with a pipe is followed by its separator line, so two lines tell.
const tableTokenizer = tokenizerOf(Table)
const tableStart = tableTokenizer.start as (src: string) => number
const QuickTable = Table.extend({
  markdownTokenizer: { ...tableTokenizer, start: (src: string) => tableStart(firstLines(src, 2)) },
})

/** Tables, with `QuickTable` in place of the kit's own. */
const tableKit = [TableKit.configure({ table: false }), QuickTable]

/** Extensions for the To Do description editor. Each editor needs its own list: see `markdownWithOwnParser`. */
export function markdownExtensions() {
  return [StarterKit.configure({ ...starterKitOptions, orderedList: false }), QuickOrderedList, ...tableKit, markdownWithOwnParser()]
}

/**
 * The preview also renders Mermaid diagrams, LaTeX math and GitHub task lists. It is read-only, so it has no use for the
 * editor's trailing empty paragraph, which is there to give the cursor somewhere to go after a list, code block
 * or table. It is only added on the first transaction, and a click is one: the text of a message ending in a
 * list then grew by a blank line the moment it was clicked. Each editor needs its own list: see `markdownWithOwnParser`.
 */
export function markdownPreviewExtensions() {
  return [
    StarterKit.configure({ link: previewLinkOptions, codeBlock: false, trailingNode: false, orderedList: false }),
    QuickOrderedList,
    ...tableKit,
    markdownWithOwnParser(),
    MermaidCodeBlock,
    MathBlock,
    MathInline,
    QuickTaskList,
    TaskItem.configure({ nested: true }),
  ]
}
