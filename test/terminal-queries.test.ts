import { describe, expect, it } from 'vitest'
import { TerminalQueryResponder } from '../src/main/pty/terminal-queries'

const ember = { foreground: '#f5e6d3', background: '#1a1110' }

describe('terminal query responder', () => {
  it('answers foreground and background queries without forwarding them', () => {
    const responder = new TerminalQueryResponder(ember)
    const result = responder.process(
      `before\u001b]10;?\u001b\\middle\u001b]11;?\u0007after`
    )

    expect(result.data).toBe('beforemiddleafter')
    expect(result.responses).toEqual([
      '\u001b]10;rgb:f5f5/e6e6/d3d3\u001b\\',
      '\u001b]11;rgb:1a1a/1111/1010\u001b\\'
    ])
  })

  it('recognizes a query split across PTY output chunks', () => {
    const responder = new TerminalQueryResponder(ember)

    expect(responder.process('text\u001b]1')).toEqual({ data: 'text', responses: [] })
    expect(responder.process('1;?\u001b\\tail')).toEqual({
      data: 'tail',
      responses: ['\u001b]11;rgb:1a1a/1111/1010\u001b\\']
    })
  })

  it('uses the latest palette for later queries', () => {
    const responder = new TerminalQueryResponder(ember)
    responder.setPalette({ foreground: '#ffffff', background: '#000000' })

    expect(responder.process('\u001b]11;?\u0007').responses).toEqual([
      '\u001b]11;rgb:0000/0000/0000\u001b\\'
    ])
  })

  it('extracts WSL directories from OSC 7 and removes the control sequence', () => {
    const responder = new TerminalQueryResponder(ember)

    expect(responder.process(
      'before\u001b]7;file://localhost/home/me/my%20project\u0007after'
    )).toEqual({
      data: 'beforeafter',
      responses: [],
      directory: '/home/me/my project'
    })
    expect(responder.process('next\u001b]7;file:///tmp/work\u001b\\')).toEqual({
      data: 'next',
      responses: [],
      directory: '/tmp/work'
    })
  })

  it('recognizes a directory report split across PTY output chunks', () => {
    const responder = new TerminalQueryResponder(ember)

    expect(responder.process('text\u001b]7;file://localhost/home/me')).toEqual({
      data: 'text',
      responses: []
    })
    expect(responder.process('%20app\u0007tail')).toEqual({
      data: 'tail',
      responses: [],
      directory: '/home/me app'
    })
  })

  it('releases an unterminated sequence instead of swallowing later output', () => {
    const responder = new TerminalQueryResponder(ember)

    // A stray OSC opener with no BEL or ST: held back at first...
    expect(responder.process('start\u001b]nonsense')).toEqual({ data: 'start', responses: [] })
    // ...then given up on once it outgrows the buffer, so the pane keeps running.
    const flood = 'x'.repeat(5000)
    const result = responder.process(flood)
    expect(result.data).toBe(`\u001b]nonsense${flood}`)
    expect(responder.process('later')).toEqual({ data: 'later', responses: [] })
  })

  it('ignores malformed directory reports', () => {
    const responder = new TerminalQueryResponder(ember)

    expect(responder.process('before\u001b]7;not-a-file-uri\u0007after')).toEqual({
      data: 'beforeafter',
      responses: []
    })
    expect(responder.process('\u001b]7;file://localhost/not%ZZvalid\u0007')).toEqual({
      data: '',
      responses: []
    })
  })

  it('flushes an incomplete non-query sequence on shutdown', () => {
    const responder = new TerminalQueryResponder(ember)
    expect(responder.process('text\u001b')).toEqual({ data: 'text', responses: [] })
    expect(responder.flush()).toBe('\u001b')
  })
})
