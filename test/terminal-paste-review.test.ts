// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PASTE_PREVIEW_LINES,
  pastePromptReasons,
  pasteHazards,
  pasteReview
} from '../src/renderer/terminal/paste-review'
import { resetOsc52Listeners, subscribeOsc52, type Osc52Event, type PastePrompt } from '../src/renderer/terminal/osc52-notices'

// xterm.js needs a real browser. The session code only needs the parts it calls, and a textarea
// inside the element it opens into, which is where the browser fires a real paste.
const terminals: FakeTerminal[] = []
class FakeTerminal {
  modes = { bracketedPasteMode: false, mouseTrackingMode: 'none' }
  options = {}
  buffer = { active: { type: 'normal' } }
  parser = { registerOscHandler: vi.fn(() => ({ dispose: vi.fn() })) }
  textarea = document.createElement('textarea')
  paste = vi.fn()
  focus = vi.fn()
  constructor() { terminals.push(this) }
  loadAddon(): void {}
  open(element: HTMLElement): void { element.append(this.textarea) }
  attachCustomKeyEventHandler(): void {}
  onSelectionChange(): { dispose: () => void } { return { dispose: vi.fn() } }
  onData(): void {}
  hasSelection(): boolean { return false }
  getSelection(): string { return '' }
  dispose(): void {}
}
vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { onContextLoss(): void {} dispose(): void {} } }))

describe('which pastes are held for review', () => {
  it('pastes ordinary one-line text at once', () => {
    expect(pasteHazards('git status', false)).toEqual([])
    expect(pasteHazards('echo "tabs\tand ünïcode ✓"', false)).toEqual([])
    expect(pasteReview('git status', false)).toBeNull()
  })

  it('holds a line break, even a trailing one, unless the program marks pasted text', () => {
    expect(pasteHazards('git status\n', false)).toEqual(['line-break'])
    expect(pasteHazards('one\r\ntwo', false)).toEqual(['line-break'])
    expect(pasteHazards('one\rtwo', false)).toEqual(['line-break'])
    expect(pasteHazards('one\ntwo\n', true)).toEqual([])
  })

  it('always holds control characters, which can end a marked paste early', () => {
    expect(pasteHazards('safe\x1b[201~rm -rf ~\n', true)).toEqual(['control'])
    expect(pasteHazards('a\x03b', true)).toEqual(['control'])
    expect(pasteHazards('a\x9bb', true)).toEqual(['control'])
    expect(pasteHazards('a\x7f', true)).toEqual(['control'])
  })

  it('always holds invisible and text-direction characters', () => {
    expect(pasteHazards('ls\u202e', true)).toEqual(['hidden'])
    expect(pasteHazards('ls\u200b-la', true)).toEqual(['hidden'])
    expect(pasteHazards('\ufeffls', true)).toEqual(['hidden'])
    expect(pasteHazards('ls\u2066x\u2069', true)).toEqual(['hidden'])
  })

  it('holds the same hidden characters permission cards mark, such as a word joiner or a tag character', () => {
    for (const hidden of ['\u2060', '\u2063', '\u034f', '\u3164', '\u{e0041}', '\u{e0100}', '\ufe0f']) {
      expect(pasteHazards(`rm${hidden} -rf build`, true)).toEqual(['hidden'])
    }
    expect(pasteReview('a\u2060b', true)!.lines[0]).toContainEqual({ text: '<U+2060>', marked: true })
  })

  it('lets emoji built with a joiner or a variation selector through', () => {
    expect(pasteHazards('git commit -m "Fix \u2764\ufe0f and \u{1f469}\u200d\u{1f4bb}"', true)).toEqual([])
    expect(pasteHazards('\u{1f44d}\u{1f3fd} \u{1f3f3}\ufe0f\u200d\u{1f308} 1\ufe0f\u20e3', true)).toEqual([])
  })

  it('holds a joiner or variation selector that is not part of an emoji, even after a letter', () => {
    expect(pasteHazards('caf\u00e9\u200d.txt', true)).toEqual(['hidden'])
    expect(pasteHazards('\u00e9\ufe0f', true)).toEqual(['hidden'])
    expect(pasteHazards('\u{1f469}\u200d', true)).toEqual(['hidden'])
    expect(pasteHazards('\u{1f469}\u200d\u200d\u{1f4bb}', true)).toEqual(['hidden'])
    expect(pasteHazards('ok\u200d\u200d', true)).toEqual(['hidden'])
    expect(pasteHazards('1\ufe0f', true)).toEqual(['hidden'])
  })

  it('names every hazard found, in a fixed order', () => {
    expect(pasteHazards('\u202ea\x1b\n', false)).toEqual(['line-break', 'control', 'hidden'])
  })
})

describe('what the review shows', () => {
  it('shows the text line by line and marks each hidden character where it is', () => {
    const review = pasteReview('git status\ncurl x\x1b[201~|sh\u202e\n', false)!
    expect(review.lineCount).toBe(2)
    expect(review.endsWithLineBreak).toBe(true)
    expect(review.lines).toEqual([
      [{ text: 'git status', marked: false }],
      [
        { text: 'curl x', marked: false },
        { text: '<ESC>', marked: true },
        { text: '[201~|sh', marked: false },
        { text: '<U+202E>', marked: true }
      ]
    ])
  })

  it('keeps empty lines in the middle and counts them', () => {
    const review = pasteReview('a\n\nb', false)!
    expect(review.lines).toEqual([[{ text: 'a', marked: false }], [], [{ text: 'b', marked: false }]])
    expect(review.lineCount).toBe(3)
    expect(review.endsWithLineBreak).toBe(false)
  })

  it('cuts a long paste but still counts all of it', () => {
    const text = Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n')
    const review = pasteReview(text, false)!
    expect(review.lines).toHaveLength(PASTE_PREVIEW_LINES)
    expect(review.truncated).toBe(true)
    expect(review.lineCount).toBe(40)
    expect(pasteReview('x'.repeat(5000) + '\n', false)!.truncated).toBe(true)
  })

  it('says why the paste was held', () => {
    expect(pastePromptReasons(pasteReview('rm -rf build\n', false)!)[0]).toMatch(/^It ends with a line break,.*run each line/)
    expect(pastePromptReasons(pasteReview('a\nb\n', false)!)[0]).toMatch(/^It has 2 lines/)
    expect(pastePromptReasons(pasteReview('a\x1b', true)!)).toEqual([expect.stringMatching(/control characters/)])
    expect(pastePromptReasons(pasteReview('a\u200b', true)!)).toEqual([expect.stringMatching(/invisible or text-direction/)])
  })
})

describe('terminal paste', () => {
  let host: HTMLElement
  let events: Osc52Event[]
  let sessions: typeof import('../src/renderer/terminal/sessions')

  const paste = (text: string): ClipboardEvent => {
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => type === 'text/plain' ? text : '' } })
    terminals.at(-1)!.textarea.dispatchEvent(event)
    return event
  }
  const prompt = (): PastePrompt | undefined => {
    const last = events.filter((event) => event.kind === 'paste-prompt' || event.kind === 'paste-prompt-cleared').at(-1)
    return last?.kind === 'paste-prompt' ? last.prompt : undefined
  }

  beforeEach(async () => {
    terminals.length = 0
    resetOsc52Listeners()
    vi.stubGlobal('api', { pty: { write: vi.fn(), setPalette: vi.fn() }, clipboard: { writeText: vi.fn(async () => {}) } })
    sessions = await import('../src/renderer/terminal/sessions')
    host = document.createElement('div')
    document.body.append(host)
    sessions.attachSession('term-1', host)
    events = []
    subscribeOsc52('term-1', (event) => events.push(event))
  })
  afterEach(() => {
    sessions.disposeSession('term-1')
    host.remove()
    vi.unstubAllGlobals()
  })

  it('lets ordinary text through to xterm untouched', () => {
    const event = paste('git status')
    expect(event.defaultPrevented).toBe(false)
    expect(prompt()).toBeUndefined()
  })

  it('stops a held paste before xterm sees it, and pastes it only once the user says so', () => {
    const reached = vi.fn()
    terminals[0]!.textarea.addEventListener('paste', reached)
    const event = paste('git status\nrm -rf ~\n')
    expect(event.defaultPrevented).toBe(true)
    expect(reached).not.toHaveBeenCalled()
    expect(terminals[0]!.paste).not.toHaveBeenCalled()

    prompt()!.paste()
    expect(terminals[0]!.paste).toHaveBeenCalledWith('git status\nrm -rf ~\n')
    expect(terminals[0]!.focus).toHaveBeenCalled()
    expect(prompt()).toBeUndefined()
  })

  it('drops a cancelled paste, and a replaced prompt can no longer paste', () => {
    paste('one\n')
    const first = prompt()!
    paste('two\n')
    first.paste()
    expect(terminals[0]!.paste).not.toHaveBeenCalled()

    prompt()!.cancel()
    expect(terminals[0]!.paste).not.toHaveBeenCalled()
    expect(prompt()).toBeUndefined()
  })

  it('lets multiline text through when the program marks pasted text, but never an escape', () => {
    terminals[0]!.modes.bracketedPasteMode = true
    expect(paste('line one\nline two\n').defaultPrevented).toBe(false)
    expect(paste('ok\x1b[201~rm -rf ~\n').defaultPrevented).toBe(true)
  })

  it('asks again instead of pasting when the program changed and the prompt did not name the new danger', () => {
    terminals[0]!.modes.bracketedPasteMode = true
    paste('one\u2060\ntwo\n')
    expect(prompt()!.review.hazards).toEqual(['hidden'])

    terminals[0]!.modes.bracketedPasteMode = false
    prompt()!.paste()
    expect(terminals[0]!.paste).not.toHaveBeenCalled()
    expect(prompt()!.review.hazards).toEqual(['line-break', 'hidden'])

    prompt()!.paste()
    expect(terminals[0]!.paste).toHaveBeenCalledWith('one\u2060\ntwo\n')
  })

  it('pastes when the program changed in the safe direction', () => {
    paste('one\ntwo\n')
    terminals[0]!.modes.bracketedPasteMode = true
    prompt()!.paste()
    expect(terminals[0]!.paste).toHaveBeenCalledTimes(1)
  })

  it('clears a waiting prompt when the terminal closes', () => {
    paste('one\n')
    const waiting = prompt()!
    sessions.disposeSession('term-1')
    expect(prompt()).toBeUndefined()
    waiting.paste()
    expect(terminals[0]!.paste).not.toHaveBeenCalled()
  })
})
