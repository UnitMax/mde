// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatAsideRequest, ChatMessage, ChatMessagesPage, InboxFolder, InboxThread } from '../src/shared/types'
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { useInboxAside } from '../src/renderer/store/inbox-aside'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useWorkspace } from '../src/renderer/store/workspace'
import { messageInput, pressMessageKey, setMessageText } from './helpers/chat-input'

const roots: Root[] = []

const folder: InboxFolder = {
  id: 'fld_app', name: 'app', directory: '/home/me/app',
  target: { kind: 'wsl', distro: 'Ubuntu' }, createdAt: 1, lastUsedAt: 1,
}
const model = { id: 'free-1', providerId: 'opencode' }

function thread(id = 'ses_one'): InboxThread {
  return {
    id, title: 'Fix login', directory: '/home/me/app', target: { kind: 'wsl', distro: 'Ubuntu' },
    branch: 'main', model, status: 'idle',
    createdAt: 1, lastActivityAt: Date.now(), readAt: Date.now(), archived: false, folderId: 'fld_app',
  }
}

const conversation: ChatMessage[] = [
  { kind: 'user', id: 'msg_1', time: 1, text: 'Fix the login' },
  { kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model, completed: true, parts: [{ kind: 'text', text: 'Fixed it.' }] },
]

let page: ChatMessagesPage
/** What the next side question does; a function so that a test can hold the answer back. */
let answer: (request: ChatAsideRequest) => Promise<{ text: string }>
const aside = vi.fn((request: ChatAsideRequest) => answer(request))
const send = vi.fn(async (_request: unknown) => null)
const interrupt = vi.fn(async (_request: unknown) => undefined)
const writeText = vi.fn(async (_text: string) => undefined)
const api = {
  inbox: {
    setRead: vi.fn(async () => null),
    folders: vi.fn(async () => ({ folders: [folder], composer: {} })),
    gitInfo: vi.fn(async () => ({ repository: false, branch: null, branches: [] })),
  },
  clipboard: { writeText, paste: vi.fn(async () => undefined) },
  chat: {
    draft: vi.fn(async (req: { text?: string }) => ({ text: req.text ?? '', revision: 1, attachments: [] })),
    options: vi.fn(async () => ({ agents: [{ id: 'build', name: 'build' }], models: [], defaultModel: model, defaultAgent: 'build', skills: [] })),
    messages: vi.fn(async (): Promise<ChatMessagesPage> => page),
    send,
    interrupt,
    aside,
    mcp: vi.fn(async () => ({ servers: [] })),
    requests: vi.fn(async () => ({ permissions: [], forms: [] })),
    subscribe: vi.fn(async () => undefined),
    unsubscribe: vi.fn(async () => undefined),
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
  return container
}

const byId = (id: string): HTMLElement | null => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const panel = (): HTMLElement | null => byId('chat-aside')
const text = (id: string): string => byId(id)?.textContent ?? ''
const sendButton = (): HTMLButtonElement => byId('chat-send') as HTMLButtonElement

/** Types a message into the box and presses Enter. */
async function submit(container: HTMLElement, value: string): Promise<void> {
  const box = messageInput(container)
  await setMessageText(box, value)
  await pressMessageKey(box, 'Enter')
}
/** Waits for the question to have been answered (or to have failed). */
const settled = (): Promise<void> => vi.waitFor(() => expect(panel()?.dataset.status).not.toBe('loading'))

/** An answer the test lets through when it is ready. */
function held(): { resolve: (text: string) => void; reject: (error: Error) => void } {
  const control = {} as { resolve: (text: string) => void; reject: (error: Error) => void }
  answer = () => new Promise((resolve, reject) => {
    control.resolve = (value) => resolve({ text: value })
    control.reject = reject
  })
  return control
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('api', api)
  aside.mockClear()
  send.mockClear()
  interrupt.mockClear()
  writeText.mockClear()
  answer = async () => ({ text: '**Because** the hashes were made without trimming.' })
  page = { messages: conversation, older: null, running: false, pending: [] }
  useWorkspace.setState({
    platform: { platform: 'win32', isWindows: true },
    wslAvailable: true,
    inboxThreads: [thread()],
    selectedInboxThreadId: 'ses_one',
    activeWorkspaceView: 'inbox',
  })
  useInboxChat.setState({ folders: [folder], composer: { folderId: 'fld_app' }, foldersLoaded: true, options: {}, threads: {}, recent: [], titleRegenerations: {} })
  useInboxAside.setState({ asides: {} })
})
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('/btw in a conversation', () => {
  it('asks the thread\'s side question and shows the answer in a card of its own above the box, as Markdown', async () => {
    const container = await render()
    expect(panel()).toBeNull()
    await submit(container, '/btw why did the login break?')
    expect(aside).toHaveBeenCalledOnce()
    expect(aside).toHaveBeenCalledWith({ threadId: 'ses_one', question: 'why did the login break?' })
    await settled()
    expect(panel()?.dataset.status).toBe('done')
    expect(panel()?.getAttribute('role')).toBe('region')
    expect(panel()?.getAttribute('aria-label')).toBe('Side question')
    expect(text('chat-aside-question')).toBe('why did the login break?')
    // Rendered, not shown as source.
    expect(panel()?.querySelector('strong')?.textContent).toBe('Because')
    expect(text('chat-aside-body')).toContain('the hashes were made without trimming.')
    expect(panel()?.textContent).toContain('not added to the conversation')
    // The card sits directly above the box, outside the conversation.
    const slot = panel()!.parentElement!
    expect(slot.contains(byId('chat-composer'))).toBe(true)
    expect(byId('chat-transcript')!.contains(panel())).toBe(false)
  })

  it('leaves the conversation alone: nothing is sent, no message appears, and the box is emptied', async () => {
    const container = await render()
    await submit(container, '/btw why did the login break?')
    await settled()
    expect(send).not.toHaveBeenCalled()
    expect(Array.from(document.body.querySelectorAll('[data-testid^="chat-message-"]')).map((element) => element.getAttribute('data-testid'))).toEqual(['chat-message-msg_1', 'chat-message-msg_2'])
    expect(byId('chat-transcript')!.textContent).not.toContain('why did the login break?')
    expect(byId('chat-transcript')!.textContent).not.toContain('hashes were made')
    expect(messageInput(container).state.doc.toString()).toBe('')
  })

  it('shows the question with a thinking state while the answer is on its way', async () => {
    const control = held()
    const container = await render()
    await submit(container, '/btw why?')
    expect(panel()?.dataset.status).toBe('loading')
    expect(byId('chat-aside-loading')?.getAttribute('role')).toBe('status')
    expect(text('chat-aside-loading')).toContain('Thinking')
    expect(text('chat-aside-question')).toBe('why?')
    // Nothing to copy yet, but it can be dismissed.
    expect(byId('chat-aside-copy')).toBeNull()
    expect(byId('chat-aside-dismiss')).not.toBeNull()
    await act(async () => control.resolve('Because.'))
    await settled()
    expect(byId('chat-aside-loading')).toBeNull()
    expect(text('chat-aside-body')).toContain('Because.')
  })

  it('works while the agent is working, without stopping, steering or queueing anything', async () => {
    page = { ...page, running: true }
    const container = await render()
    const box = messageInput(container)
    await setMessageText(box, 'also add docs')
    expect(byId('chat-send-pill')).not.toBeNull()
    await setMessageText(box, '/btw what are you doing right now?')
    // A command is not delivered to the agent, so it is the round button, not Steer / Queue.
    expect(byId('chat-send-pill')).toBeNull()
    expect(sendButton().dataset.command).toBe('btw')
    await pressMessageKey(box, 'Enter')
    await settled()
    expect(aside).toHaveBeenCalledWith({ threadId: 'ses_one', question: 'what are you doing right now?' })
    expect(send).not.toHaveBeenCalled()
    expect(interrupt).not.toHaveBeenCalled()
    expect(panel()?.dataset.status).toBe('done')
  })

  it('shows a failure with the reason and a Retry that asks the same question again', async () => {
    let attempts = 0
    answer = async () => {
      attempts += 1
      if (attempts === 1) throw new Error("Error invoking remote method 'chat:aside': Error: The OpenCode service did not answer in time.")
      return { text: 'Second time lucky.' }
    }
    const container = await render()
    await submit(container, '/btw why?')
    await settled()
    expect(panel()?.dataset.status).toBe('error')
    expect(byId('chat-aside-error')?.getAttribute('role')).toBe('alert')
    expect(text('chat-aside-error')).toContain('The OpenCode service did not answer in time.')
    expect(text('chat-aside-error')).not.toContain('Error invoking')
    expect(byId('chat-aside-copy')).toBeNull()
    await act(async () => byId('chat-aside-retry')!.click())
    await settled()
    expect(aside).toHaveBeenCalledTimes(2)
    expect(aside).toHaveBeenLastCalledWith({ threadId: 'ses_one', question: 'why?' })
    expect(panel()?.dataset.status).toBe('done')
    expect(text('chat-aside-body')).toContain('Second time lucky.')
  })

  it('replaces the card with the next question', async () => {
    const container = await render()
    await submit(container, '/btw first?')
    await settled()
    answer = async () => ({ text: 'The second answer.' })
    await submit(container, '/btw second?')
    await settled()
    expect(document.body.querySelectorAll('[data-testid="chat-aside"]')).toHaveLength(1)
    expect(text('chat-aside-question')).toBe('second?')
    expect(text('chat-aside-body')).toContain('The second answer.')
  })

  it('copies the answer to the clipboard, and says so', async () => {
    const container = await render()
    await submit(container, '/btw why?')
    await settled()
    const copy = byId('chat-aside-copy')!
    expect(copy.getAttribute('aria-label')).toBe('Copy answer')
    await act(async () => copy.click())
    expect(writeText).toHaveBeenCalledWith('**Because** the hashes were made without trimming.')
    await vi.waitFor(() => expect(byId('chat-aside-copy')?.getAttribute('aria-label')).toBe('Copied'))
  })

  it('keeps a long question to two lines in the card, and all of it in the tooltip', async () => {
    const container = await render()
    const long = `${'a very long question '.repeat(20)}end`
    await submit(container, `/btw ${long}`)
    await settled()
    expect(byId('chat-aside-question')?.className).toContain('line-clamp-2')
    expect(byId('chat-aside-question')?.title).toBe(long)
  })

  it('is closed with its button, and a click does not take the caret out of the box', async () => {
    const container = await render()
    await submit(container, '/btw why?')
    await settled()
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    byId('chat-aside-dismiss')!.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    await act(async () => byId('chat-aside-dismiss')!.click())
    expect(panel()).toBeNull()
    expect(useInboxAside.getState().asides).toEqual({})
  })

  it('is closed with Escape from the box, when no list is open', async () => {
    const container = await render()
    await submit(container, '/btw why?')
    await settled()
    const box = messageInput(container)
    await setMessageText(box, '/')
    await pressMessageKey(box, 'Escape')
    // The first Escape only closes the list of commands.
    expect(byId('slash-picker')).toBeNull()
    expect(panel()).not.toBeNull()
    await setMessageText(box, '')
    await pressMessageKey(box, 'Escape')
    expect(panel()).toBeNull()
  })

  it('is closed with Escape from inside the card, and the caret goes back to the box', async () => {
    const container = await render()
    await submit(container, '/btw why?')
    await settled()
    const dismiss = byId('chat-aside-dismiss')!
    dismiss.focus()
    expect(document.activeElement).toBe(dismiss)
    await act(async () => { dismiss.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    expect(panel()).toBeNull()
    await vi.waitFor(() => expect(document.activeElement?.closest('[data-testid="chat-input"]')).not.toBeNull())
  })

  it('shows only the thread\'s own question', async () => {
    useInboxAside.setState({ asides: { ses_other: { id: 99, question: 'Someone else\'s?', status: 'done', answer: 'Not here.', error: null } } })
    await render()
    expect(panel()).toBeNull()
    expect(document.body.textContent).not.toContain('Someone else')
  })

  it('shows an answer that arrived while another thread was open when the thread is opened again', async () => {
    const control = held()
    const container = await render()
    await submit(container, '/btw why?')
    expect(panel()?.dataset.status).toBe('loading')
    // The person looks at another thread meanwhile; the answer lands in the store all the same.
    await act(async () => { useWorkspace.setState({ inboxThreads: [thread(), thread('ses_two')], selectedInboxThreadId: 'ses_two' }) })
    await act(async () => control.resolve('It was the trim.'))
    expect(useInboxAside.getState().asides.ses_one?.status).toBe('done')
    await act(async () => { useWorkspace.setState({ selectedInboxThreadId: 'ses_one' }) })
    await vi.waitFor(() => expect(panel()).not.toBeNull())
    expect(text('chat-aside-body')).toContain('It was the trim.')
  })

  it('lists /btw when a slash is typed, and a message that only starts with one is still sent', async () => {
    const container = await render()
    const box = messageInput(container)
    await setMessageText(box, '/')
    expect(byId('slash-picker')).not.toBeNull()
    expect(byId('slash-option-btw')).not.toBeNull()
    await setMessageText(box, '/etc/hosts is wrong')
    expect(byId('slash-picker')).toBeNull()
    await pressMessageKey(box, 'Enter')
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'ses_one', text: '/etc/hosts is wrong' }))
    expect(aside).not.toHaveBeenCalled()
  })
})
