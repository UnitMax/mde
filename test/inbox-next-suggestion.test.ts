// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatComposer, type ChatComposerHandle, type ChatComposerProps } from '../src/renderer/components/inbox/ChatComposer'
import { suggestionTurn } from '../src/renderer/lib/next-suggestion'
import { shownSuggestion, useInboxSuggestion } from '../src/renderer/store/inbox-suggestion'
import { cleanSuggestion, SUGGESTION_MAX_LENGTH } from '../src/main/inbox/suggestion'
import type { ChatDraft, ChatDraftRequest, ChatMessage } from '../src/shared/types'
import { messageInput, pressMessageKey, setMessageText } from './helpers/chat-input'

describe('cleaning the model\'s guess', () => {
  it('keeps a plain message as it is', () => {
    expect(cleanSuggestion('Run the tests and commit.')).toBe('Run the tests and commit.')
  })

  it('takes the first line and strips labels, quotes, list markers and bold', () => {
    expect(cleanSuggestion('\n\n  User: "Now add a subtract function."\nBecause it follows.')).toBe('Now add a subtract function.')
    expect(cleanSuggestion('Next message: “Commit this.”')).toBe('Commit this.')
    expect(cleanSuggestion('- `npm test`')).toBe('npm test')
    expect(cleanSuggestion('**Suggested prompt:** Fix the failing test')).toBe('Fix the failing test')
    expect(cleanSuggestion('1. Push it')).toBe('Push it')
  })

  it('gives null for NONE and for nothing', () => {
    for (const answer of ['NONE', 'none.', '  ', '""', 'User:']) expect(cleanSuggestion(answer)).toBeNull()
  })

  it('cuts a long guess at a word', () => {
    const long = `${'word '.repeat(80)}end`
    const cleaned = cleanSuggestion(long)!
    expect(cleaned.length).toBeLessThanOrEqual(SUGGESTION_MAX_LENGTH + 1)
    expect(cleaned.endsWith('word…')).toBe(true)
  })

  it('does not take a sentence that only mentions a label word', () => {
    expect(cleanSuggestion('Message the team about the release')).toBe('Message the team about the release')
  })
})

const model = { id: 'm', providerId: 'p' }
const user = (id: string): ChatMessage => ({ kind: 'user', id, time: 1, text: 'Hi', files: [] } as unknown as ChatMessage)
const reply = (id: string, extra: Partial<Extract<ChatMessage, { kind: 'assistant' }>> = {}): ChatMessage =>
  ({ kind: 'assistant', id, time: 2, agent: 'build', model, parts: [], completed: true, ...extra })
const idle = { running: false, asking: false, held: 0, reverting: false }

describe('which turn a suggestion is for', () => {
  it('is the last reply when the conversation ends with a finished one', () => {
    expect(suggestionTurn([user('msg_1'), reply('msg_2')], idle)).toBe('msg_2')
  })

  it('is none while the agent works or waits, with a held message or a staged revert', () => {
    const messages = [user('msg_1'), reply('msg_2')]
    expect(suggestionTurn(messages, { ...idle, running: true })).toBeNull()
    expect(suggestionTurn(messages, { ...idle, asking: true })).toBeNull()
    expect(suggestionTurn(messages, { ...idle, held: 1 })).toBeNull()
    expect(suggestionTurn(messages, { ...idle, reverting: true })).toBeNull()
  })

  it('is none after an unfinished or failed step, a note, a lone message or nothing', () => {
    expect(suggestionTurn([user('msg_1'), reply('msg_2', { completed: false })], idle)).toBeNull()
    expect(suggestionTurn([user('msg_1'), reply('msg_2', { error: 'Aborted' })], idle)).toBeNull()
    expect(suggestionTurn([reply('msg_2'), { kind: 'note', id: 'n', time: 3, tone: 'info', text: 'Compacted' }], idle)).toBeNull()
    expect(suggestionTurn([user('msg_1')], idle)).toBeNull()
    expect(suggestionTurn([], idle)).toBeNull()
  })
})

describe('the suggestion store', () => {
  beforeEach(() => useInboxSuggestion.setState({ threads: {} }))
  afterEach(() => vi.unstubAllGlobals())

  const stubApi = (suggest: (req: { threadId: string }) => Promise<{ text: string | null }>) =>
    Object.defineProperty(window, 'api', { configurable: true, value: { chat: { suggest: vi.fn(suggest) } } })

  it('asks once per turn and shows the answer for that turn only', async () => {
    stubApi(async () => ({ text: 'Run the tests' }))
    const { request } = useInboxSuggestion.getState()
    await request('ses_a', 'msg_2')
    await request('ses_a', 'msg_2')
    expect(window.api.chat.suggest).toHaveBeenCalledTimes(1)
    const entry = useInboxSuggestion.getState().threads.ses_a
    expect(shownSuggestion(entry, 'msg_2')).toBe('Run the tests')
    expect(shownSuggestion(entry, 'msg_4')).toBeNull()
    expect(shownSuggestion(entry, null)).toBeNull()
  })

  it('shows nothing while asking, after a failure, or once dismissed', async () => {
    let answer!: (value: { text: string | null }) => void
    stubApi(() => new Promise((resolve) => { answer = resolve }))
    const asked = useInboxSuggestion.getState().request('ses_a', 'msg_2')
    expect(shownSuggestion(useInboxSuggestion.getState().threads.ses_a, 'msg_2')).toBeNull()
    answer({ text: 'Commit it' })
    await asked
    expect(shownSuggestion(useInboxSuggestion.getState().threads.ses_a, 'msg_2')).toBe('Commit it')
    useInboxSuggestion.getState().dismiss('ses_a')
    expect(shownSuggestion(useInboxSuggestion.getState().threads.ses_a, 'msg_2')).toBeNull()

    stubApi(async () => { throw new Error('503') })
    await expect(useInboxSuggestion.getState().request('ses_b', 'msg_9')).resolves.toBeUndefined()
    expect(shownSuggestion(useInboxSuggestion.getState().threads.ses_b, 'msg_9')).toBeNull()
  })

  it('drops an answer that arrives after a newer turn asked', async () => {
    const answers: ((value: { text: string | null }) => void)[] = []
    stubApi(() => new Promise((resolve) => { answers.push(resolve) }))
    const first = useInboxSuggestion.getState().request('ses_a', 'msg_2')
    const second = useInboxSuggestion.getState().request('ses_a', 'msg_4')
    answers[1]!({ text: 'New' })
    answers[0]!({ text: 'Old' })
    await Promise.all([first, second])
    expect(useInboxSuggestion.getState().threads.ses_a).toMatchObject({ turn: 'msg_4', text: 'New' })
  })
})

describe('the suggestion in the message box', () => {
  let dispose: (() => void) | undefined
  beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
  afterEach(async () => { await act(async () => dispose?.()); vi.unstubAllGlobals(); document.body.innerHTML = '' })

  async function setup(props: Partial<ChatComposerProps> & { initial?: string } = {}, ref?: { current: ChatComposerHandle | null }) {
    let draft: ChatDraft = { text: props.initial ?? '', revision: 0, attachments: [] }
    const request = vi.fn(async (input: ChatDraftRequest) => {
      if (input.action === 'text') draft = { ...draft, text: input.text, revision: draft.revision + 1 }
      return draft
    })
    Object.defineProperty(window, 'api', { configurable: true, value: { chat: { draft: request } } })
    const send = vi.fn(async () => {})
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    dispose = () => root.unmount()
    const all: ChatComposerProps = {
      draftKey: 'thread:ses_one', agent: 'build', model,
      options: { status: 'ready' as const, value: { agents: [], models: [], defaultModel: null, defaultAgent: null, skills: [] } },
      onAgentChange: () => {}, onModelChange: () => {}, onSend: send,
      ...props,
    }
    await act(async () => root.render(createElement(ChatComposer, { ...all, ref })))
    const rerender = (next: Partial<ChatComposerProps>) => act(async () => root.render(createElement(ChatComposer, { ...all, ...next, ref })))
    return { container, box: messageInput(container), send, request, rerender }
  }
  const ghost = (container: HTMLElement) => container.querySelector('[data-testid="chat-suggestion"]')

  it('shows the suggestion as ghost text with a Tab hint in the empty box, and Tab takes it without sending', async () => {
    const { container, box, send, request } = await setup({ suggestion: 'Run the tests' })
    expect(ghost(container)?.textContent).toBe('Run the testsTab')
    // Enter in the empty box sends nothing: a suggestion is only sent once it is taken.
    await pressMessageKey(box, 'Enter')
    expect(send).not.toHaveBeenCalled()
    const tab = await pressMessageKey(box, 'Tab')
    expect(tab.defaultPrevented).toBe(true)
    expect(box.state.doc.toString()).toBe('Run the tests')
    expect(box.state.selection.main.head).toBe('Run the tests'.length)
    expect(ghost(container)).toBeNull()
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ action: 'text', text: 'Run the tests' }))
    await pressMessageKey(box, 'Enter')
    expect(send).toHaveBeenCalledWith('Run the tests', expect.anything())
  })

  it('also takes it with the right arrow', async () => {
    const { box } = await setup({ suggestion: 'Commit it' })
    await pressMessageKey(box, 'ArrowRight')
    expect(box.state.doc.toString()).toBe('Commit it')
  })

  it('hides while something is typed and comes back when the box is empty again', async () => {
    const { container, box } = await setup({ suggestion: 'Commit it' })
    await setMessageText(box, 'my own')
    expect(ghost(container)).toBeNull()
    // Tab with text in the box is not taken for the suggestion.
    await pressMessageKey(box, 'Tab')
    expect(box.state.doc.toString()).toBe('my own')
    await setMessageText(box, '')
    expect(ghost(container)).not.toBeNull()
  })

  it('is not shown over a loaded draft', async () => {
    const { container } = await setup({ suggestion: 'Commit it', initial: 'half a thought' })
    expect(ghost(container)).toBeNull()
  })

  it('Escape puts it away before anything else Escape closes', async () => {
    const onDismissSuggestion = vi.fn()
    const onEscape = vi.fn(() => true)
    const { box, rerender, container } = await setup({ suggestion: 'Commit it', onDismissSuggestion, onEscape })
    const escape = await pressMessageKey(box, 'Escape')
    expect(escape.defaultPrevented).toBe(true)
    expect(onDismissSuggestion).toHaveBeenCalledTimes(1)
    expect(onEscape).not.toHaveBeenCalled()
    await rerender({ suggestion: null, onDismissSuggestion, onEscape })
    expect(ghost(container)).toBeNull()
    await pressMessageKey(box, 'Escape')
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('tells the page whether the box is blank', async () => {
    const ref: { current: ChatComposerHandle | null } = { current: null }
    const { box } = await setup({}, ref)
    expect(ref.current?.isBlank()).toBe(true)
    await setMessageText(box, 'x')
    expect(ref.current?.isBlank()).toBe(false)
  })
})
