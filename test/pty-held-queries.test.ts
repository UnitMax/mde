import { describe, expect, it } from 'vitest'
import { HeldQueryAnswerer } from '../src/main/pty/held-queries'

describe('terminal queries of a shell no view shows yet', () => {
  it('answers device attributes and status reports at once, and takes them out of the kept output', () => {
    const answerer = new HeldQueryAnswerer()
    expect(answerer.process('\u001b[c~/app ❯ \u001b[>c\u001b[5n\u001b[6n')).toEqual({
      data: '~/app ❯ ',
      responses: ['\u001b[?1;2c', '\u001b[>0;276;0c', '\u001b[0n', '\u001b[1;1R'],
    })
  })

  it('takes out queries it does not answer, and keeps everything else as it was', () => {
    const answerer = new HeldQueryAnswerer()
    const colored = '\u001b[1;34m~/app\u001b[0m \u001b[2K\u001b[?2004h'
    expect(answerer.process(`\u001b[?2026$p${colored}\u001b[>0q\u001b[?u\u001b[18t\u001b[=c`)).toEqual({ data: colored, responses: [] })
  })

  it('finds a query split across chunks, and gives back an unfinished one as output', () => {
    const answerer = new HeldQueryAnswerer()
    expect(answerer.process('prompt\u001b')).toEqual({ data: 'prompt', responses: [] })
    expect(answerer.process('[')).toEqual({ data: '', responses: [] })
    expect(answerer.process('c$ ')).toEqual({ data: '$ ', responses: ['\u001b[?1;2c'] })
    answerer.process('\u001b[')
    expect(answerer.flush()).toBe('\u001b[')
  })

  it('passes other escape sequences through', () => {
    const answerer = new HeldQueryAnswerer()
    expect(answerer.process('\u001b]0;title\u0007\u001b(B\u001b=')).toEqual({ data: '\u001b]0;title\u0007\u001b(B\u001b=', responses: [] })
  })
})
