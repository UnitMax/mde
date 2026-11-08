// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatDraft, ChatMessage, ChatMessagesPage, ChatOptions, InboxFolder, InboxThread } from '../src/shared/types'
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useWorkspace } from '../src/renderer/store/workspace'
import { messageInput, pressMessageKey, setMessageText } from './helpers/chat-input'

const roots: Root[] = []

const folder: InboxFolder = {
  id: 'fld_app', name: 'app', directory: '/home/me/app',
  target: { kind: 'wsl', distro: 'Ubuntu' }, createdAt: 1, lastUsedAt: 1,
}
const model = { id: 'free-1', providerId: 'opencode' }
const options: ChatOptions = {
  agents: [{ id: 'build', name: 'Build' }],
  models: [{ id: 'free-1', providerId: 'opencode', providerName: 'OpenCode', name: 'Flint Free' }],
  defaultModel: model,
  defaultAgent: 'build',
  skills: [],
}

function thread(): InboxThread {
  return {
    id: 'ses_one', title: 'Fix login', directory: '/home/me/app', target: { kind: 'wsl', distro: 'Ubuntu' },
    branch: 'main', model, status: 'completed',
    createdAt: 1, lastActivityAt: Date.now(), readAt: Date.now(), archived: false, folderId: 'fld_app',
  }
}

const LONG_QUOTE = Array.from({ length: 9 }, (_, index) => `quoted line ${index + 1}`).join('\n')
const conversation: ChatMessage[] = [
  { kind: 'user', id: 'msg_1', time: 1, text: 'Fix the login' },
  {
    kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model, completed: true,
    parts: [{ kind: 'text', text: 'The token is checked twice.\n\nIt should be checked once.' }],
  },
  { kind: 'user', id: 'msg_3', time: 3, text: 'Look at this\n\n> checked twice\n\nWhy is that?' },
  { kind: 'user', id: 'msg_3b', time: 3, text: '> one\n> two\n> three\n\nthree lines' },
  { kind: 'user', id: 'msg_4', time: 4, text: `${LONG_QUOTE.replace(/^/gm, '> ')}\n\nand this too` },
  { kind: 'user', id: 'msg_5', time: 5, text: 'first line  \n\n\n\nsecond line' },
]

let page: ChatMessagesPage
let draft: (req: { action: string; text?: string }) => Promise<ChatDraft>
const api = {
  inbox: {
    setRead: vi.fn(async () => null),
    folders: vi.fn(async () => ({ folders: [folder], composer: {} })),
    gitInfo: vi.fn(async () => ({ repository: false, branch: null, branches: [] })),
  },
  clipboard: { writeText: vi.fn(async (_text: string): Promise<void> => undefined), paste: vi.fn(async () => undefined) },
  chat: {
    draft: vi.fn((req: { action: string; text?: string }) => draft(req)),
    options: vi.fn(async () => options),
    messages: vi.fn(async () => page),
    requests: vi.fn(async () => ({ permissions: [], forms: [] })),
    subscribe: vi.fn(async () => undefined),
    unsubscribe: vi.fn(async () => undefined),
    send: vi.fn(async (_request: unknown) => null),
  },
}

async function render(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(createElement(InboxThreadView)))
  await vi.waitFor(() => expect(container.querySelector('[data-testid="chat-transcript"]')).not.toBeNull())
  await vi.waitFor(() => expect(container.textContent).not.toContain('Loading conversation'))
  await vi.waitFor(() => expect(container.querySelector('[data-testid="chat-input"] .cm-content')).not.toBeNull())
  // The box is switched off until the draft has loaded.
  await vi.waitFor(() => expect(messageInput(container).contentDOM.getAttribute('aria-disabled')).toBe('false'))
  return container
}

const items = (): HTMLElement[] => Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'))
const labels = (): string[] => items().map((item) => item.textContent?.trim() ?? '')
const quoteButton = (): HTMLElement | null => document.body.querySelector('[data-testid="chat-quote-button"]')
/** The quotes attached to the message, as the cards above the box show them. */
const cards = (view: HTMLElement): string[] =>
  Array.from(view.querySelectorAll('[data-testid="chat-quotes"] [data-testid="chat-quote-text"]'), (card) => card.textContent ?? '')
/** What the draft was last kept as. */
const kept = (): string | undefined =>
  api.chat.draft.mock.calls.map(([request]) => request as { action: string; text?: string }).filter((request) => request.action === 'text').at(-1)?.text

async function rightClick(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20, button: 2 }))
  })
}

/** Selects the text of an element, as dragging across it would, and lets the page see that it changed. */
async function select(element: Element): Promise<void> {
  // Pressing in the conversation takes the focus out of the message box, which would otherwise put its caret back
  // as the selection (CodeMirror does that on its own schedule) and race with the one made here.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  const range = document.createRange()
  range.selectNodeContents(element)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  await act(async () => { document.dispatchEvent(new Event('selectionchange')) })
}

const press = (target: Element, type: 'pointerdown' | 'pointerup', button = 0): Promise<void> =>
  act(async () => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button })) })

const paragraph = (view: HTMLElement): Element => view.querySelector('[data-chat-message="msg_2"] p')!
/** Blank space in the conversation, in a message that the page leaves alone (a reply is redrawn by its editor). */
function blankSpace(view: HTMLElement): HTMLElement {
  const blank = document.createElement('span')
  blank.textContent = ' \n '
  view.querySelector('[data-chat-message="msg_1"]')!.append(blank)
  return blank
}
const box = (view: HTMLElement): string => messageInput(view).state.doc.toString()

/** Selects the text of an element and clicks the Quote button that shows for it. */
async function quote(element: Element): Promise<void> {
  await select(element)
  await vi.waitFor(() => expect(quoteButton()).not.toBeNull())
  await act(async () => quoteButton()!.click())
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('api', api)
  draft = async (req) => ({ text: req.text ?? '', revision: 1, attachments: [] })
  api.chat.draft.mockClear()
  api.chat.send.mockClear()
  page = { messages: conversation, older: null, running: false }
  useWorkspace.setState({
    platform: { platform: 'win32', isWindows: true },
    wslAvailable: true,
    inboxThreads: [thread()],
    selectedInboxThreadId: 'ses_one',
    activeWorkspaceView: 'inbox',
  })
  useInboxChat.setState({ folders: [folder], composer: { folderId: 'fld_app' }, foldersLoaded: true, options: {}, threads: {}, recent: [], titleRegenerations: {} })
})

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()))
  window.getSelection()?.removeAllRanges()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the Quote button by a selection', () => {
  it('shows once text of the conversation is selected, and not before', async () => {
    const view = await render()
    expect(quoteButton()).toBeNull()
    await select(paragraph(view))
    await vi.waitFor(() => expect(quoteButton()).not.toBeNull())
    expect(quoteButton()!.textContent).toBe('Quote')
  })

  it('goes away with the selection', async () => {
    const view = await render()
    await select(paragraph(view))
    await vi.waitFor(() => expect(quoteButton()).not.toBeNull())
    window.getSelection()!.removeAllRanges()
    await act(async () => { document.dispatchEvent(new Event('selectionchange')) })
    await vi.waitFor(() => expect(quoteButton()).toBeNull())
  })

  it('waits for the pointer to be let go instead of following a selection that is still being made', async () => {
    const view = await render()
    await press(paragraph(view), 'pointerdown')
    await select(paragraph(view))
    // Still pressed: the selection is not finished.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(quoteButton()).toBeNull()
    await press(document.body, 'pointerup')
    await vi.waitFor(() => expect(quoteButton()).not.toBeNull())
  })

  it('is not shown for a selection of blank space, or one outside the conversation', async () => {
    const view = await render()
    await select(blankSpace(view))
    expect(window.getSelection()!.toString()).toBe(' \n ')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(quoteButton()).toBeNull()

    // The message box is not the conversation.
    await select(view.querySelector('[data-testid="chat-input"]')!)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(quoteButton()).toBeNull()

    // Nor is a selection that starts in the conversation and runs on out of it.
    const range = document.createRange()
    range.setStart(paragraph(view).firstChild!, 2)
    range.setEnd(view.querySelector('[data-testid="chat-input"]')!, 0)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    await act(async () => { document.dispatchEvent(new Event('selectionchange')) })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(quoteButton()).toBeNull()
  })
})

describe('attaching a quote', () => {
  it('shows the selected text as a card above the box and leaves the box free for what you write', async () => {
    const view = await render()
    await select(paragraph(view))
    await vi.waitFor(() => expect(quoteButton()).not.toBeNull())
    // Pressing the button must not take the selection or the focus.
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    quoteButton()!.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    await act(async () => quoteButton()!.click())

    expect(cards(view)).toEqual(['The token is checked twice.'])
    expect(box(view)).toBe('')
    expect(messageInput(view).hasFocus).toBe(true)
    expect(window.getSelection()!.isCollapsed).toBe(true)
    await vi.waitFor(() => expect(quoteButton()).toBeNull())
    // It is part of the draft, which is kept as a block quote ahead of the text.
    expect(kept()).toBe('> The token is checked twice.')
  })

  it('takes a selection of several lines tidied, with its blank line inside the card', async () => {
    const view = await render()
    await quote(view.querySelector('[data-chat-message="msg_5"]')!)
    expect(cards(view)).toEqual(['first line\n\nsecond line'])
    expect(kept()).toBe('> first line\n>\n> second line')
  })

  it('keeps what is typed apart from the quotes, and keeps the two together in the draft', async () => {
    const view = await render()
    await setMessageText(messageInput(view), 'Why is this?')
    await quote(paragraph(view))
    expect(box(view)).toBe('Why is this?')
    expect(kept()).toBe('> The token is checked twice.\n\nWhy is this?')

    await quote(view.querySelector('[data-chat-message="msg_1"]')!)
    expect(cards(view)).toEqual(['The token is checked twice.', 'Fix the login'])
    expect(kept()).toBe('> The token is checked twice.\n\n> Fix the login\n\nWhy is this?')

    // Typing goes on keeping them together.
    await setMessageText(messageInput(view), 'Why is this so?')
    expect(kept()).toBe('> The token is checked twice.\n\n> Fix the login\n\nWhy is this so?')
  })

  it('brings a card just added into view when there are many, but not for a draft just loaded', async () => {
    // The page has no layout; the region is made to be 500 tall inside a view, to see where it is scrolled to.
    const heights = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'chat-quotes' ? 500 : 0
    })
    draft = async (req) => ({ text: req.action === 'load' ? '> kept one\n\n> kept two' : (req.text ?? ''), revision: 1, attachments: [] })
    const view = await render()
    await vi.waitFor(() => expect(cards(view)).toEqual(['kept one', 'kept two']))
    const region = view.querySelector<HTMLElement>('[data-testid="chat-quotes"]')!
    expect(region.scrollTop).toBe(0)
    await quote(paragraph(view))
    expect(cards(view)).toHaveLength(3)
    expect(region.scrollTop).toBe(500)
    heights.mockRestore()
  })

  it('does not attach the same text twice', async () => {
    const view = await render()
    await quote(paragraph(view))
    await quote(paragraph(view))
    expect(cards(view)).toEqual(['The token is checked twice.'])
  })

  it('takes a card off with its X, and the draft goes with it', async () => {
    const view = await render()
    await setMessageText(messageInput(view), 'Why is this?')
    await quote(paragraph(view))
    await quote(view.querySelector('[data-chat-message="msg_1"]')!)
    const first = view.querySelector<HTMLElement>('[data-testid="chat-quote-remove"]')!
    expect(first.getAttribute('aria-label')).toBe('Remove quote')
    await act(async () => first.click())
    expect(cards(view)).toEqual(['Fix the login'])
    expect(kept()).toBe('> Fix the login\n\nWhy is this?')
    expect(messageInput(view).hasFocus).toBe(true)

    await act(async () => view.querySelector<HTMLElement>('[data-testid="chat-quote-remove"]')!.click())
    expect(cards(view)).toEqual([])
    expect(view.querySelector('[data-testid="chat-quotes"]')).toBeNull()
    expect(kept()).toBe('Why is this?')
  })

  it('refuses a quote that would make the message too long, and says so', async () => {
    const view = await render()
    await setMessageText(messageInput(view), 'x'.repeat(99_990))
    await select(paragraph(view))
    await vi.waitFor(() => expect(quoteButton()).not.toBeNull())
    await act(async () => quoteButton()!.click())
    expect(cards(view)).toEqual([])
    expect(view.querySelector('[data-testid="chat-composer"]')!.parentElement!.textContent).toContain('too much text')
  })

  it('waits for the draft to load, then attaches the quote to it', async () => {
    let release: (value: ChatDraft) => void = () => undefined
    draft = (req) => (req.action === 'load'
      ? new Promise<ChatDraft>((resolve) => { release = resolve })
      : Promise.resolve({ text: req.text ?? '', revision: 1, attachments: [] }))
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => root.render(createElement(InboxThreadView)))
    await vi.waitFor(() => expect(container.querySelector('[data-chat-message="msg_2"] p')).not.toBeNull())
    await select(container.querySelector('[data-chat-message="msg_2"] p')!)
    await vi.waitFor(() => expect(quoteButton()).not.toBeNull())
    await act(async () => quoteButton()!.click())
    expect(cards(container)).toEqual([])
    // The quote is asked for, so the selection goes and the button with it, though the box has not taken it yet.
    expect(window.getSelection()!.isCollapsed).toBe(true)
    expect(quoteButton()).toBeNull()

    await act(async () => release({ text: 'Saved earlier', revision: 3, attachments: [] }))
    await vi.waitFor(() => expect(cards(container)).toEqual(['The token is checked twice.']))
    expect(box(container)).toBe('Saved earlier')
    expect(kept()).toBe('> The token is checked twice.\n\nSaved earlier')
  })
})

describe('quotes in a draft', () => {
  it('come back as cards when the draft is loaded, leaving the rest as the text', async () => {
    draft = async (req) => ({ text: req.action === 'load' ? '> kept one\n\n> kept two\n\nand some text' : (req.text ?? ''), revision: 1, attachments: [] })
    const view = await render()
    await vi.waitFor(() => expect(cards(view)).toEqual(['kept one', 'kept two']))
    expect(box(view)).toBe('and some text')
  })

  it('leave a quote that is not at the start in the text, where the box marks it as a quote', async () => {
    draft = async (req) => ({ text: req.action === 'load' ? 'Look:\n\n> inside' : (req.text ?? ''), revision: 1, attachments: [] })
    const view = await render()
    await vi.waitFor(() => expect(box(view)).toBe('Look:\n\n> inside'))
    expect(cards(view)).toEqual([])
    const lines = view.querySelectorAll('[data-testid="chat-input"] .chat-input-quote-line')
    expect(Array.from(lines, (line) => line.textContent)).toEqual(['> inside'])
  })

  it('are cut to two lines, with a way to open all of a long one', async () => {
    draft = async (req) => ({ text: req.action === 'load' ? `${LONG_QUOTE.replace(/^/gm, '> ')}\n\nnote` : (req.text ?? ''), revision: 1, attachments: [] })
    const view = await render()
    await vi.waitFor(() => expect(cards(view)).toEqual([LONG_QUOTE]))
    const text = view.querySelector<HTMLElement>('[data-testid="chat-quotes"] [data-testid="chat-quote-text"]')!
    expect(text.className).toContain('line-clamp-2')
    const toggle = view.querySelector<HTMLElement>('[data-testid="chat-quotes"] [data-testid="chat-quote-toggle"]')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-label')).toBe('Show all of the quote')

    await act(async () => toggle.click())
    expect(text.className).not.toContain('line-clamp-2')
    expect(text.className).toContain('max-h-48')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.getAttribute('aria-label')).toBe('Show less of the quote')
    // Both ways all of it is there; the cut is only how it is drawn.
    expect(text.textContent).toBe(LONG_QUOTE)
  })

  it('are cut at two lines in the box, so that a quote of three lines can be opened there', async () => {
    draft = async (req) => ({ text: req.action === 'load' ? '> one\n> two\n> three' : (req.text ?? ''), revision: 1, attachments: [] })
    const view = await render()
    await vi.waitFor(() => expect(cards(view)).toEqual(['one\ntwo\nthree']))
    expect(view.querySelector('[data-testid="chat-quotes"] [data-testid="chat-quote-toggle"]')).not.toBeNull()
  })

  it('give a short quote no toggle', async () => {
    const view = await render()
    await quote(paragraph(view))
    expect(view.querySelector('[data-testid="chat-quotes"] [data-testid="chat-quote-toggle"]')).toBeNull()
  })

  it('give a quote of one line a toggle too, when its width makes it wrap past the two lines it is cut to', async () => {
    // The page has no layout: the text is made to be taller than the room it has.
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'chat-quote-text' ? 100 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'chat-quote-text' ? 40 : 0
    })
    const view = await render()
    await quote(paragraph(view))
    expect(cards(view)).toEqual(['The token is checked twice.'])
    expect(view.querySelector('[data-testid="chat-quotes"] [data-testid="chat-quote-toggle"]')).not.toBeNull()
  })

  it('put the caret in the text when a message is added to the draft from outside, such as by a revert', async () => {
    const view = await render()
    draft = async (req) => ({ text: req.action === 'load' ? '> q\n\nHello world' : (req.text ?? ''), revision: 2, attachments: [] })
    // The caret is where the added text ends, counted in the draft, quotes included.
    await act(async () => { useInboxChat.setState({ draftReloads: { ses_one: { id: 1, caret: '> q\n\nHello'.length } } }) })
    await vi.waitFor(() => expect(cards(view)).toEqual(['q']))
    expect(box(view)).toBe('Hello world')
    await vi.waitFor(() => expect(messageInput(view).state.selection.main.head).toBe('Hello'.length))
  })
})

describe('sending with quotes', () => {
  const ready = async (view: HTMLElement): Promise<void> => {
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-model-picker"]')?.textContent).toContain('Flint Free'))
  }

  it('sends the quotes as block quotes ahead of the text, and clears the cards', async () => {
    const view = await render()
    await ready(view)
    await quote(paragraph(view))
    await setMessageText(messageInput(view), 'Why is that?')
    await pressMessageKey(messageInput(view), 'Enter')
    await vi.waitFor(() => expect(api.chat.send).toHaveBeenCalledTimes(1))
    expect(api.chat.send.mock.calls[0]![0]).toMatchObject({ threadId: 'ses_one', text: '> The token is checked twice.\n\nWhy is that?' })
    await vi.waitFor(() => expect(cards(view)).toEqual([]))
    expect(box(view)).toBe('')
  })

  it('can send quotes alone', async () => {
    const view = await render()
    await ready(view)
    await quote(paragraph(view))
    await pressMessageKey(messageInput(view), 'Enter')
    await vi.waitFor(() => expect(api.chat.send).toHaveBeenCalledTimes(1))
    expect(api.chat.send.mock.calls[0]![0]).toMatchObject({ text: '> The token is checked twice.' })
  })

  it('shows Send, not Stop, while the agent works and quotes are attached to an empty box', async () => {
    page = { messages: conversation, older: null, running: true }
    const view = await render()
    await ready(view)
    await vi.waitFor(() => expect(view.querySelector('button[aria-label="Stop"]')).not.toBeNull())
    await quote(paragraph(view))
    expect(view.querySelector('button[aria-label="Stop"]')).toBeNull()
    await pressMessageKey(messageInput(view), 'Enter')
    await vi.waitFor(() => expect(api.chat.send).toHaveBeenCalledTimes(1))
  })

  it('does not send an empty message', async () => {
    const view = await render()
    await ready(view)
    await pressMessageKey(messageInput(view), 'Enter')
    expect(api.chat.send).not.toHaveBeenCalled()
  })

  it('brings a recalled message back with its quotes as cards', async () => {
    const view = await render()
    await ready(view)
    // The newest message is msg_5; the one before it is msg_4, which starts with a long quote.
    await pressMessageKey(messageInput(view), 'ArrowUp')
    await vi.waitFor(() => expect(box(view)).toBe('first line  \n\n\n\nsecond line'))
    await pressMessageKey(messageInput(view), 'ArrowUp')
    await vi.waitFor(() => expect(cards(view)).toEqual([LONG_QUOTE]))
    expect(box(view)).toBe('and this too')
    expect(kept()).toBe(`${LONG_QUOTE.replace(/^/gm, '> ')}\n\nand this too`)
  })

  it('does not recall a message while quotes are attached to an empty box', async () => {
    const view = await render()
    await ready(view)
    await quote(paragraph(view))
    await pressMessageKey(messageInput(view), 'ArrowUp')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(cards(view)).toEqual(['The token is checked twice.'])
    expect(box(view)).toBe('')
  })
})

describe('Quote in the right-click menu', () => {
  it('is offered with Copy for selected text under the pointer, and attaches the quote once the menu has closed', async () => {
    const view = await render()
    await select(paragraph(view))
    await rightClick(paragraph(view))
    expect(labels().slice(0, 2)).toEqual(['Copy', 'Quote'])
    // The button by the selection steps aside for the menu.
    expect(quoteButton()).toBeNull()

    await act(async () => items().find((item) => item.textContent?.trim() === 'Quote')!.click())
    await vi.waitFor(() => expect(cards(view)).toEqual(['The token is checked twice.']))
    await vi.waitFor(() => expect(messageInput(view).hasFocus).toBe(true))
  })

  it('is not offered for a selection of only blank space, which has nothing to quote', async () => {
    const view = await render()
    const blank = blankSpace(view)
    await select(blank)
    await rightClick(blank)
    expect(labels()).toContain('Copy')
    expect(labels()).not.toContain('Quote')
  })

  it('is not offered without a selection, or when the pointer is not on it', async () => {
    const view = await render()
    await rightClick(paragraph(view))
    expect(labels()).not.toContain('Quote')
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })

    await select(paragraph(view))
    await rightClick(view.querySelector('[data-chat-message="msg_1"]')!)
    expect(labels()).not.toContain('Quote')
  })
})

describe('quote marks typed in the message box', () => {
  it('are drawn as quotes, apart from code fences and a > in the middle of a line', async () => {
    const view = await render()
    await setMessageText(messageInput(view), '> one\n> two\n\na > b\n\n```\n> code\n```')
    const lines = view.querySelectorAll('[data-testid="chat-input"] .chat-input-quote-line')
    expect(Array.from(lines, (line) => line.textContent)).toEqual(['> one', '> two'])
    const marks = view.querySelectorAll('[data-testid="chat-input"] .chat-input-quote-mark')
    expect(Array.from(marks, (mark) => mark.textContent)).toEqual(['> ', '> '])
  })

  it('stop being drawn as quotes once the mark is taken off', async () => {
    const view = await render()
    await setMessageText(messageInput(view), '> one')
    expect(view.querySelectorAll('[data-testid="chat-input"] .chat-input-quote-line')).toHaveLength(1)
    await setMessageText(messageInput(view), 'one')
    expect(view.querySelectorAll('[data-testid="chat-input"] .chat-input-quote-line')).toHaveLength(0)
  })
})

describe('quotes in a sent message', () => {
  it('are shown as quote cards among the text, without their marks', async () => {
    const view = await render()
    const bubble = view.querySelector('[data-chat-message="msg_3"]')!
    expect(Array.from(bubble.querySelectorAll('[data-testid="chat-quote"]'), (card) => card.textContent)).toEqual(['checked twice'])
    expect(bubble.textContent).toBe('Look at thischecked twiceWhy is that?')
    expect(bubble.textContent).not.toContain('>')
  })

  it('leave a message without a quote as the plain text it is', async () => {
    const view = await render()
    const bubble = view.querySelector('[data-chat-message="msg_1"]')!
    expect(bubble.querySelector('[data-testid="chat-quote"]')).toBeNull()
    expect(bubble.textContent).toBe('Fix the login')
  })

  it('cut a long quote to three lines and open it on request', async () => {
    const view = await render()
    const bubble = view.querySelector('[data-chat-message="msg_4"]')!
    const text = bubble.querySelector<HTMLElement>('[data-testid="chat-quote-text"]')!
    expect(text.className).toContain('line-clamp-3')
    const toggle = bubble.querySelector<HTMLElement>('[data-testid="chat-quote-toggle"]')!
    expect(toggle.textContent).toBe('Show more')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    await act(async () => toggle.click())
    expect(text.className).not.toContain('line-clamp-3')
    expect(toggle.textContent).toBe('Show less')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    // All of it is there either way; the cut is only how it is drawn.
    expect(text.textContent).toBe(LONG_QUOTE)
  })

  it('are cut at three lines in a message, so that a quote of three lines is shown whole', async () => {
    const view = await render()
    const bubble = view.querySelector('[data-chat-message="msg_3b"]')!
    expect(bubble.querySelector('[data-testid="chat-quote-text"]')!.textContent).toBe('one\ntwo\nthree')
    expect(bubble.querySelector('[data-testid="chat-quote-toggle"]')).toBeNull()
  })

  it('give a short quote no toggle, and none of them a remove button', async () => {
    const view = await render()
    expect(view.querySelector('[data-chat-message="msg_3"] [data-testid="chat-quote-toggle"]')).toBeNull()
    expect(view.querySelector('[data-chat-message] [data-testid="chat-quote-remove"]')).toBeNull()
  })
})
