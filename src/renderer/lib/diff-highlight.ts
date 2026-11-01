import type { CSSProperties } from 'react'
import { highlightCode, tagHighlighter } from '@lezer/highlight'
import { languageForPath } from '@/lib/code-languages'
import type { CharRange, DiffHunk } from '@/lib/diff'
import { SYNTAX_STYLE } from '@/lib/syntax-style'

/** A run of text in one line of a diff, with its syntax color and whether its words changed. */
export interface StyledSpan {
  text: string
  style?: CSSProperties
  emphasis?: boolean
}

/** Diffs bigger than this are shown without syntax colors. */
const MAX_HIGHLIGHT_CHARS = 200_000

// One class per entry of the shared style table, so a class name tells which entry colors the text.
const highlighter = tagHighlighter(SYNTAX_STYLE.map((style, index) => ({ tag: style.tag, class: `s${index}` })))
const STYLES: CSSProperties[] = SYNTAX_STYLE.map(({ tag: _tag, class: _class, ...css }) => css as CSSProperties)

function styleOf(classes: string): CSSProperties | undefined {
  let style: CSSProperties | undefined
  for (const name of classes.split(' ')) {
    const index = /^s(\d+)$/.exec(name)?.[1]
    if (index !== undefined && STYLES[Number(index)]) style = { ...style, ...STYLES[Number(index)] }
  }
  return style
}

type Parser = { parse(input: string): Parameters<typeof highlightCode>[1] }

/** The Lezer parser inside a language extension: a language pack holds it, a stream language is one. */
function parserOf(extension: unknown): Parser | null {
  const candidate = extension as { language?: { parser?: Parser }; parser?: Parser } | null
  const parser = candidate?.language?.parser ?? candidate?.parser
  return parser && typeof parser.parse === 'function' ? parser : null
}

/** Colors a block of code and returns it line by line. */
function highlightLines(code: string, parser: Parser): StyledSpan[][] {
  const lines: StyledSpan[][] = [[]]
  highlightCode(
    code,
    parser.parse(code),
    highlighter,
    (text, classes) => {
      if (!text) return
      const style = styleOf(classes)
      lines[lines.length - 1]!.push(style ? { text, style } : { text })
    },
    () => lines.push([]),
  )
  return lines
}

/**
 * Syntax colors for every line of a diff, or null when the file's language is unknown or the diff
 * is too big. A hunk's old side and new side are each colored as one piece of code, so a string or
 * comment that spans lines is read right; the result has one entry per line of each hunk.
 */
export async function highlightHunks(path: string, hunks: readonly DiffHunk[]): Promise<StyledSpan[][][] | null> {
  const language = languageForPath(path)
  if (!language) return null
  if (hunks.reduce((sum, hunk) => hunk.lines.reduce((inner, line) => inner + line.text.length + 1, sum), 0) > MAX_HIGHLIGHT_CHARS) return null
  try {
    const parser = parserOf(await language.load())
    if (!parser) return null
    return hunks.map((hunk) => {
      const before = highlightLines(hunk.lines.filter((line) => line.kind !== 'add').map((line) => line.text).join('\n'), parser)
      const after = highlightLines(hunk.lines.filter((line) => line.kind !== 'del').map((line) => line.text).join('\n'), parser)
      let oldAt = 0
      let newAt = 0
      return hunk.lines.map((line) => {
        if (line.kind === 'del') return before[oldAt++] ?? []
        if (line.kind === 'context') oldAt += 1
        return after[newAt++] ?? []
      })
    })
  } catch {
    // A language that fails to load or parse only costs the colors; the diff still shows.
    return null
  }
}

/** Splits a line's spans so the characters in `range` are marked as changed words. */
export function withEmphasis(spans: readonly StyledSpan[], range: CharRange | undefined): StyledSpan[] {
  if (!range || range[0] >= range[1]) return [...spans]
  const [from, to] = range
  const result: StyledSpan[] = []
  let start = 0
  for (const span of spans) {
    const end = start + span.text.length
    if (end <= from || start >= to) {
      result.push(span)
    } else {
      const cutFrom = Math.max(from, start) - start
      const cutTo = Math.min(to, end) - start
      if (cutFrom > 0) result.push({ ...span, text: span.text.slice(0, cutFrom) })
      result.push({ ...span, text: span.text.slice(cutFrom, cutTo), emphasis: true })
      if (cutTo < span.text.length) result.push({ ...span, text: span.text.slice(cutTo) })
    }
    start = end
  }
  return result
}
