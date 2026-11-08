// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../src/shared/types'
import { clickedSelection, conversationMarkdown, menuTarget, messageMarkdown } from '../src/renderer/lib/chat-menu'

const model = { id: 'm', providerId: 'p' }
const user = (text: string, id = 'u'): ChatMessage => ({ kind: 'user', id, time: 1, text })
const assistant = (parts: Extract<ChatMessage, { kind: 'assistant' }>['parts'], id = 'a'): ChatMessage =>
  ({ kind: 'assistant', id, time: 2, agent: 'build', model, parts, completed: true })

describe('messageMarkdown', () => {
  it('gives your message as you wrote it, without the blank lines around it', () => {
    expect(messageMarkdown(user('\n\n  indented\nsecond line\n\n'))).toBe('  indented\nsecond line')
    expect(messageMarkdown(user('   \n'))).toBeNull()
  })

  it('gives the text parts of a reply as Markdown, leaving out reasoning and tools', () => {
    const message = assistant([
      { kind: 'reasoning', text: 'thinking' },
      { kind: 'text', text: 'First.\n\n```ts\nconst a = 1\n```\n' },
      { kind: 'tool', id: 't', name: 'read', status: 'completed', input: '{}', output: 'out' },
      { kind: 'text', text: '- one\n- two' },
      { kind: 'text', text: '  ' },
    ])
    expect(messageMarkdown(message)).toBe('First.\n\n```ts\nconst a = 1\n```\n\n- one\n- two')
  })

  it('has nothing to give for a step that only ran tools', () => {
    expect(messageMarkdown(assistant([{ kind: 'tool', id: 't', name: 'read', status: 'completed', input: '{}' }]))).toBeNull()
  })

  it('gives a note with its details', () => {
    expect(messageMarkdown({ kind: 'note', id: 'n', time: 1, tone: 'info', text: 'Loaded the demo skill' })).toBe('Loaded the demo skill')
    expect(messageMarkdown({ kind: 'note', id: 'n', time: 1, tone: 'error', text: 'Failed', detail: 'Because.\n' })).toBe('Failed\n\nBecause.')
  })
})

describe('conversationMarkdown', () => {
  it('labels each side once, even when the agent took several steps in a row', () => {
    const text = conversationMarkdown([
      user('Fix it', 'u1'),
      assistant([{ kind: 'tool', id: 't', name: 'read', status: 'completed', input: '{}' }], 'a1'),
      assistant([{ kind: 'text', text: 'Looked.' }], 'a2'),
      assistant([{ kind: 'text', text: 'Fixed.' }], 'a3'),
      { kind: 'note', id: 'n', time: 3, tone: 'info', text: 'A note' },
      user('Thanks', 'u2'),
    ])
    expect(text).toBe('## You\n\nFix it\n\n## Assistant\n\nLooked.\n\nFixed.\n\n## You\n\nThanks')
  })

  it('is empty when nothing has text', () => {
    expect(conversationMarkdown([])).toBe('')
    expect(conversationMarkdown([{ kind: 'note', id: 'n', time: 1, tone: 'info', text: 'A note' }])).toBe('')
  })
})

describe('menuTarget', () => {
  const page = (): { transcript: HTMLElement; outside: HTMLElement } => {
    document.body.innerHTML = `
      <section id="outside"><p>Outside</p></section>
      <div id="transcript">
        <div data-chat-message="m1"><p id="text">Hello <a id="web" href="https://example.com/x">site</a>
          <a id="file" href="./a.md">file</a><a id="javascript" href="javascript:alert(1)">bad</a></p>
          <pre id="code"><code>line one\nline two\n\n</code></pre></div>
        <div id="gap"></div>
      </div>`
    return { transcript: document.getElementById('transcript')!, outside: document.getElementById('outside')! }
  }
  const at = (id: string): Element => document.getElementById(id)!
  afterEach(() => { document.body.innerHTML = '' })

  it('finds the message, the code and the link under the cursor', () => {
    const { transcript } = page()
    expect(menuTarget(at('text'), transcript)).toEqual({ code: null, link: null, messageId: 'm1' })
    expect(menuTarget(at('code').firstElementChild, transcript)).toEqual({ code: 'line one\nline two', link: null, messageId: 'm1' })
    expect(menuTarget(at('web'), transcript)).toEqual({ code: null, link: { href: 'https://example.com/x', external: 'https://example.com/x' }, messageId: 'm1' })
  })

  it('knows a link the app may open from one it may not', () => {
    const { transcript } = page()
    expect(menuTarget(at('file'), transcript).link).toEqual({ href: './a.md', external: null })
    expect(menuTarget(at('javascript'), transcript).link).toEqual({ href: 'javascript:alert(1)', external: null })
  })

  it('finds no message on empty space, and nothing outside the transcript', () => {
    const { transcript, outside } = page()
    expect(menuTarget(at('gap'), transcript)).toEqual({ code: null, link: null, messageId: null })
    expect(menuTarget(outside.firstElementChild, transcript)).toEqual({ code: null, link: null, messageId: null })
    expect(menuTarget(null, transcript)).toEqual({ code: null, link: null, messageId: null })
  })
})

describe('clickedSelection', () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges()
    Reflect.deleteProperty(document, 'caretRangeFromPoint')
    document.body.innerHTML = ''
  })
  const page = (): { transcript: HTMLElement; first: HTMLElement; second: HTMLElement; outside: HTMLElement } => {
    document.body.innerHTML = `
      <p id="outside">Outside text</p>
      <div id="transcript"><p id="first">First <b id="word">chosen</b> words</p><p id="second">Second</p></div>`
    const select = (from: Node, to: Node): void => {
      const range = document.createRange()
      range.setStart(from, 0)
      range.setEnd(to, to.textContent!.length)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
    }
    const word = document.getElementById('word')!
    select(word.firstChild!, word.firstChild!)
    return {
      transcript: document.getElementById('transcript')!,
      first: document.getElementById('first')!,
      second: document.getElementById('second')!,
      outside: document.getElementById('outside')!,
    }
  }

  it('gives the selected text when the click lands on the element holding it', () => {
    const { transcript, first, second } = page()
    expect(clickedSelection(window.getSelection(), transcript, first, 5, 5)).toBe('chosen')
    expect(clickedSelection(window.getSelection(), transcript, second, 5, 5)).toBe('')
  })

  it('goes by the exact spot when the page can tell what it is', () => {
    const { transcript, first } = page()
    const word = document.getElementById('word')!.firstChild!
    const rest = first.lastChild!
    const caret = (node: Node, offset: number) => ({ startContainer: node, startOffset: offset }) as Range
    const pointAt = (range: Range): void => {
      Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: vi.fn(() => range) })
    }
    pointAt(caret(word, 2))
    expect(clickedSelection(window.getSelection(), transcript, first, 1, 1)).toBe('chosen')
    // Right-clicking another word of the same paragraph is not pointing at the selection.
    pointAt(caret(rest, 2))
    expect(clickedSelection(window.getSelection(), transcript, first, 1, 1)).toBe('')
  })

  it('gives nothing for a collapsed selection, none at all, or one outside the transcript', () => {
    const { transcript, first, outside } = page()
    expect(clickedSelection(null, transcript, first, 1, 1)).toBe('')
    const selection = window.getSelection()!
    selection.collapse(first, 0)
    expect(clickedSelection(selection, transcript, first, 1, 1)).toBe('')
    const range = document.createRange()
    range.selectNodeContents(outside)
    selection.removeAllRanges()
    selection.addRange(range)
    expect(clickedSelection(selection, transcript, outside, 1, 1)).toBe('')
    // A selection that starts in the transcript and runs out of it is not the transcript's to copy.
    range.setStart(first.firstChild!, 0)
    range.setEnd(outside.firstChild!, 3)
    expect(clickedSelection(selection, transcript, first, 1, 1)).toBe('')
  })
})
