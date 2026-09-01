// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { decodeOsc52Clipboard } from '../src/renderer/terminal/clipboard'

/**
 * The unit tests feed `decodeOsc52Clipboard` payloads by hand. This one drives a
 * real xterm parser with real escape sequences, so a change in how xterm
 * delivers OSC payloads cannot silently disable the clipboard gate.
 */
const ESC = '\u001b'
const BEL = '\u0007'
const ST = `${ESC}\\`

function write(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve))
}

async function captureOsc52(sequences: string[]): Promise<string[]> {
  const term = new Terminal({ allowProposedApi: true })
  const seen: string[] = []
  term.parser.registerOscHandler(52, (data) => {
    seen.push(data)
    return true
  })
  for (const sequence of sequences) await write(term, sequence)
  term.dispose()
  return seen
}

describe('OSC 52 through a real xterm parser', () => {
  it('delivers the payload in the form the decoder expects, for both terminators', async () => {
    const encoded = Buffer.from('yanked text', 'utf8').toString('base64')
    const seen = await captureOsc52([
      `${ESC}]52;c;${encoded}${BEL}`,
      `${ESC}]52;c;${encoded}${ST}`
    ])

    expect(seen).toHaveLength(2)
    for (const payload of seen) {
      expect(decodeOsc52Clipboard(payload)).toEqual({ kind: 'text', text: 'yanked text' })
    }
  })

  it('never reports clipboard contents back to the program', async () => {
    const [payload] = await captureOsc52([`${ESC}]52;c;?${BEL}`])

    expect(payload).toBeDefined()
    expect(decodeOsc52Clipboard(payload as string)).toEqual({ kind: 'ignored' })
  })

  it('leaves the sequence out of the visible buffer', async () => {
    const encoded = Buffer.from('hidden', 'utf8').toString('base64')
    const term = new Terminal({ allowProposedApi: true })
    term.parser.registerOscHandler(52, () => true)
    await write(term, `before${ESC}]52;c;${encoded}${BEL}after`)

    expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe('beforeafter')
    term.dispose()
  })
})
