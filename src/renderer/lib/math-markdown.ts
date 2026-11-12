import { mergeAttributes, Node, type MarkdownToken } from '@tiptap/core'
import katex, { type KatexOptions } from 'katex'
import 'katex/dist/katex.min.css'

/*
 * LaTeX math in read-only Markdown (assistant replies, Markdown previews), drawn with KaTeX. Models write math as
 * `$…$` or `\(…\)` inline and `$$…$$` or `\[…\]` on lines of their own, so all four are understood.
 *
 * A dollar is also money ("$5 and $10"), so `$…$` is only math when, as in Pandoc, the opening `$` is not
 * followed by a space, the closing one not preceded by one, and the closing one not followed by a digit, all on
 * one line. Code spans and blocks are read before any of this and stay code.
 *
 * KaTeX turns LaTeX into HTML and MathML; it runs no code. `trust: false` refuses the commands that could reach
 * out (`\href`, `\url`, `\includegraphics`, `\htmlId` and the like), and the size and expansion limits keep a
 * hostile formula from costing much. A formula KaTeX cannot read is shown as its source.
 */

/** Longer formulas are left as text. */
export const MATH_SOURCE_LIMIT = 4000

const KATEX_OPTIONS: KatexOptions = {
  throwOnError: true,
  trust: false,
  strict: 'ignore',
  maxSize: 20,
  maxExpand: 500,
  output: 'htmlAndMathml',
}

/** Draws `latex` into `element`, or its source when KaTeX cannot read it. */
export function renderMath(element: HTMLElement, latex: string, display: boolean): void {
  try {
    // A fresh macro table each time, so a `\gdef` in one formula cannot change another.
    katex.render(latex, element, { ...KATEX_OPTIONS, displayMode: display, macros: {} })
    element.removeAttribute('data-math-error')
    element.removeAttribute('title')
  } catch (error) {
    element.textContent = display ? `$$${latex}$$` : `$${latex}$`
    element.setAttribute('data-math-error', '')
    element.title = error instanceof Error ? error.message : 'Cannot read this formula'
  }
}

interface MathToken {
  type: string
  raw: string
  latex: string
  display: boolean
}

function usable(latex: string): boolean {
  return latex.trim() !== '' && latex.length <= MATH_SOURCE_LIMIT
}

/** Inline math at the start of `src`: `$…$`, `$$…$$` within a line, or `\(…\)`. */
export function inlineMath(src: string): MathToken | undefined {
  let match = /^\$\$([^\n]+?)\$\$/.exec(src)
  if (match && usable(match[1]!)) return { type: 'mathInline', raw: match[0], latex: match[1]!.trim(), display: true }
  match = /^\\\(([^\n]+?)\\\)/.exec(src)
  if (match && usable(match[1]!)) return { type: 'mathInline', raw: match[0], latex: match[1]!.trim(), display: false }
  // Not `$$`, no space after the opening dollar, none before the closing one (which is not escaped), no digit after it.
  match = /^\$(?![\s$])((?:\\.|[^\\\n$])+?)(?<![\s\\])\$(?!\d)/.exec(src)
  if (match && usable(match[1]!)) return { type: 'mathInline', raw: match[0], latex: match[1]!, display: false }
  return undefined
}

/** Display math at the start of `src`: `$$…$$` or `\[…\]` that begins a line and ends one. */
export function blockMath(src: string): MathToken | undefined {
  const match = /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/.exec(src) ?? /^ {0,3}\\\[([\s\S]+?)\\\][ \t]*(?:\n|$)/.exec(src)
  if (!match || !usable(match[1]!)) return undefined
  return { type: 'mathBlock', raw: match[0], latex: match[1]!.trim(), display: true }
}

function mathNodeView(display: boolean) {
  return ({ node }: { node: { attrs: Record<string, unknown> } }) => {
    const dom = document.createElement(display ? 'div' : 'span')
    dom.className = display ? 'math-block' : 'math-inline'
    dom.setAttribute('data-math', '')
    const latex = String(node.attrs.latex ?? '')
    renderMath(dom, latex, display || node.attrs.display === true)
    return { dom, ignoreMutation: () => true }
  }
}

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return { latex: { default: '' }, display: { default: false } }
  },

  parseHTML() {
    return [{ tag: 'span[data-math-inline]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-math-inline': '' })]
  },

  addNodeView() {
    return mathNodeView(false)
  },

  markdownTokenizer: {
    name: 'mathInline',
    level: 'inline',
    start: (src: string) => {
      const dollar = src.indexOf('$')
      const paren = src.indexOf('\\(')
      return dollar < 0 ? paren : paren < 0 ? dollar : Math.min(dollar, paren)
    },
    tokenize: (src: string) => inlineMath(src),
  },

  parseMarkdown: (token: MarkdownToken) => ({
    type: 'mathInline',
    attrs: { latex: String(token.latex ?? ''), display: token.display === true },
  }),

  renderMarkdown: (node: { attrs?: Record<string, unknown> }) => {
    const latex = String(node.attrs?.latex ?? '')
    return node.attrs?.display ? `$$${latex}$$` : `$${latex}$`
  },
})

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: false,

  addAttributes() {
    return { latex: { default: '' } }
  },

  parseHTML() {
    return [{ tag: 'div[data-math-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-math-block': '' })]
  },

  addNodeView() {
    return mathNodeView(true)
  },

  markdownTokenizer: {
    name: 'mathBlock',
    level: 'block',
    start: (src: string) => {
      const match = /^ {0,3}(?:\$\$|\\\[)/m.exec(src)
      return match ? match.index : -1
    },
    tokenize: (src: string) => blockMath(src),
  },

  parseMarkdown: (token: MarkdownToken) => ({ type: 'mathBlock', attrs: { latex: String(token.latex ?? '') } }),

  renderMarkdown: (node: { attrs?: Record<string, unknown> }) => `$$\n${String(node.attrs?.latex ?? '')}\n$$`,
})
