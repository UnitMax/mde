// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, ChatMessagesPage, ChatPendingMessage, InboxFolder, InboxThread } from '../src/shared/types'
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { CHAT_REFRESH_DELAY_MS, useInboxChat } from '../src/renderer/store/inbox-chat'
import { useWorkspace } from '../src/renderer/store/workspace'
import { messageInput, setMessageText } from './helpers/chat-input'

const roots: Root[] = []

const folder: InboxFolder = {
  id: 'fld_app', name: 'app', directory: '/home/me/app',
  target: { kind: 'wsl', distro: 'Ubuntu' }, createdAt: 1, lastUsedAt: 1,
}
const model = { id: 'free-1', providerId: 'opencode' }

function thread(): InboxThread {
  return {
    id: 'ses_one', title: 'Fix login', directory: '/home/me/app', target: { kind: 'wsl', distro: 'Ubuntu' },
    branch: 'main', model, status: 'working',
    createdAt: 1, lastActivityAt: Date.now(), readAt: Date.now(), archived: false, folderId: 'fld_app',
  }
}

const conversation: ChatMessage[] = [
  { kind: 'user', id: 'msg_1', time: 1, text: 'Fix the login' },
  { kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model, completed: false, parts: [{ kind: 'text', text: 'Looking at it.' }] },
]

/** A message the service holds for the agent. */
const held = (id: string, text: string, delivery: ChatPendingMessage['delivery'] = 'steer'): ChatPendingMessage =>
  ({ id, delivery, message: { kind: 'user', id, time: 5, text } })

let page: ChatMessagesPage
/** What the next `chat.send` answers with. */
let accepted: ChatPendingMessage | null
const send = vi.fn(async (_request: unknown): Promise<ChatPendingMessage | null> => accepted)
const discardPending = vi.fn(async (_request: unknown): Promise<void> => undefined)
const setDelivery = vi.fn(async (_request: unknown): Promise<void> => undefined)
const messages = vi.fn(async (): Promise<ChatMessagesPage> => page)
const api = {
  inbox: {
    setRead: vi.fn(async () => null),
    folders: vi.fn(async () => ({ folders: [folder], composer: {} })),
    gitInfo: vi.fn(async () => ({ repository: false, branch: null, branches: [] })),
  },
  clipboard: { writeText: vi.fn(async () => undefined), paste: vi.fn(async () => undefined) },
  chat: {
    draft: vi.fn(async (req: { text?: string }) => ({ text: req.text ?? '', revision: 1, attachments: [] })),
    options: vi.fn(() => new Promise(() => {})),
    messages,
    send,
    discardPending,
    setDelivery,
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
const store = () => useInboxChat.getState()
const pendingIds = (): string[] => store().threads.ses_one?.pending.map((entry) => entry.id) ?? []
const shownPending = (): string[] =>
  Array.from(document.body.querySelectorAll<HTMLElement>('[data-testid^="chat-pending-msg_"]'))
    .filter((element) => /^chat-pending-msg_\w+$/.test(element.dataset.testid ?? ''))
    .map((element) => element.dataset.testid!.replace('chat-pending-', ''))

/** Lets the debounced refetch that follows a change happen. */
async function refetched(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, CHAT_REFRESH_DELAY_MS + 60)) })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('api', api)
  send.mockClear()
  discardPending.mockReset()
  discardPending.mockResolvedValue(undefined)
  setDelivery.mockReset()
  setDelivery.mockResolvedValue(undefined)
  messages.mockClear()
  accepted = null
  page = { messages: conversation, older: null, running: true, pending: [] }
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
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('messages held for the agent', () => {
  it('shows a steered message after the conversation, saying the agent reads it at its next step', async () => {
    page = { ...page, pending: [held('msg_p1', 'Also add a test')] }
    const container = await render()
    const entry = byId('chat-pending-msg_p1')!
    expect(entry).not.toBeNull()
    expect(entry.textContent).toContain('Also add a test')
    expect(byId('chat-pending-status-msg_p1')!.textContent).toMatch(/Steering.*the agent reads it at its next step/)
    // It is not part of the conversation yet, and comes after what is there.
    expect(byId('chat-message-msg_p1')).toBeNull()
    const order = Array.from(container.querySelectorAll('[data-testid^="chat-message-"], [data-testid="chat-pending-msg_p1"]')).map((el) => el.getAttribute('data-testid'))
    expect(order).toEqual(['chat-message-msg_1', 'chat-message-msg_2', 'chat-pending-msg_p1'])
  })

  it('says a queued message is sent when the agent is done', async () => {
    page = { ...page, pending: [held('msg_p1', 'Then run the linter', 'queue')] }
    await render()
    expect(byId('chat-pending-status-msg_p1')!.textContent).toMatch(/Queued.*sent when the agent is done/)
  })

  it('lists several in the order they will be taken up', async () => {
    page = { ...page, pending: [held('msg_p1', 'First'), held('msg_p2', 'Second', 'queue')] }
    await render()
    expect(shownPending()).toEqual(['msg_p1', 'msg_p2'])
  })

  it('says a message waits for the next message when nothing is running, as after a Stop', async () => {
    page = { ...page, running: false, pending: [held('msg_p1', 'Never delivered')] }
    await render()
    expect(byId('chat-pending-status-msg_p1')!.textContent).toMatch(/Not sent yet.*goes out with your next message/)
    expect(byId('chat-pending-discard-msg_p1')).not.toBeNull()
  })

  it('shows nothing when nothing is held', async () => {
    await render()
    expect(shownPending()).toEqual([])
  })

  it('shows the files and skills of the message as the conversation will', async () => {
    const withExtras: ChatPendingMessage = {
      id: 'msg_p1', delivery: 'steer',
      message: {
        kind: 'user', id: 'msg_p1', time: 5, text: 'Use $demo on this',
        skills: [{ id: 'demo', name: 'Demo' }],
        attachments: [{ id: 'msg_p1-0', name: 'notes.png', mime: 'image/png', size: 2048 }],
      },
    }
    page = { ...page, pending: [withExtras] }
    await render()
    const entry = byId('chat-pending-msg_p1')!
    expect(entry.textContent).toContain('notes.png')
    expect(byId('chat-skill-demo')).not.toBeNull()
  })

  it('leaves the conversation as it is when the service could not say what it holds', async () => {
    page = { messages: conversation, older: null, running: true }
    await render()
    expect(shownPending()).toEqual([])
    expect(byId('chat-message-msg_2')).not.toBeNull()
  })
})

describe('sending while the agent is busy', () => {
  it('shows the message at once, without waiting for the next refetch', async () => {
    await render()
    accepted = held('msg_p1', 'Also add a test')
    await act(async () => { await store().send('ses_one', 'Also add a test') })
    expect(send).toHaveBeenCalledOnce()
    expect(pendingIds()).toEqual(['msg_p1'])
    expect(byId('chat-pending-msg_p1')).not.toBeNull()
  })

  it('does not set aside a message sent to an idle agent: it goes straight into the conversation', async () => {
    page = { ...page, running: false }
    await render()
    accepted = held('msg_p1', 'Next thing')
    await act(async () => { await store().send('ses_one', 'Next thing') })
    expect(pendingIds()).toEqual([])
    expect(shownPending()).toEqual([])
  })

  it('does not set one aside when the answer to the send could not be read', async () => {
    await render()
    accepted = null
    await act(async () => { await store().send('ses_one', 'Hello') })
    expect(pendingIds()).toEqual([])
  })

  it('keeps it when a refetch that began before the send comes back without it', async () => {
    await render()
    // A refetch is under way when the message is sent, and answers from before the service knew of it.
    let answer!: (page: ChatMessagesPage) => void
    messages.mockImplementationOnce(() => new Promise<ChatMessagesPage>((resolve) => { answer = resolve }))
    const stale = store().refresh('ses_one')
    accepted = held('msg_p1', 'Also add a test')
    await act(async () => { await store().send('ses_one', 'Also add a test') })
    await act(async () => { answer({ ...page, pending: [] }); await stale })
    expect(pendingIds()).toEqual(['msg_p1'])
    // The refetch that follows the send is after it, and lists the message.
    page = { ...page, pending: [held('msg_p1', 'Also add a test')] }
    await refetched()
    expect(pendingIds()).toEqual(['msg_p1'])
  })

  it('hands the message over to the conversation when the agent takes it up, in the same place', async () => {
    await render()
    accepted = held('msg_p1', 'Also add a test')
    await act(async () => { await store().send('ses_one', 'Also add a test') })
    page = { ...page, pending: [held('msg_p1', 'Also add a test')] }
    await refetched()
    expect(shownPending()).toEqual(['msg_p1'])
    // Delivered: it is in the conversation, after the step that was running, and no longer held.
    page = {
      ...page,
      messages: [...conversation, { kind: 'user', id: 'msg_p1', time: 6, text: 'Also add a test' }],
      pending: [],
    }
    await act(async () => { await store().refresh('ses_one') })
    expect(shownPending()).toEqual([])
    expect(byId('chat-message-msg_p1')!.textContent).toContain('Also add a test')
  })

  it('does not show a message twice when a read lists it as held and the conversation already has it', async () => {
    page = {
      ...page,
      messages: [...conversation, { kind: 'user', id: 'msg_p1', time: 6, text: 'Also add a test' }],
      pending: [held('msg_p1', 'Also add a test')],
    }
    await render()
    expect(shownPending()).toEqual([])
    expect(document.body.textContent?.match(/Also add a test/g)).toHaveLength(1)
  })
})

describe('choosing how to send to a busy agent', () => {
  // The box sends only once OpenCode has said which agents and models there are.
  beforeEach(() => {
    api.chat.options.mockImplementation(async () => ({
      agents: [{ id: 'build', name: 'Build' }],
      models: [{ ...model, providerName: 'OpenCode', name: 'Free 1' }],
      defaultModel: model,
      defaultAgent: 'build',
      skills: [],
    }))
  })
  afterEach(() => { api.chat.options.mockImplementation(() => new Promise(() => {})) })

  const typeAndSend = async (container: HTMLElement, text: string, queue = false): Promise<void> => {
    await vi.waitFor(() => expect(container.querySelector('[data-testid="chat-model-picker"]')).not.toBeNull())
    await setMessageText(messageInput(container), text)
    if (queue) {
      await act(async () => { byId('chat-send-menu')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
      await act(async () => byId('chat-send-mode-queue')!.click())
    }
    await act(async () => byId('chat-send')!.click())
  }

  it('steers by default and shows the message as steering', async () => {
    const container = await render()
    accepted = held('msg_p1', 'Also add a test')
    await typeAndSend(container, 'Also add a test')
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'ses_one', text: 'Also add a test', delivery: 'steer' }))
    expect(byId('chat-pending-status-msg_p1')!.textContent).toMatch(/^Steering/)
  })

  it('queues when Queue was chosen, and shows the message as queued', async () => {
    const container = await render()
    accepted = held('msg_p1', 'Then run the linter', 'queue')
    await typeAndSend(container, 'Then run the linter', true)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ text: 'Then run the linter', delivery: 'queue' }))
    expect(byId('chat-pending-status-msg_p1')!.textContent).toMatch(/^Queued/)
    // What is held shows the way that OpenCode took it, not the one the button said.
    expect(store().threads.ses_one!.pending.map((entry) => entry.delivery)).toEqual(['queue'])
  })

  it('leaves the choice out when the agent is idle', async () => {
    page = { ...page, running: false }
    const container = await render()
    accepted = held('msg_p1', 'Next thing')
    await vi.waitFor(() => expect(container.querySelector('[data-testid="chat-model-picker"]')).not.toBeNull())
    await setMessageText(messageInput(container), 'Next thing')
    expect(byId('chat-send-pill')).toBeNull()
    await act(async () => byId('chat-send')!.click())
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0]![0]).not.toHaveProperty('delivery')
  })

  it('remembers the agent and model that were chosen with a send, but not the way of delivery', async () => {
    await render()
    accepted = held('msg_p1', 'Then run the linter', 'queue')
    await act(async () => { await store().send('ses_one', 'Then run the linter', { agent: 'plan', model, delivery: 'queue' }) })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ agent: 'plan', delivery: 'queue' }))
    expect(store().composer).toMatchObject({ agent: 'plan', model })
    expect(store().composer).not.toHaveProperty('delivery')
  })
})

describe('taking a held message back', () => {
  it('removes it at once and asks OpenCode to drop it', async () => {
    page = { ...page, pending: [held('msg_p1', 'Wrong thing'), held('msg_p2', 'Right thing')] }
    await render()
    await act(async () => byId('chat-pending-discard-msg_p1')!.click())
    expect(discardPending).toHaveBeenCalledExactlyOnceWith({ threadId: 'ses_one', messageId: 'msg_p1' })
    expect(shownPending()).toEqual(['msg_p2'])
  })

  it('is not brought back by a refetch that began before it was taken back', async () => {
    page = { ...page, pending: [held('msg_p1', 'Wrong thing')] }
    await render()
    const before = { ...page }
    let answer!: (page: ChatMessagesPage) => void
    messages.mockImplementationOnce(() => new Promise<ChatMessagesPage>((resolve) => { answer = resolve }))
    const stale = store().refresh('ses_one')
    await act(async () => byId('chat-pending-discard-msg_p1')!.click())
    // The late answer still lists it.
    await act(async () => { answer(before); await stale })
    expect(shownPending()).toEqual([])
    // A refetch after the removal does not.
    page = { ...page, pending: [] }
    await refetched()
    expect(shownPending()).toEqual([])
  })

  it('puts it back where it was, and says why, when OpenCode cannot drop it', async () => {
    page = { ...page, pending: [held('msg_p1', 'First'), held('msg_p2', 'Second'), held('msg_p3', 'Third')] }
    await render()
    discardPending.mockRejectedValueOnce(new Error('OpenCode is not answering'))
    await act(async () => byId('chat-pending-discard-msg_p2')!.click())
    await vi.waitFor(() => expect(byId('chat-notice')!.textContent).toContain('could not be taken back'))
    expect(byId('chat-notice')!.textContent).toContain('OpenCode is not answering')
    expect(pendingIds()).toEqual(['msg_p1', 'msg_p2', 'msg_p3'])
  })

  it('leaves the conversation alone when the agent took the message up just before', async () => {
    page = { ...page, pending: [held('msg_p1', 'Just in time')] }
    await render()
    await act(async () => byId('chat-pending-discard-msg_p1')!.click())
    // The service did nothing for a message it had already delivered, and the next read shows it delivered.
    page = { ...page, messages: [...conversation, { kind: 'user', id: 'msg_p1', time: 6, text: 'Just in time' }], pending: [] }
    await refetched()
    expect(byId('chat-message-msg_p1')!.textContent).toContain('Just in time')
    expect(shownPending()).toEqual([])
  })
})

describe('switching how a held message is delivered', () => {
  const label = (id: string): string | undefined => byId(`chat-pending-switch-${id}`)?.textContent?.trim()
  const status = (id: string): string => byId(`chat-pending-status-${id}`)!.textContent ?? ''

  it('offers the other way: queue a steered message, steer a queued one', async () => {
    page = { ...page, pending: [held('msg_p1', 'Steered'), held('msg_p2', 'Queued', 'queue')] }
    await render()
    expect(label('msg_p1')).toBe('Queue instead')
    expect(label('msg_p2')).toBe('Steer now')
  })

  it('switches at once and asks OpenCode, in both directions', async () => {
    page = { ...page, pending: [held('msg_p1', 'Steered'), held('msg_p2', 'Queued', 'queue')] }
    await render()
    await act(async () => byId('chat-pending-switch-msg_p1')!.click())
    expect(setDelivery).toHaveBeenLastCalledWith({ threadId: 'ses_one', messageId: 'msg_p1', delivery: 'queue' })
    expect(status('msg_p1')).toMatch(/Queued.*sent when the agent is done/)
    expect(label('msg_p1')).toBe('Steer now')
    await act(async () => byId('chat-pending-switch-msg_p2')!.click())
    expect(setDelivery).toHaveBeenLastCalledWith({ threadId: 'ses_one', messageId: 'msg_p2', delivery: 'steer' })
    expect(status('msg_p2')).toMatch(/Steering.*the agent reads it at its next step/)
    expect(store().threads.ses_one!.pending.map((entry) => [entry.id, entry.delivery])).toEqual([['msg_p1', 'queue'], ['msg_p2', 'steer']])
  })

  it('does not offer it when nothing is running, where both ways wait for the next run, but still offers Remove', async () => {
    page = { ...page, running: false, pending: [held('msg_p1', 'Stranded', 'queue')] }
    await render()
    expect(byId('chat-pending-switch-msg_p1')).toBeNull()
    expect(byId('chat-pending-discard-msg_p1')).not.toBeNull()
  })

  it('goes back to the old way, and says why, when OpenCode cannot switch it', async () => {
    page = { ...page, pending: [held('msg_p1', 'Steered')] }
    await render()
    setDelivery.mockRejectedValueOnce(new Error('the agent may already have taken it up.'))
    await act(async () => byId('chat-pending-switch-msg_p1')!.click())
    await vi.waitFor(() => expect(byId('chat-notice')!.textContent).toBe('The message could not be switched to queued: the agent may already have taken it up.'))
    expect(status('msg_p1')).toMatch(/Steering/)
    expect(label('msg_p1')).toBe('Queue instead')
  })

  it('shows a message the agent took up before the switch was answered as part of the conversation', async () => {
    page = { ...page, pending: [held('msg_p1', 'Just in time')] }
    await render()
    setDelivery.mockRejectedValueOnce(new Error('the agent may already have taken it up.'))
    page = { ...page, messages: [...conversation, { kind: 'user', id: 'msg_p1', time: 6, text: 'Just in time' }], pending: [] }
    await act(async () => byId('chat-pending-switch-msg_p1')!.click())
    await refetched()
    expect(shownPending()).toEqual([])
    expect(byId('chat-message-msg_p1')!.textContent).toContain('Just in time')
  })

  it('is not undone by a refetch that began before the switch', async () => {
    page = { ...page, pending: [held('msg_p1', 'Steered')] }
    await render()
    const before = { ...page }
    let answer!: (page: ChatMessagesPage) => void
    messages.mockImplementationOnce(() => new Promise<ChatMessagesPage>((resolve) => { answer = resolve }))
    const stale = store().refresh('ses_one')
    await act(async () => byId('chat-pending-switch-msg_p1')!.click())
    // The late answer still says steer.
    await act(async () => { answer(before); await stale })
    expect(status('msg_p1')).toMatch(/Queued/)
    // The refetch that follows the switch is after it, and says queue.
    page = { ...page, pending: [held('msg_p1', 'Steered', 'queue')] }
    await refetched()
    expect(status('msg_p1')).toMatch(/Queued/)
  })

  it('follows a switch made elsewhere, through the next refetch', async () => {
    page = { ...page, pending: [held('msg_p1', 'Steered')] }
    await render()
    page = { ...page, pending: [held('msg_p1', 'Steered', 'queue')] }
    await act(async () => { await store().refresh('ses_one') })
    expect(status('msg_p1')).toMatch(/Queued/)
    expect(label('msg_p1')).toBe('Steer now')
  })

  it('waits for the first switch to be answered before taking another click on the same message', async () => {
    page = { ...page, pending: [held('msg_p1', 'Steered')] }
    await render()
    let answer!: () => void
    setDelivery.mockImplementationOnce(() => new Promise<void>((resolve) => { answer = resolve }))
    await act(async () => byId('chat-pending-switch-msg_p1')!.click())
    // It already reads "Steer now", but the first request is still out.
    await act(async () => byId('chat-pending-switch-msg_p1')!.click())
    expect(setDelivery).toHaveBeenCalledOnce()
    await act(async () => { answer() })
    await act(async () => byId('chat-pending-switch-msg_p1')!.click())
    expect(setDelivery).toHaveBeenCalledTimes(2)
    expect(setDelivery).toHaveBeenLastCalledWith({ threadId: 'ses_one', messageId: 'msg_p1', delivery: 'steer' })
  })
})
