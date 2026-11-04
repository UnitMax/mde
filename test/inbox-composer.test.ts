// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { undo } from '@codemirror/commands'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatComposer, type ChatComposerProps } from '../src/renderer/components/inbox/ChatComposer'
import type { ChatDraft, ChatDraftRequest } from '../src/shared/types'
import { messageInput, pressMessageKey, setMessageText } from './helpers/chat-input'

let root: Root
let container: HTMLElement

// jsdom has no layout engine; these checks exercise document edits and keyboard behavior.
beforeAll(() => Object.defineProperties(Range.prototype, {
  getClientRects: { configurable: true, value: () => [] },
  getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
}))

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function setup(initial = '', failSend = false, onPreviousMessage?: ChatComposerProps['onPreviousMessage']) {
  let draft: ChatDraft = { text: initial, revision: 0, attachments: [] }
  const request = vi.fn(async (input: ChatDraftRequest) => {
    if (input.action === 'text') draft = { ...draft, text: input.text, revision: draft.revision + 1 }
    return draft
  })
  vi.stubGlobal('api', { chat: { draft: request } })
  const send = vi.fn(async () => { if (failSend) throw new Error('Service unavailable') })
  const render = async (draftKey: 'thread:ses_one' | 'thread:ses_two' = 'thread:ses_one', disabled = false) => {
    await act(async () => root.render(createElement(ChatComposer, {
      draftKey, agent: 'build', model: { id: 'm', providerId: 'p' }, disabled, onPreviousMessage,
      options: { status: 'ready', value: { agents: [], models: [], defaultModel: null, defaultAgent: null, skills: [] } },
      onAgentChange: () => {}, onModelChange: () => {}, onSend: send,
    })))
  }
  await render()
  return { input: messageInput(container), request, send, render }
}

function messageHistory(...texts: string[]) {
  const messages = texts.map((text, index) => ({ id: `msg_${index}`, text }))
  return vi.fn(async (beforeId?: string) => {
    const index = beforeId ? messages.findIndex((message) => message.id === beforeId) : messages.length
    return messages[index - 1] ?? null
  })
}

describe('Inbox message history', () => {
  it('recalls newest first, stops at the oldest and moves forward to the empty draft', async () => {
    const previous = messageHistory('First message', '- Last message\n- More detail')
    const { input, request, send } = await setup('', false, previous)
    expect((await pressMessageKey(input, 'ArrowUp')).defaultPrevented).toBe(true)
    expect(input.state.doc.toString()).toBe('- Last message\n- More detail')
    expect(input.state.selection.main.head).toBe(input.state.doc.length)
    expect(input.contentDOM.querySelectorAll('.chat-input-bullet')).toHaveLength(2)
    expect(request).toHaveBeenLastCalledWith({ key: 'thread:ses_one', action: 'text', text: '- Last message\n- More detail' })
    await pressMessageKey(input, 'ArrowUp')
    expect(input.state.doc.toString()).toBe('First message')
    await pressMessageKey(input, 'ArrowUp')
    expect(input.state.doc.toString()).toBe('First message')
    await pressMessageKey(input, 'ArrowDown')
    expect(input.state.doc.toString()).toBe('- Last message\n- More detail')
    await pressMessageKey(input, 'ArrowDown')
    expect(input.state.doc.toString()).toBe('')
    expect(request).toHaveBeenLastCalledWith({ key: 'thread:ses_one', action: 'text', text: '' })
    await pressMessageKey(input, 'ArrowUp')
    expect(previous).toHaveBeenLastCalledWith(undefined)
    expect(input.state.doc.toString()).toBe('- Last message\n- More detail')
    expect(send).not.toHaveBeenCalled()
  })

  it.each(['Unsent draft', ' \n '])('preserves a nonempty draft: %j', async (text) => {
    const previous = messageHistory('Old message')
    const { input, request } = await setup(text, false, previous)
    await pressMessageKey(input, 'ArrowUp')
    await pressMessageKey(input, 'ArrowDown')
    expect(input.state.doc.toString()).toBe(text)
    expect(previous).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'text' }))
  })

  it('ends navigation when a recalled message is edited, and sends the edited text', async () => {
    const previous = messageHistory('First', 'Latest')
    const { input, send } = await setup('', false, previous)
    await pressMessageKey(input, 'ArrowUp')
    await setMessageText(input, 'Latest with changes')
    await pressMessageKey(input, 'ArrowUp')
    await pressMessageKey(input, 'ArrowDown')
    expect(previous).toHaveBeenCalledTimes(1)
    expect(input.state.doc.toString()).toBe('Latest with changes')
    await pressMessageKey(input, 'Enter')
    expect(send).toHaveBeenCalledWith('Latest with changes', expect.anything())
    expect(input.state.doc.toString()).toBe('')
    await pressMessageKey(input, 'ArrowUp')
    expect(previous).toHaveBeenLastCalledWith(undefined)
  })

  it('ignores history keys with modifiers, during composition and while disabled', async () => {
    const previous = messageHistory('Old message')
    const { input, render } = await setup('', false, previous)
    for (const modifiers of [{ shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }]) {
      await pressMessageKey(input, 'ArrowUp', modifiers)
    }
    await render('thread:ses_one', true)
    await pressMessageKey(input, 'ArrowUp')
    expect(previous).not.toHaveBeenCalled()
    expect(input.state.doc.toString()).toBe('')
  })

  it('does nothing when no previous messages exist', async () => {
    const previous = messageHistory()
    const { input, request } = await setup('', false, previous)
    await pressMessageKey(input, 'ArrowDown')
    expect(previous).not.toHaveBeenCalled()
    await pressMessageKey(input, 'ArrowUp')
    expect(input.state.doc.toString()).toBe('')
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'text' }))
  })

  it('ignores a pending history read after the user starts typing', async () => {
    let resolve!: (message: { id: string; text: string }) => void
    const previous = vi.fn(() => new Promise<{ id: string; text: string }>((done) => { resolve = done }))
    const { input, request } = await setup('', false, previous)
    await pressMessageKey(input, 'ArrowUp')
    await setMessageText(input, 'Keep this draft')
    await act(async () => resolve({ id: 'msg_old', text: 'Old message' }))
    expect(input.state.doc.toString()).toBe('Keep this draft')
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'text', text: 'Old message' }))
  })

  it('resets navigation when switching thread drafts', async () => {
    const previous = messageHistory('First', 'Latest')
    const { input, render } = await setup('', false, previous)
    await pressMessageKey(input, 'ArrowUp')
    await render('thread:ses_two')
    const next = messageInput(container)
    await pressMessageKey(next, 'ArrowDown')
    expect(next.state.doc.toString()).toBe('Latest')
    await setMessageText(next, '')
    await pressMessageKey(next, 'ArrowUp')
    expect(previous).toHaveBeenLastCalledWith(undefined)
  })
})

describe('Inbox bullet list input', () => {
  it('displays typed and loaded bullet markers without changing the Markdown', async () => {
    const text = '- First\n  * Nested\n+ Last'
    const { input, request } = await setup(text)
    expect(input.contentDOM.querySelectorAll('.chat-input-bullet')).toHaveLength(3)
    expect(input.state.doc.toString()).toBe(text)
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'text' }))
    await setMessageText(input, '- New item')
    expect(input.contentDOM.querySelector('.chat-input-bullet')?.textContent).toBe('•')
    expect(request).toHaveBeenLastCalledWith({ key: 'thread:ses_one', action: 'text', text: '- New item' })
  })

  it('keeps code fences, inline dashes and HTML literal', async () => {
    const text = '```md\n- Code, not a list\n```\n\nKeep - this.\n\n<img src="https://example.com/tracker" onerror="alert(1)">\n\n[Site](https://example.com)'
    const { input } = await setup(text)
    expect(input.state.doc.toString()).toBe(text)
    expect(input.contentDOM.querySelector('.chat-input-bullet')).toBeNull()
    expect(input.contentDOM.querySelector('script, iframe, img[src], a')).toBeNull()
  })

  it.each([
    ['Enter', { shiftKey: true }],
    ['j', { ctrlKey: true }],
  ])('continues and exits bullet lists with %s %j without sending', async (key, modifiers) => {
    const { input, send } = await setup()
    await setMessageText(input, '- First')
    expect((await pressMessageKey(input, key, modifiers)).defaultPrevented).toBe(true)
    expect(input.state.doc.toString()).toBe('- First\n- ')
    expect(input.contentDOM.querySelectorAll('.chat-input-bullet')).toHaveLength(2)
    await pressMessageKey(input, key, modifiers)
    expect(input.state.doc.toString()).toBe('- First\n')
    expect(send).not.toHaveBeenCalled()
  })

  it('splits an item at the caret and replaces selected text when inserting a newline', async () => {
    const { input } = await setup()
    await setMessageText(input, '- FirstSecond', 7)
    await pressMessageKey(input, 'Enter', { shiftKey: true })
    expect(input.state.doc.toString()).toBe('- First\n- Second')
    await setMessageText(input, 'Before selection after')
    await act(async () => input.dispatch({ selection: { anchor: 6, head: 17 } }))
    await pressMessageKey(input, 'j', { ctrlKey: true })
    expect(input.state.doc.toString()).toBe('Before\nafter')
  })

  it('sends a bullet list as plain Markdown with Enter, and keeps it on failure', async () => {
    const { input, send } = await setup('', true)
    await setMessageText(input, '- First\n- Second')
    await pressMessageKey(input, 'Enter')
    expect(send).toHaveBeenCalledExactlyOnceWith('- First\n- Second', expect.objectContaining({ attachmentIds: [] }))
    expect(input.state.doc.toString()).toBe('- First\n- Second')
    expect(container.textContent).toContain('Service unavailable')
    expect(input.contentDOM.querySelectorAll('.chat-input-bullet')).toHaveLength(2)
  })

  it('starts a list by typing and supports undo', async () => {
    const { input } = await setup()
    await setMessageText(input, '- ')
    expect(input.state.doc.toString()).toBe('- ')
    expect(input.state.selection.main.head).toBe(2)
    expect(input.contentDOM.querySelector('.chat-input-bullet')).not.toBeNull()
    await act(async () => { undo(input) })
    expect(input.state.doc.toString()).toBe('')
  })

  it('pastes plain text and ignores clipboard HTML, including scripts and remote images', async () => {
    const { input } = await setup()
    const text = '- Pasted\n<img src="https://example.com/tracker">'
    const event = new Event('paste', { bubbles: true, cancelable: true })
    const getData = vi.fn((type: string) => type === 'text/plain' ? text : '<script>alert(1)</script><img src="https://example.com/tracker">')
    Object.defineProperty(event, 'clipboardData', { value: { files: [], getData } })
    await act(async () => { input.contentDOM.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    expect(getData).toHaveBeenCalledExactlyOnceWith('text/plain')
    expect(input.state.doc.toString()).toBe(text)
    expect(input.contentDOM.querySelectorAll('.chat-input-bullet')).toHaveLength(1)
    expect(input.contentDOM.querySelector('script, iframe, img[src], a')).toBeNull()
  })

  it('does not carry undo history between thread drafts', async () => {
    const { input, render } = await setup('First draft')
    await setMessageText(input, 'First draft with changes')
    await render('thread:ses_two')
    const next = messageInput(container)
    expect(next).not.toBe(input)
    const text = next.state.doc.toString()
    await act(async () => { undo(next) })
    expect(next.state.doc.toString()).toBe(text)
  })

  it('disables list editing while the composer is disabled', async () => {
    const { input, render, send } = await setup('- Existing')
    await render('thread:ses_one', true)
    expect(input.state.readOnly).toBe(true)
    await pressMessageKey(input, 'Enter')
    await pressMessageKey(input, 'j', { ctrlKey: true })
    expect(input.state.doc.toString()).toBe('- Existing')
    expect(send).not.toHaveBeenCalled()
  })
})
