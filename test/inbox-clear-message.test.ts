// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatComposer, type ChatComposerProps } from '../src/renderer/components/inbox/ChatComposer'
import type { ChatDraft, ChatDraftRequest } from '../src/shared/types'
import { requestInboxComposerFocus } from '../src/renderer/lib/inbox-composer-focus'
import { messageInput, pressMessageKey, setMessageText } from './helpers/chat-input'

const model = { id: 'm', providerId: 'p' }
const file = (id: string) => ({ id, name: `${id}.txt`, mime: 'text/plain', size: 3 })

describe('Ctrl+C in the message box', () => {
  let dispose: (() => void) | undefined
  beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
  afterEach(async () => { await act(async () => dispose?.()); vi.unstubAllGlobals(); document.body.innerHTML = '' })

  async function setup(initial: Partial<ChatDraft>) {
    let draft = { text: '', revision: 0, attachments: [], ...initial } as ChatDraft
    const request = vi.fn(async (input: ChatDraftRequest) => {
      if (input.action === 'text') draft = { ...draft, text: input.text, revision: draft.revision + 1 }
      if (input.action === 'remove') draft = { ...draft, attachments: draft.attachments.filter((item) => item.id !== input.attachmentId) }
      return draft
    })
    Object.defineProperty(window, 'api', { configurable: true, value: { chat: { draft: request } } })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    dispose = () => root.unmount()
    const props: ChatComposerProps = {
      draftKey: 'thread:ses_one', agent: 'build', model,
      options: { status: 'ready' as const, value: { agents: [], models: [], defaultModel: null, defaultAgent: null, skills: [] } },
      onAgentChange: () => {}, onModelChange: () => {}, onSend: vi.fn(async () => {}),
    }
    await act(async () => root.render(createElement(ChatComposer, props)))
    return { container, box: messageInput(container), request, current: () => draft }
  }

  it('with nothing selected clears the text, the quotes and the attached files', async () => {
    const { container, box, request, current } = await setup({
      text: '> a quoted line\n\nmy message',
      attachments: [file('att_1'), file('att_2')] as ChatDraft['attachments'],
    })
    expect(container.querySelector('[data-testid="chat-quotes"]')).not.toBeNull()
    expect(box.state.doc.toString()).toBe('my message')
    const event = await pressMessageKey(box, 'c', { ctrlKey: true })
    expect(event.defaultPrevented).toBe(true)
    expect(box.state.doc.toString()).toBe('')
    expect(container.querySelector('[data-testid="chat-quotes"]')).toBeNull()
    await vi.waitFor(() => expect(current().attachments).toHaveLength(0))
    expect(container.querySelector('[aria-label="Attachments"]')).toBeNull()
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ action: 'text', text: '' }))
    expect(current().text).toBe('')
  })

  it('copies as usual while text is selected, and does nothing in an empty box', async () => {
    const { box, request } = await setup({ text: 'keep me' })
    await act(async () => { box.dispatch({ selection: { anchor: 0, head: 4 } }) })
    const copy = await pressMessageKey(box, 'c', { ctrlKey: true })
    expect(copy.defaultPrevented).toBe(false)
    expect(box.state.doc.toString()).toBe('keep me')

    await setMessageText(box, '')
    request.mockClear()
    const empty = await pressMessageKey(box, 'c', { ctrlKey: true })
    expect(empty.defaultPrevented).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  it('leaves Cmd+C and Ctrl+Shift+C alone', async () => {
    const { box } = await setup({ text: 'keep me' })
    expect((await pressMessageKey(box, 'c', { metaKey: true })).defaultPrevented).toBe(false)
    expect((await pressMessageKey(box, 'C', { ctrlKey: true, shiftKey: true })).defaultPrevented).toBe(false)
    expect(box.state.doc.toString()).toBe('keep me')
  })
})

describe('F9 from elsewhere in the Inbox', () => {
  let dispose: (() => void) | undefined
  beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
  afterEach(async () => { await act(async () => dispose?.()); vi.unstubAllGlobals(); document.body.innerHTML = '' })

  it('gives the message box the keyboard, with the caret where it was left', async () => {
    const draft = { text: 'half a thought', revision: 0, attachments: [] } as unknown as ChatDraft
    Object.defineProperty(window, 'api', { configurable: true, value: { chat: { draft: vi.fn(async () => draft) } } })
    const outside = document.createElement('button')
    const container = document.createElement('div')
    document.body.append(outside, container)
    const root = createRoot(container)
    dispose = () => root.unmount()
    await act(async () => root.render(createElement(ChatComposer, {
      draftKey: 'thread:ses_one', agent: 'build', model,
      options: { status: 'ready' as const, value: { agents: [], models: [], defaultModel: null, defaultAgent: null, skills: [] } },
      onAgentChange: () => {}, onModelChange: () => {}, onSend: vi.fn(async () => {}),
    })))
    const box = messageInput(container)
    await act(async () => { box.dispatch({ selection: { anchor: 4 } }) })
    outside.focus()
    expect(box.hasFocus).toBe(false)
    await act(async () => requestInboxComposerFocus())
    expect(box.hasFocus).toBe(true)
    expect(box.state.selection.main.head).toBe(4)
  })
})
