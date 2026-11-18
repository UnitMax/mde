/** The part of xterm's buffer that reading a terminal's text needs. */
export interface ReadableBuffer {
  readonly length: number
  getLine(index: number): { readonly isWrapped: boolean; translateToString(trimRight?: boolean): string } | undefined
}

/**
 * What a terminal shows, as plain text: its scrollback and screen, with lines xterm wrapped joined again, empty
 * lines at the end (the unused rows under the prompt) left out, and only the last `lines` lines. Colours and
 * other escape sequences are gone already: xterm keeps them as cell attributes, not as text.
 */
export function terminalBufferText(buffer: ReadableBuffer, lines: number): { text: string; totalLines: number } {
  const logical: string[] = []
  for (let index = 0; index < buffer.length; index += 1) {
    const line = buffer.getLine(index)
    if (!line) continue
    // Untrimmed, so a space where xterm wrapped the line is kept when the parts are joined.
    const text = line.translateToString(false)
    if (line.isWrapped && logical.length > 0) logical[logical.length - 1] += text
    else logical.push(text)
  }
  let end = logical.length
  while (end > 0 && !logical[end - 1]!.trim()) end -= 1
  const kept = logical.slice(0, end).map((line) => line.trimEnd())
  return { text: kept.slice(Math.max(0, kept.length - lines)).join('\n'), totalLines: kept.length }
}
