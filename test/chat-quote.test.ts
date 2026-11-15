import { describe, expect, it } from 'vitest'
import { DRAFT_TEXT_LIMIT } from '../src/main/inbox/drafts'
import { CHAT_TEXT_MAX_LENGTH } from '../src/main/inbox/chat'
import {
  addQuote,
  joinQuotes,
  leadingQuotes,
  MESSAGE_TEXT_LIMIT,
  quoteBlock,
  quoteLines,
  splitQuotes,
  tidySelection,
} from '../src/renderer/lib/chat-quote'
import { promptLabel } from '../src/renderer/lib/chat-timeline'

describe('tidySelection', () => {
  it('drops blank lines around the text, space at the ends of lines, and more than one blank line in a row', () => {
    expect(tidySelection('\n\n  first  \t\nsecond\n\n\n\nthird\n\n')).toBe('  first\nsecond\n\nthird')
  })

  it('turns the line breaks and non-breaking spaces of a rendered page into plain ones', () => {
    expect(tidySelection('a\r\nb\rc\u00a0d')).toBe('a\nb\nc d')
  })
})

describe('tidySelection of tool output', () => {
  it('takes terminal colour codes out of quoted output', () => {
    expect(tidySelection('\u001b[32;1m$ npm test\u001b[0;m\n\u001b[0Kok')).toBe('$ npm test\nok')
  })
})

describe('quoteBlock', () => {
  it('puts a mark before each line and keeps a blank line inside the quote as an empty quoted line', () => {
    expect(quoteBlock('one\ntwo\n\nthree')).toBe('> one\n> two\n>\n> three')
  })

  it('quotes nothing for a selection of only blank space', () => {
    expect(quoteBlock('')).toBeNull()
    expect(quoteBlock(' \n\t \n')).toBeNull()
  })
})

describe('addQuote', () => {
  it('adds the selection, tidied, after the quotes there are', () => {
    expect(addQuote([], '  first  \n\n\n\nsecond\n')).toEqual(['  first\n\nsecond'])
    expect(addQuote(['one'], 'two')).toEqual(['one', 'two'])
  })

  it('gives the same list back for a selection with nothing in it, or one that is quoted already', () => {
    const quotes = ['one']
    expect(addQuote(quotes, ' \n\t ')).toBe(quotes)
    expect(addQuote(quotes, 'one  ')).toBe(quotes)
  })

  it('knows the limit the main process holds messages and drafts to', () => {
    expect(MESSAGE_TEXT_LIMIT).toBe(DRAFT_TEXT_LIMIT)
    expect(MESSAGE_TEXT_LIMIT).toBe(CHAT_TEXT_MAX_LENGTH)
  })
})

describe('joinQuotes', () => {
  it('writes the quotes as block quotes ahead of the text, a blank line between each', () => {
    expect(joinQuotes(['one\ntwo', 'three'], 'Why?')).toBe('> one\n> two\n\n> three\n\nWhy?')
  })

  it('keeps a blank line inside a quote as an empty quoted line', () => {
    expect(joinQuotes(['one\n\ntwo'], '')).toBe('> one\n>\n> two')
  })

  it('is the text when there are no quotes, and only the quotes when there is no text', () => {
    expect(joinQuotes([], '  as typed \n')).toBe('  as typed \n')
    expect(joinQuotes([], '')).toBe('')
    expect(joinQuotes(['only'], '')).toBe('> only')
  })

  it('leaves out a quote with nothing in it', () => {
    expect(joinQuotes([' ', 'real'], 'x')).toBe('> real\n\nx')
  })
})

describe('leadingQuotes', () => {
  it('takes the quotes a message starts with, each as the text it quotes, and leaves what was written', () => {
    expect(leadingQuotes('> one\n> two\n\n> three\n\nWhy?')).toEqual({ quotes: ['one\ntwo', 'three'], body: 'Why?' })
  })

  it('is the text as it is for a message that does not start with a quote', () => {
    expect(leadingQuotes('Why?\n\n> not leading')).toEqual({ quotes: [], body: 'Why?\n\n> not leading' })
    expect(leadingQuotes('')).toEqual({ quotes: [], body: '' })
    expect(leadingQuotes('\n> after a blank line')).toEqual({ quotes: [], body: '\n> after a blank line' })
  })

  it('stops at the first line that is not quoted, and keeps the quotes after it in the text', () => {
    expect(leadingQuotes('> one\n\nsay\n\n> later')).toEqual({ quotes: ['one'], body: 'say\n\n> later' })
  })

  it('takes text right after a quote, with no blank line, as the text', () => {
    expect(leadingQuotes('> quoted\nwritten')).toEqual({ quotes: ['quoted'], body: 'written' })
  })

  it('has only quotes and no text when the message is only quotes', () => {
    expect(leadingQuotes('> a\n\n> b')).toEqual({ quotes: ['a', 'b'], body: '' })
    expect(leadingQuotes('> a\n\n\n')).toEqual({ quotes: ['a'], body: '' })
  })

  it('keeps an empty quoted line inside its quote and removes one level of quoting only', () => {
    expect(leadingQuotes('>\n> a\n>\n> > inner\n>')).toEqual({ quotes: ['a\n\n> inner'], body: '' })
  })

  it('does not take a quote mark in a code fence', () => {
    const text = '```\n> code\n```'
    expect(leadingQuotes(text)).toEqual({ quotes: [], body: text })
  })

  it('has no quote for a message of only an empty one', () => {
    expect(leadingQuotes('>')).toEqual({ quotes: [], body: '' })
  })

  it('gives a text that is the end of the message, so that a place in it can be moved by the length taken', () => {
    const text = '> one\n\n> two\n\nWhy is that?'
    const { body } = leadingQuotes(text)
    expect(text.endsWith(body)).toBe(true)
    expect(text.length - body.length).toBe('> one\n\n> two\n\n'.length)
  })

  it('reads back what joinQuotes wrote', () => {
    for (const [quotes, body] of [
      [['first\n\nsecond'], 'Why?'],
      [['a', 'b\nc'], 'Look\n\nat this'],
      [['only'], ''],
      [[], 'plain'],
    ] as const) {
      expect(leadingQuotes(joinQuotes(quotes, body))).toEqual({ quotes, body })
    }
  })
})

describe('quoteLines', () => {
  it('finds the quoted lines with where each starts and ends and where its mark ends', () => {
    const text = 'before\n> one\n>two\n>\nafter'
    expect(quoteLines(text)).toEqual([
      { from: 7, to: 12, markEnd: 9 },
      { from: 13, to: 17, markEnd: 14 },
      { from: 18, to: 19, markEnd: 19 },
    ])
    expect(text.slice(7, 9)).toBe('> ')
  })

  it('allows up to three spaces before the mark, as Markdown does, and no more', () => {
    expect(quoteLines('   > ok\n    > code')).toEqual([{ from: 0, to: 7, markEnd: 5 }])
  })

  it('does not take a > in the middle of a line', () => {
    expect(quoteLines('a > b\n-> c\nx>')).toEqual([])
  })

  it('leaves code fences alone, whatever is in them', () => {
    const text = '> real\n```\n> not a quote\n```\n> real again\n~~~~\n> inside\n~~~\n> still inside\n~~~~\n> after'
    expect(quoteLines(text).map((line) => text.slice(line.from, line.to))).toEqual([
      '> real',
      '> real again',
      '> after',
    ])
  })

  it('does not close a fence with the other kind of fence or a shorter one', () => {
    const text = '````\n> a\n```\n> b\n~~~\n> c\n````\n> d'
    expect(quoteLines(text).map((line) => text.slice(line.from, line.to))).toEqual(['> d'])
    const tildes = '```\n> a\n~~~\n> b\n```\n> c'
    expect(quoteLines(tildes).map((line) => tildes.slice(line.from, line.to))).toEqual(['> c'])
  })

  it('closes a fence with a longer one of the same kind', () => {
    const text = '```\n> a\n`````\n> b'
    expect(quoteLines(text).map((line) => text.slice(line.from, line.to))).toEqual(['> b'])
  })

  it('does not let a line without the mark continue a quote', () => {
    expect(quoteLines('> a\nb')).toEqual([{ from: 0, to: 3, markEnd: 2 }])
  })
})

describe('splitQuotes', () => {
  it('is the text as it is when there is no quote, whitespace included', () => {
    expect(splitQuotes('  plain\n\ntext \n')).toEqual([{ kind: 'text', text: '  plain\n\ntext \n' }])
    expect(splitQuotes('')).toEqual([{ kind: 'text', text: '' }])
  })

  it('cuts a message into the quote and what is written after it, without the blank lines between', () => {
    expect(splitQuotes('> a line\n> another\n\nWhy is that?')).toEqual([
      { kind: 'quote', text: 'a line\nanother' },
      { kind: 'text', text: 'Why is that?' },
    ])
  })

  it('keeps the order of text and quotes, and makes a quote of each run separated by a blank line', () => {
    expect(splitQuotes('Look at this\n\n> one\n\n> two\n\nand that\n\n> three')).toEqual([
      { kind: 'text', text: 'Look at this' },
      { kind: 'quote', text: 'one' },
      { kind: 'quote', text: 'two' },
      { kind: 'text', text: 'and that' },
      { kind: 'quote', text: 'three' },
    ])
  })

  it('keeps an empty quoted line inside its quote and takes the empty ones off its ends', () => {
    expect(splitQuotes('>\n> a\n>\n> b\n>')).toEqual([{ kind: 'quote', text: 'a\n\nb' }])
  })

  it('removes one level of quoting only, so that a quote of a quote stays one', () => {
    expect(splitQuotes('> > inner\n> outer')).toEqual([{ kind: 'quote', text: '> inner\nouter' }])
  })

  it('takes text right after a quote, with no blank line, as text', () => {
    expect(splitQuotes('> quoted\nwritten')).toEqual([
      { kind: 'quote', text: 'quoted' },
      { kind: 'text', text: 'written' },
    ])
  })

  it('leaves a quote mark in a code fence in the text', () => {
    const text = 'Run:\n\n```\n> prompt\n```'
    expect(splitQuotes(text)).toEqual([{ kind: 'text', text }])
  })

  it('has no pieces for a message of only an empty quote', () => {
    expect(splitQuotes('>')).toEqual([])
  })

  it('reads back what joinQuotes wrote', () => {
    expect(splitQuotes(joinQuotes(['first\n\nsecond', 'third'], 'Why?'))).toEqual([
      { kind: 'quote', text: 'first\n\nsecond' },
      { kind: 'quote', text: 'third' },
      { kind: 'text', text: 'Why?' },
    ])
  })
})

describe('promptLabel with a quote', () => {
  const user = (text: string) => ({ kind: 'user' as const, id: 'msg_1', time: 1, text })

  it('names the prompt by what was written, not by what was quoted', () => {
    expect(promptLabel(user('> long quoted passage\n\nWhy is that so?'))).toBe('Why is that so?')
  })

  it('names a prompt of only a quote by the quote', () => {
    expect(promptLabel(user('> only this\n> and that'))).toBe('only this')
  })

  it('is unchanged for a message with no quote', () => {
    expect(promptLabel(user('\n  first line \nsecond'))).toBe('first line')
    expect(promptLabel(user(''))).toBe('Empty message')
  })
})
