/**
 * Terminal queries in the output of a shell that runs before any view shows it (a pane an agent opened while the
 * terminal was hidden). Nothing could answer them then, and once the kept output reaches xterm.js it would answer
 * them late, into whatever the shell is doing by then: at a prompt, `ESC[?1;2c` becomes typed text (`1;2c`) in
 * front of the next command. So while output is kept, the queries are taken out of it and the common ones are
 * answered here at once, as xterm.js would; the rest go unanswered, as on a terminal that does not support them.
 */

const ESC = '\u001b'
/** A CSI sequence: parameter bytes, intermediate bytes, one final byte. */
const CSI = /^\u001b\[([0-?]*)([ -/]*)([@-~])/
/** The start of a CSI sequence that may still be completed by the next chunk. */
const PARTIAL_CSI = /^\u001b(?:\[[0-?]*[ -/]*)?$/
const MAX_PARTIAL = 64

/** What xterm.js answers, so a shell sees the same terminal before and after the pane is shown. */
const DA1_RESPONSE = '\u001b[?1;2c'
const DA2_RESPONSE = '\u001b[>0;276;0c'

/** The answer to a query, '' for one taken out unanswered, or null for a sequence that is not a query. */
function answer(params: string, intermediates: string, final: string): string | null {
  if (final === 'c' && !intermediates) {
    if (params === '' || params === '0') return DA1_RESPONSE
    if (params === '>' || params === '>0') return DA2_RESPONSE
    if (params.startsWith('=')) return ''
    return null
  }
  if (final === 'n' && !intermediates) {
    if (params === '5') return '\u001b[0n'
    // The cursor is somewhere on a screen no one has drawn yet; the top left is as good an answer as any.
    if (params === '6') return '\u001b[1;1R'
    if (params === '?6') return '\u001b[?1;1R'
    if (params.startsWith('?')) return ''
    return null
  }
  // Mode reports (DECRQM), the terminal's name (XTVERSION), keyboard protocol and window size reports.
  if (final === 'p' && intermediates === '$') return ''
  if (final === 'q' && params.startsWith('>')) return ''
  if (final === 'u' && params.startsWith('?')) return ''
  if (final === 't' && !intermediates && /^(?:1[4689]|2[01])$/.test(params)) return ''
  return null
}

export class HeldQueryAnswerer {
  private partial = ''

  process(data: string): { data: string; responses: string[] } {
    let remaining = this.partial + data
    this.partial = ''
    let visible = ''
    const responses: string[] = []
    while (remaining) {
      const start = remaining.indexOf(ESC)
      if (start < 0) {
        visible += remaining
        break
      }
      visible += remaining.slice(0, start)
      remaining = remaining.slice(start)
      const match = CSI.exec(remaining)
      if (match) {
        const response = answer(match[1]!, match[2]!, match[3]!)
        if (response === null) visible += match[0]
        else if (response) responses.push(response)
        remaining = remaining.slice(match[0].length)
        continue
      }
      if (remaining.length <= MAX_PARTIAL && PARTIAL_CSI.test(remaining)) {
        this.partial = remaining
        break
      }
      visible += ESC
      remaining = remaining.slice(1)
    }
    return { data: visible, responses }
  }

  /** What is left of an unfinished sequence, as output, when output stops being kept. */
  flush(): string {
    const rest = this.partial
    this.partial = ''
    return rest
  }
}
