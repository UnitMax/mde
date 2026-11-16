import type { CSSProperties } from 'react'
import { highlightTree, tagHighlighter } from '@lezer/highlight'
import type { LanguageLoader } from '@/lib/code-languages'
import { SYNTAX_STYLE } from '@/lib/syntax-style'

// One class per shared style entry, used only to look up its theme-aware CSS.
export const codeHighlighter = tagHighlighter(SYNTAX_STYLE.map((style, index) => ({ tag: style.tag, class: `s${index}` })))
const STYLES: CSSProperties[] = SYNTAX_STYLE.map(({ tag: _tag, class: _class, ...css }) => css as CSSProperties)

export function codeStyleOf(classes: string): CSSProperties | undefined {
  let style: CSSProperties | undefined
  for (const name of classes.split(' ')) {
    const index = /^s(\d+)$/.exec(name)?.[1]
    if (index !== undefined && STYLES[Number(index)]) style = { ...style, ...STYLES[Number(index)] }
  }
  return style
}

export type CodeParser = { parse(input: string): Parameters<typeof highlightTree>[0] }

/** A language pack holds the parser; a legacy stream language is itself the language. */
function parserOf(extension: unknown): CodeParser | null {
  const candidate = extension as { language?: { parser?: CodeParser }; parser?: CodeParser } | null
  const parser = candidate?.language?.parser ?? candidate?.parser
  return parser && typeof parser.parse === 'function' ? parser : null
}

const parsers = new Map<LanguageLoader, Promise<CodeParser | null>>()

/** Lazy-load each parser once across code blocks and diff previews; a failed load leaves plain text. */
export function loadCodeParser(load: LanguageLoader): Promise<CodeParser | null> {
  let parser = parsers.get(load)
  if (!parser) {
    parser = load().then(parserOf, () => null)
    parsers.set(load, parser)
  }
  return parser
}
