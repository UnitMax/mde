/**
 * Quoting in a chat. A quote is text of the conversation that rides along with a message. Written down it is
 * a Markdown block quote (`> ` before each line), and that is how it is kept in the draft, how it is sent (the
 * agent reads an ordinary quote), and how a sent message holds it. The message box shows the quotes at the
 * start of the draft as cards of their own and leaves them out of the text being typed; the conversation shows
 * the quotes of a sent message as cards too. All of it reads quotes with the functions below, so they agree on
 * what a quote is.
 */

/** The text of a selection as it is quoted: no space at the ends of lines, and no blank lines around it or two in a row. */
export function tidySelection(selection: string): string {
  return selection
    .replace(/\r\n?/g, '\n')
    // A rendered page gives non-breaking spaces where a space would be collapsed.
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
}

/** The selection as a block quote, or null when there is nothing in it to quote. */
export function quoteBlock(selection: string): string | null {
  const text = tidySelection(selection)
  if (!text.trim()) return null
  return text.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n')
}

/** The longest message the main process takes, and the longest draft it keeps. */
export const MESSAGE_TEXT_LIMIT = 100_000

/**
 * The quotes with one more: the selection as it is tidied. The same list comes back when there is nothing in
 * the selection to quote, or when it is quoted already.
 */
export function addQuote(quotes: readonly string[], selection: string): readonly string[] {
  const text = tidySelection(selection)
  return !text.trim() || quotes.includes(text) ? quotes : [...quotes, text]
}

/** The message as it is kept and sent: the quotes as block quotes, then what was written, a blank line between each. */
export function joinQuotes(quotes: readonly string[], body: string): string {
  const blocks = quotes.flatMap((quote) => quoteBlock(quote) ?? [])
  return (body ? [...blocks, body] : blocks).join('\n\n')
}

/**
 * The reverse of `joinQuotes`: the quotes a message starts with, each a run of quoted lines (up to the blank
 * line after it), and what is left, from the first line that is neither quoted nor blank. A message that does
 * not start with a quote has none. `body` is always the end of `text`, so a place in `text` can be moved into
 * it by taking away the difference in length.
 */
export function leadingQuotes(text: string): { quotes: string[]; body: string } {
  const lines = scan(text)
  const quotes: string[] = []
  let index = 0
  while (index < lines.length && lines[index]!.markEnd !== null) {
    const run: string[] = []
    for (; index < lines.length && lines[index]!.markEnd !== null; index += 1) {
      const line = lines[index]!
      run.push(line.text.slice(line.markEnd! - line.from))
    }
    const quote = run.join('\n').replace(/^\n+/, '').replace(/\n+$/, '')
    if (quote.trim()) quotes.push(quote)
    while (index < lines.length && lines[index]!.markEnd === null && !lines[index]!.text.trim()) index += 1
  }
  return { quotes, body: index === 0 ? text : lines.slice(index).map((line) => line.text).join('\n') }
}

/** Up to three spaces, then the `>` and one space after it if there is one. */
const QUOTE_MARK = /^ {0,3}> ?/
const FENCE = /^ {0,3}(`{3,}|~{3,})/

interface ScannedLine {
  text: string
  from: number
  to: number
  /** Where the quote mark ends, for a line that is quoted. */
  markEnd: number | null
}

/**
 * The lines of the text, each with whether it is quoted. A line is quoted when it starts with `>`, unless
 * it is in a fenced code block, where `>` is code. A line after a quote that has no `>` is not part of it.
 */
function scan(text: string): ScannedLine[] {
  const lines: ScannedLine[] = []
  let from = 0
  let fence: string | null = null
  for (const line of text.split('\n')) {
    const to = from + line.length
    let markEnd: number | null = null
    if (fence) {
      const close = FENCE.exec(line)
      if (close && close[1]![0] === fence[0] && close[1]!.length >= fence.length && !line.slice(close[0].length).trim()) fence = null
    } else {
      const mark = QUOTE_MARK.exec(line)
      if (mark) markEnd = from + mark[0].length
      else fence = FENCE.exec(line)?.[1] ?? null
    }
    lines.push({ text: line, from, to, markEnd })
    from = to + 1
  }
  return lines
}

/** The quoted lines of the text, as where each starts and ends and where its `>` ends; the message box marks these. */
export function quoteLines(text: string): { from: number; to: number; markEnd: number }[] {
  return scan(text).flatMap((line) => (line.markEnd === null ? [] : [{ from: line.from, to: line.to, markEnd: line.markEnd }]))
}

export type QuoteSegment = { kind: 'text' | 'quote'; text: string }

/**
 * The message cut into its quotes and what is written around them, in order, for showing the quotes as
 * quotes. A quote is the quoted lines in a row, without their marks. The blank lines that set a quote
 * apart from the text around it are left out. A message with no quote is one piece of text, unchanged.
 */
export function splitQuotes(text: string): QuoteSegment[] {
  const lines = scan(text)
  if (!lines.some((line) => line.markEnd !== null)) return [{ kind: 'text', text }]
  const groups: { quoted: boolean; lines: string[] }[] = []
  for (const line of lines) {
    const quoted = line.markEnd !== null
    const last = groups[groups.length - 1]
    const content = quoted ? line.text.slice(line.markEnd! - line.from) : line.text
    if (last && last.quoted === quoted) last.lines.push(content)
    else groups.push({ quoted, lines: [content] })
  }
  const segments: QuoteSegment[] = []
  groups.forEach((group, index) => {
    let body = group.lines.join('\n')
    // The blank lines between a quote and the text beside it belong to neither.
    if (group.quoted || index > 0) body = body.replace(/^\n+/, '')
    if (group.quoted || index < groups.length - 1) body = body.replace(/\n+$/, '')
    if (body.trim()) segments.push({ kind: group.quoted ? 'quote' : 'text', text: body })
  })
  return segments
}
