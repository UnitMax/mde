// @vitest-environment happy-dom
import { act, createElement } from 'react'
import type { EditorView } from '@codemirror/view'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatComposer, type ChatComposerProps } from '../src/renderer/components/inbox/ChatComposer'
import type { SlashCommand } from '../src/renderer/lib/slash-commands'
import type { ChatDraft, ChatDraftRequest, ChatSkill } from '../src/shared/types'
import { messageInput, pressMessageKey, setMessageText } from './helpers/chat-input'

let dispose: (() => void) | undefined
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => { await act(async () => dispose?.()); vi.unstubAllGlobals(); document.body.innerHTML = '' })

const skills: ChatSkill[] = [{ id: 'demo', name: 'demo', description: 'A demo skill' }, { id: 'deploy', name: 'Deploy', description: 'Ship it' }]

/** A command that asks for a question, like /btw, and one that takes nothing and one that takes an optional argument. */
function makeCommands(): { ask: SlashCommand; clear: SlashCommand; compact: SlashCommand; all: SlashCommand[] } {
  const ask: SlashCommand = { name: 'btw', description: 'Ask a side question', argument: { hint: 'your question', required: true }, run: vi.fn() }
  const clear: SlashCommand = { name: 'clear', aliases: ['reset'], description: 'Start over', run: vi.fn() }
  const compact: SlashCommand = { name: 'compact', description: 'Summarize the conversation', argument: { hint: 'what to keep', required: false }, run: vi.fn() }
  return { ask, clear, compact, all: [ask, clear, compact] }
}

async function setup(props: Partial<ChatComposerProps> & { initial?: string } = {}) {
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
  await act(async () => root.render(createElement(ChatComposer, {
    draftKey: 'thread:ses_one', agent: 'build', model: { id: 'm', providerId: 'p' },
    options: { status: 'ready', value: { agents: [], models: [], defaultModel: null, defaultAgent: null, skills } },
    onAgentChange: () => {}, onModelChange: () => {}, onSend: send,
    ...props,
  })))
  const box = messageInput(container)
  return { container, box, request, send }
}

const type = (box: EditorView, value: string, caret = value.length) => setMessageText(box, value, caret)
const press = pressMessageKey
const text = (box: EditorView): string => box.state.doc.toString()
const picker = (container: HTMLElement) => container.querySelector('[data-testid="slash-picker"]')
const names = (container: HTMLElement) => Array.from(container.querySelectorAll('[data-testid="slash-picker"] [role="option"]')).map((option) => option.getAttribute('data-testid')?.replace('slash-option-', ''))
const activeName = (container: HTMLElement) => container.querySelector('[data-testid="slash-picker"] [aria-selected="true"]')?.getAttribute('data-testid')?.replace('slash-option-', '')
const sendButton = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('[data-testid="chat-send"]')!
const alert = (container: HTMLElement) => container.querySelector('[role="alert"]')?.textContent
const flush = () => act(async () => { await Promise.resolve() })

describe('the / command list in the message box', () => {
  it('opens at a slash that starts the message, with every command and what each takes', async () => {
    const { all } = makeCommands()
    const { container, box } = await setup({ commands: all })
    await type(box, '/')
    expect(picker(container)).not.toBeNull()
    expect(picker(container)?.getAttribute('role')).toBe('listbox')
    expect(picker(container)?.getAttribute('aria-label')).toBe('Commands')
    expect(names(container)).toEqual(['btw', 'clear', 'compact'])
    const row = (name: string) => container.querySelector(`[data-testid="slash-option-${name}"]`)!.textContent
    // A required argument is shown as is, an optional one in brackets, none for a command that takes nothing.
    expect(row('btw')).toBe('/btwyour questionAsk a side question')
    expect(row('compact')).toBe('/compact[what to keep]Summarize the conversation')
    expect(row('clear')).toBe('/clearStart over')
    expect(activeName(container)).toBe('btw')
  })

  it('narrows as the name is typed, by name, alias or a word of the description', async () => {
    const { all } = makeCommands()
    const { container, box } = await setup({ commands: all })
    await type(box, '/c')
    expect(names(container)).toEqual(['clear', 'compact'])
    await type(box, '/res')
    expect(names(container)).toEqual(['clear'])
    await type(box, '/side')
    expect(names(container)).toEqual(['btw'])
  })

  it('stays closed for a slash that is not at the start, for a path, and for text that fits no command', async () => {
    const { all } = makeCommands()
    const { container, box } = await setup({ commands: all })
    await type(box, 'see /btw')
    expect(picker(container)).toBeNull()
    await type(box, '/etc/hosts')
    expect(picker(container)).toBeNull()
    await type(box, '/zzz')
    expect(picker(container)).toBeNull()
  })

  it('closes once the name is finished with a space', async () => {
    const { all } = makeCommands()
    const { container, box } = await setup({ commands: all })
    await type(box, '/btw')
    expect(picker(container)).not.toBeNull()
    await type(box, '/btw ')
    expect(picker(container)).toBeNull()
  })

  it('is not offered where there are no commands, such as the new-thread page, so a slash is plain text there', async () => {
    const { container, box, send } = await setup()
    await type(box, '/btw why')
    expect(picker(container)).toBeNull()
    expect(sendButton(container).dataset.command).toBeUndefined()
    await press(box, 'Enter')
    expect(send).toHaveBeenCalledWith('/btw why', expect.anything())
  })

  it('does not open for text that was put in the box from outside, such as a loaded draft or a recalled message', async () => {
    const { all } = makeCommands()
    const { container } = await setup({ commands: all, initial: '/b' })
    expect(picker(container)).toBeNull()
    const recalled = await setup({ commands: all, onPreviousMessage: async () => ({ id: 'msg_1', text: '/c' }) })
    await press(recalled.box, 'ArrowUp')
    expect(text(recalled.box)).toBe('/c')
    expect(picker(recalled.container)).toBeNull()
  })

  it('moves with Up and Down, wrapping round, and Escape closes it without leaving the text', async () => {
    const { all } = makeCommands()
    const { container, box } = await setup({ commands: all })
    await type(box, '/')
    await press(box, 'ArrowDown')
    expect(activeName(container)).toBe('clear')
    await press(box, 'ArrowUp')
    await press(box, 'ArrowUp')
    expect(activeName(container)).toBe('compact')
    const escape = await press(box, 'Escape')
    expect(escape.defaultPrevented).toBe(true)
    expect(picker(container)).toBeNull()
    expect(text(box)).toBe('/')
    // It stays closed while the same word is typed on, and opens again for a new one.
    await type(box, '/c')
    expect(picker(container)).toBeNull()
    await type(box, '')
    await type(box, '/')
    expect(picker(container)).not.toBeNull()
  })

  it('still offers skills for a $word, even in the arguments of a command', async () => {
    const { all } = makeCommands()
    const { container, box } = await setup({ commands: all })
    await type(box, '/btw use $de')
    expect(picker(container)).toBeNull()
    expect(container.querySelector('[data-testid="skill-picker"]')).not.toBeNull()
    await type(box, '$')
    expect(container.querySelector('[data-testid="skill-picker"]')).not.toBeNull()
    expect(picker(container)).toBeNull()
  })
})

describe('choosing a command', () => {
  it('Enter on a command that takes an argument writes it into the box to be finished, and runs nothing', async () => {
    const { ask, all } = makeCommands()
    const { container, box, send, request } = await setup({ commands: all })
    await type(box, '/bt')
    await press(box, 'Enter')
    expect(text(box)).toBe('/btw ')
    expect(box.state.selection.main.head).toBe(5)
    expect(picker(container)).toBeNull()
    expect(ask.run).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'text', text: '/btw ' }))
  })

  it('Tab writes any command into the box without running it, even one that takes nothing', async () => {
    const { clear, all } = makeCommands()
    const { box } = await setup({ commands: all })
    await type(box, '/cl')
    await press(box, 'Tab')
    expect(text(box)).toBe('/clear')
    expect(clear.run).not.toHaveBeenCalled()
  })

  it('Enter on a command that takes nothing runs it and empties the box', async () => {
    const { clear, all } = makeCommands()
    const { container, box, send, request } = await setup({ commands: all })
    await type(box, '/cl')
    await press(box, 'Enter')
    expect(clear.run).toHaveBeenCalledOnce()
    expect(clear.run).toHaveBeenCalledWith('')
    expect(text(box)).toBe('')
    expect(picker(container)).toBeNull()
    expect(send).not.toHaveBeenCalled()
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'text', text: '' }))
  })

  it('takes the highlighted row, so Down then Enter picks the second', async () => {
    const { compact, all } = makeCommands()
    const { box } = await setup({ commands: all })
    await type(box, '/c')
    await press(box, 'ArrowDown')
    await press(box, 'Enter')
    expect(text(box)).toBe('/compact ')
    expect(compact.run).not.toHaveBeenCalled()
  })

  it('a click on a row does the same as Enter, without taking focus from the box', async () => {
    const { clear, all } = makeCommands()
    const { container, box } = await setup({ commands: all })
    await type(box, '/')
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    container.querySelector('[data-testid="slash-option-btw"]')!.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    await act(async () => { container.querySelector<HTMLElement>('[data-testid="slash-option-btw"]')!.click() })
    expect(text(box)).toBe('/btw ')
    await type(box, '/')
    await act(async () => { container.querySelector<HTMLElement>('[data-testid="slash-option-clear"]')!.click() })
    expect(clear.run).toHaveBeenCalledOnce()
    expect(text(box)).toBe('')
  })

  it('puts the caret after the written name, so that typing goes on from there', async () => {
    const { all } = makeCommands()
    const { box } = await setup({ commands: all })
    await type(box, '/bt')
    await press(box, 'Enter')
    await type(box, '/btw why?')
    expect(text(box)).toBe('/btw why?')
  })
})

describe('running a command', () => {
  it('runs on Enter with what follows its name, empties the box at once and does not send a message', async () => {
    const { ask, all } = makeCommands()
    const { container, box, send, request } = await setup({ commands: all })
    await type(box, '/btw   why SQLite?\nand why not Postgres? ')
    await press(box, 'Enter')
    expect(ask.run).toHaveBeenCalledOnce()
    expect(ask.run).toHaveBeenCalledWith('why SQLite?\nand why not Postgres?')
    expect(text(box)).toBe('')
    expect(send).not.toHaveBeenCalled()
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'text', text: '' }))
    expect(alert(container)).toBeUndefined()
  })

  it('does not wait for the command: the box can be typed in while it is still working', async () => {
    const { ask, all } = makeCommands()
    let finish!: () => void
    ask.run = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const { box } = await setup({ commands: all })
    await type(box, '/btw why?')
    await press(box, 'Enter')
    expect(text(box)).toBe('')
    await type(box, 'a follow-up meanwhile')
    expect(text(box)).toBe('a follow-up meanwhile')
    await act(async () => finish())
    expect(text(box)).toBe('a follow-up meanwhile')
  })

  it('reads the name in any case and by alias', async () => {
    const { ask, clear, all } = makeCommands()
    const { box } = await setup({ commands: all })
    await type(box, '/BTW loud question')
    await press(box, 'Enter')
    expect(ask.run).toHaveBeenCalledWith('loud question')
    await type(box, '/Reset')
    await press(box, 'Escape')
    await press(box, 'Enter')
    expect(clear.run).toHaveBeenCalledOnce()
  })

  it('runs a command whose argument is optional with none', async () => {
    const { compact, all } = makeCommands()
    const { box } = await setup({ commands: all })
    await type(box, '/compact ')
    await press(box, 'Enter')
    expect(compact.run).toHaveBeenCalledWith('')
  })

  it('says what is missing when a required argument is, and keeps the text and runs nothing', async () => {
    const { ask, all } = makeCommands()
    const { container, box, send } = await setup({ commands: all })
    await type(box, '/btw ')
    await press(box, 'Enter')
    expect(alert(container)).toBe('Add your question after /btw.')
    expect(ask.run).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(text(box)).toBe('/btw ')
    // The next thing done clears the notice.
    await type(box, '/btw why')
    await press(box, 'Enter')
    expect(alert(container)).toBeUndefined()
    expect(ask.run).toHaveBeenCalledWith('why')
  })

  it('gives the text back and says why when the command fails', async () => {
    const { ask, all } = makeCommands()
    ask.run = vi.fn(async () => { throw new Error("Error invoking remote method 'chat:aside': Error: The OpenCode service did not answer in time.") })
    const { container, box, request } = await setup({ commands: all })
    await type(box, '/btw why?')
    await press(box, 'Enter')
    await flush()
    expect(alert(container)).toBe('The OpenCode service did not answer in time.')
    expect(text(box)).toBe('/btw why?')
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'text', text: '/btw why?' }))
  })

  it('is an ordinary message when the first word is not a command, and so is a path', async () => {
    const { ask, all } = makeCommands()
    const { box, send } = await setup({ commands: all })
    await type(box, '/etc/hosts is wrong')
    await press(box, 'Enter')
    expect(send).toHaveBeenLastCalledWith('/etc/hosts is wrong', expect.anything())
    await type(box, '/btwx hi')
    await press(box, 'Enter')
    expect(send).toHaveBeenLastCalledWith('/btwx hi', expect.anything())
    await type(box, 'please /btw hi')
    await press(box, 'Enter')
    expect(send).toHaveBeenLastCalledWith('please /btw hi', expect.anything())
    expect(ask.run).not.toHaveBeenCalled()
  })

  it('does not run while the box is switched off', async () => {
    const { ask, all } = makeCommands()
    const { box } = await setup({ commands: all, disabled: true })
    await type(box, '/btw why?')
    await press(box, 'Enter')
    expect(ask.run).not.toHaveBeenCalled()
  })
})

describe('the send button for a command', () => {
  it('becomes the command\'s own button once the message is one, and is the plain send button otherwise', async () => {
    const { all } = makeCommands()
    const { container, box } = await setup({ commands: all })
    expect(sendButton(container).dataset.command).toBeUndefined()
    expect(sendButton(container).getAttribute('aria-label')).toBe('Send')
    await type(box, '/btw why?')
    expect(sendButton(container).dataset.command).toBe('btw')
    expect(sendButton(container).getAttribute('aria-label')).toBe('Run /btw')
    expect(sendButton(container).title).toBe('Run /btw (Enter)')
    expect(sendButton(container).disabled).toBe(false)
    await type(box, '/btwx why?')
    expect(sendButton(container).dataset.command).toBeUndefined()
  })

  it('is off until the command has what it needs', async () => {
    const { all } = makeCommands()
    const { container, box } = await setup({ commands: all })
    await type(box, '/btw')
    expect(sendButton(container).dataset.command).toBe('btw')
    expect(sendButton(container).disabled).toBe(true)
    await type(box, '/btw ')
    expect(sendButton(container).disabled).toBe(true)
    await type(box, '/btw x')
    expect(sendButton(container).disabled).toBe(false)
    // A command that takes nothing, or an optional argument, is ready as it is.
    await type(box, '/clear')
    expect(sendButton(container).disabled).toBe(false)
    await type(box, '/compact')
    expect(sendButton(container).disabled).toBe(false)
  })

  it('runs the command when pressed', async () => {
    const { ask, all } = makeCommands()
    const { container, box, send } = await setup({ commands: all })
    await type(box, '/btw why?')
    await act(async () => { sendButton(container).click() })
    expect(ask.run).toHaveBeenCalledWith('why?')
    expect(send).not.toHaveBeenCalled()
    expect(text(box)).toBe('')
  })

  it('is never the Steer / Queue button, because a command is not delivered to the agent; a message still is', async () => {
    const { all } = makeCommands()
    const { container, box } = await setup({ commands: all, running: true, onStop: () => {} })
    await type(box, 'also add docs')
    expect(container.querySelector('[data-testid="chat-send-pill"]')).not.toBeNull()
    await type(box, '/btw what are you doing?')
    expect(container.querySelector('[data-testid="chat-send-pill"]')).toBeNull()
    expect(sendButton(container).dataset.command).toBe('btw')
  })

  it('sends no delivery with a command, and still sends one with a message while the agent works', async () => {
    const { ask, all } = makeCommands()
    const { box, send } = await setup({ commands: all, running: true, onStop: () => {} })
    await type(box, '/btw what are you doing?')
    await press(box, 'Enter')
    expect(ask.run).toHaveBeenCalledWith('what are you doing?')
    expect(send).not.toHaveBeenCalled()
    await type(box, 'carry on')
    await press(box, 'Enter')
    expect(send).toHaveBeenCalledWith('carry on', expect.objectContaining({ delivery: 'steer' }))
  })
})

describe('the command shown in the text', () => {
  const marked = (container: HTMLElement): string[] => Array.from(container.querySelectorAll('.chat-input-command')).map((element) => element.textContent ?? '')

  it('marks the name of a command the message starts with, and nothing else', async () => {
    const { all } = makeCommands()
    const { container, box } = await setup({ commands: all })
    await type(box, '/btw why /btw?')
    expect(marked(container)).toEqual(['/btw'])
    await type(box, '/BTW')
    expect(marked(container)).toEqual(['/BTW'])
    await type(box, '/Reset')
    expect(marked(container)).toEqual(['/Reset'])
  })

  it('marks nothing for a name that is still being typed, a name that is not one, or a slash that does not start the message', async () => {
    const { all } = makeCommands()
    const { container, box } = await setup({ commands: all })
    for (const value of ['/bt', '/btwx hi', '/etc/hosts', 'see /btw why', ' /btw why', 'plain text']) {
      await type(box, value)
      expect(marked(container)).toEqual([])
    }
  })

  it('marks nothing where there are no commands', async () => {
    const { container, box } = await setup()
    await type(box, '/btw why')
    expect(marked(container)).toEqual([])
  })
})

describe('Escape in the message box', () => {
  it('closes the open list and nothing else', async () => {
    const { all } = makeCommands()
    const onEscape = vi.fn(() => true)
    const { container, box } = await setup({ commands: all, onEscape })
    await type(box, '/')
    await press(box, 'Escape')
    expect(picker(container)).toBeNull()
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('is the page\'s when no list is open, and is used up when the page closed something', async () => {
    const onEscape = vi.fn(() => true)
    const { box } = await setup({ onEscape })
    const used = await press(box, 'Escape')
    expect(onEscape).toHaveBeenCalledOnce()
    expect(used.defaultPrevented).toBe(true)
  })

  it('is left alone when the page had nothing to close', async () => {
    const onEscape = vi.fn(() => false)
    const { box } = await setup({ onEscape })
    const unused = await press(box, 'Escape')
    expect(onEscape).toHaveBeenCalledOnce()
    expect(unused.defaultPrevented).toBe(false)
  })

  it('is not the page\'s with a modifier held', async () => {
    const onEscape = vi.fn(() => true)
    const { box } = await setup({ onEscape })
    await press(box, 'Escape', { shiftKey: true })
    await press(box, 'Escape', { ctrlKey: true })
    expect(onEscape).not.toHaveBeenCalled()
  })
})
