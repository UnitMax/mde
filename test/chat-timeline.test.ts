import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../src/shared/types'
import {
  markWindow,
  promptLabel,
  samePlace,
  timelineEntries,
  timelinePlace,
  type PromptSpan,
} from '../src/renderer/lib/chat-timeline'

type UserMessage = Extract<ChatMessage, { kind: 'user' }>

const user = (id: string, text: string, extra: Partial<UserMessage> = {}): UserMessage => ({ kind: 'user', id, time: 1, text, ...extra })
const model = { id: 'free-1', providerId: 'opencode' }

describe('promptLabel', () => {
  it('is the first line of the text, on one line', () => {
    expect(promptLabel(user('m1', '  Fix   the\tlogin  \nthen the logout'))).toBe('Fix the login')
    expect(promptLabel(user('m1', '\n\n  Second line wins  '))).toBe('Second line wins')
  })

  it('shortens a very long line', () => {
    const label = promptLabel(user('m1', 'x'.repeat(500)))
    expect(label).toHaveLength(160)
    expect(label.endsWith('…')).toBe(true)
  })

  it('names what a message without text carries', () => {
    const file = (name: string) => ({ id: name, name, size: 1, mime: 'image/png' }) as never
    expect(promptLabel(user('m1', '', { attachments: [file('shot.png')] }))).toBe('shot.png')
    expect(promptLabel(user('m1', ' ', { attachments: [file('a.png'), file('b.png')] }))).toBe('2 attachments')
    expect(promptLabel(user('m1', '', { skills: [{ id: 'demo', name: 'Demo' }, { id: 'x', name: 'X' }] as never }))).toBe('Demo, X')
    expect(promptLabel(user('m1', ''))).toBe('Empty message')
  })
})

describe('timelineEntries', () => {
  it('lists the user messages in order and nothing else', () => {
    const messages: ChatMessage[] = [
      user('m1', 'First'),
      { kind: 'assistant', id: 'm2', time: 2, agent: 'build', model, completed: true, parts: [] },
      { kind: 'note', id: 'm3', time: 3, text: 'Switched model' } as ChatMessage,
      user('m4', 'Second'),
    ]
    expect(timelineEntries(messages)).toEqual([{ id: 'm1', label: 'First' }, { id: 'm4', label: 'Second' }])
  })
})

describe('timelinePlace', () => {
  const spans: PromptSpan[] = [
    { id: 'a', top: -900, bottom: -850 },
    { id: 'b', top: -300, bottom: -250 },
    { id: 'c', top: 100, bottom: 150 },
    { id: 'd', top: 450, bottom: 500 },
    { id: 'e', top: 1200, bottom: 1250 },
  ]

  it('lights the prompts on screen and reads the turn that has reached the reading line', () => {
    const place = timelinePlace(spans, 600, false)
    expect([...place.visible]).toEqual(['c', 'd'])
    // The line is 35% down a 600 px view: 210 px. `c` has reached it, `d` has not.
    expect(place.current).toBe('c')
  })

  it('is in the first turn above the first prompt', () => {
    expect(timelinePlace([{ id: 'a', top: 300, bottom: 350 }, { id: 'b', top: 900, bottom: 950 }], 600, false).current).toBe('a')
  })

  it('is in the last turn at the end, however short it is', () => {
    const place = timelinePlace(spans.slice(0, 4), 600, true)
    expect(place.current).toBe('d')
  })

  it('has no place without prompts', () => {
    expect(timelinePlace([], 600, true)).toEqual({ visible: new Set(), current: null })
  })

  it('counts a prompt that is only partly on screen as on screen', () => {
    const place = timelinePlace([{ id: 'a', top: -20, bottom: 30 }, { id: 'b', top: 580, bottom: 640 }], 600, false)
    expect([...place.visible]).toEqual(['a', 'b'])
  })
})

describe('samePlace', () => {
  it('compares the current prompt and the prompts on screen, not the objects', () => {
    expect(samePlace({ visible: new Set(['a', 'b']), current: 'a' }, { visible: new Set(['b', 'a']), current: 'a' })).toBe(true)
    expect(samePlace({ visible: new Set(['a']), current: 'a' }, { visible: new Set(['a']), current: 'b' })).toBe(false)
    expect(samePlace({ visible: new Set(['a']), current: 'a' }, { visible: new Set(['a', 'b']), current: 'a' })).toBe(false)
    expect(samePlace({ visible: new Set(['a']), current: 'a' }, { visible: new Set(['b']), current: 'a' })).toBe(false)
  })
})

describe('markWindow', () => {
  it('draws every mark when they fit', () => {
    expect(markWindow(5, 18, 2)).toEqual({ start: 0, end: 5 })
    expect(markWindow(18, 18, 17)).toEqual({ start: 0, end: 18 })
  })

  it('centres the marks on the current prompt when there are more than fit', () => {
    expect(markWindow(40, 18, 20)).toEqual({ start: 11, end: 29 })
  })

  it('stops at either end of the conversation', () => {
    expect(markWindow(40, 18, 0)).toEqual({ start: 0, end: 18 })
    expect(markWindow(40, 18, 39)).toEqual({ start: 22, end: 40 })
  })
})
