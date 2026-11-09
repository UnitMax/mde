// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, ChatMessagesPage, InboxFolder, InboxThread } from '../src/shared/types'
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { DRAWN_MESSAGES } from '../src/renderer/components/inbox/ChatThreadView'
import { CHAT_KEPT_MESSAGES, cancelScheduledRefreshes, useInboxChat } from '../src/renderer/store/inbox-chat'
import { useWorkspace } from '../src/renderer/store/workspace'

const roots: Root[] = []
const folder: InboxFolder = {
  id: 'fld_app', name: 'app', directory: '/home/me/app',
  target: { kind: 'wsl', distro: 'Ubuntu' }, createdAt: 1, lastUsedAt: 1,
}
const model = { id: 'free-1', providerId: 'opencode' }
const thread = (id: string): InboxThread => ({
  id, title: id, directory: '/home/me/app', target: { kind: 'wsl', distro: 'Ubuntu' },
  branch: 'main', model, status: 'idle',
  createdAt: 1, lastActivityAt: Date.now(), readAt: Date.now(), archived: false, folderId: 'fld_app',
})
const id = (index: number): string => `msg_${String(index).padStart(4, '0')}`
/** Messages `from` to `to`, the first of every four a prompt. */
const range = (from: number, to: number): ChatMessage[] => Array.from({ length: to - from + 1 }, (_, offset): ChatMessage => {
  const index = from + offset
  return index % 4 === 0
    ? { kind: 'user', id: id(index), time: index, text: `Prompt ${index}` }
    : { kind: 'assistant', id: id(index), time: index, agent: 'build', model, completed: true, parts: [{ kind: 'text', text: `Answer ${index}` }] }
})

let pages: Record<string, ChatMessagesPage>
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
    messages: vi.fn(async (req: { threadId: string; cursor?: string }): Promise<ChatMessagesPage> => pages[req.cursor ?? req.threadId]!),
    requests: vi.fn(async () => ({ permissions: [], forms: [] })),
    goal: vi.fn(async () => null),
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
  await vi.waitFor(() => expect(container.textContent).not.toContain('Loading conversation'))
  return container
}
const drawn = (): string[] => Array.from(document.body.querySelectorAll<HTMLElement>('[data-chat-message]')).map((element) => element.dataset.chatMessage!)
const earlier = (): HTMLButtonElement | null => document.body.querySelector<HTMLButtonElement>('[data-testid="chat-show-earlier"]')
const state = () => useInboxChat.getState().threads.ses_long!

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('api', api)
  pages = {
    ses_long: { messages: range(51, 100), older: 'before-51', running: false, pending: [] },
    'before-51': { messages: range(1, 50), older: null, running: false },
    ses_other: { messages: range(1, 2), older: null, running: false, pending: [] },
  }
  useWorkspace.setState({
    platform: { platform: 'win32', isWindows: true },
    wslAvailable: true,
    inboxThreads: [thread('ses_long'), thread('ses_other')],
    selectedInboxThreadId: 'ses_long',
    activeWorkspaceView: 'inbox',
  })
  useInboxChat.setState({ folders: [folder], composer: { folderId: 'fld_app' }, foldersLoaded: true, options: {}, threads: {}, recent: [], titleRegenerations: {} })
})
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  cancelScheduledRefreshes()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('a long conversation', () => {
  it('draws only its newest messages, and the earlier ones when they are asked for', async () => {
    await render()
    expect(state().messages).toHaveLength(50)
    expect(drawn()).toEqual(range(101 - DRAWN_MESSAGES, 100).map((message) => message.id))
    // The timeline still knows every prompt that is loaded.
    expect(document.body.querySelectorAll('[data-testid^="chat-timeline-mark-"]').length).toBeGreaterThan(0)

    // What is loaded and not drawn comes first, without a read of the service.
    const reads = api.chat.messages.mock.calls.length
    await act(async () => earlier()!.click())
    expect(drawn()).toEqual(range(51, 100).map((message) => message.id))
    expect(api.chat.messages.mock.calls.length).toBe(reads)

    // Then an older page, which is drawn whole.
    await act(async () => earlier()!.click())
    await vi.waitFor(() => expect(drawn()).toHaveLength(100))
    expect(drawn()[0]).toBe(id(1))
    expect(earlier()).toBeNull()
  })

  it('keeps what is drawn when new messages arrive at the end', async () => {
    await render()
    const before = drawn()
    pages.ses_long = { ...pages.ses_long!, messages: range(53, 102) }
    await act(async () => { await useInboxChat.getState().refresh('ses_long') })
    expect(drawn()).toEqual([...before, id(101), id(102)])
  })

  it('draws a prompt the timeline jumps to that was not drawn yet', async () => {
    await render()
    expect(drawn()).not.toContain(id(52))
    const rail = document.body.querySelector<HTMLElement>('[data-testid="chat-timeline-trigger"]')!.parentElement!
    await act(async () => { rail.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
    const item = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((entry) => entry.textContent === 'Prompt 52')!
    await act(async () => item.click())
    expect(drawn()[0]).toBe(id(52))
  })

  it('keeps only the end of a long conversation once the thread is left, and reads it afresh when it is opened again', async () => {
    await render()
    await act(async () => earlier()!.click())
    await act(async () => earlier()!.click())
    await vi.waitFor(() => expect(state().messages).toHaveLength(100))

    await act(async () => useWorkspace.setState({ selectedInboxThreadId: 'ses_other' }))
    expect(state().messages.map((message) => message.id)).toEqual(range(101 - CHAT_KEPT_MESSAGES, 100).map((message) => message.id))
    expect(state().older).toBeNull()
    expect(state().cut).toBe(true)

    // Meanwhile the agent went on: the newest page does not reach back to what was kept.
    pages.ses_long = { messages: range(81, 130), older: 'before-81', running: false, pending: [] }
    await act(async () => useWorkspace.setState({ selectedInboxThreadId: 'ses_long' }))
    await vi.waitFor(() => expect(state().cut).toBe(false))
    expect(state().messages.map((message) => message.id)).toEqual(range(81, 130).map((message) => message.id))
    expect(state().older).toBe('before-81')
    await vi.waitFor(() => expect(drawn().at(-1)).toBe(id(130)))
    expect(drawn().length).toBeLessThanOrEqual(50)
  })

  it('leaves a short conversation as it is when the thread is left', async () => {
    useWorkspace.setState({ selectedInboxThreadId: 'ses_other' })
    await render()
    await act(async () => useWorkspace.setState({ selectedInboxThreadId: 'ses_long' }))
    const kept = useInboxChat.getState().threads.ses_other!
    expect(kept.messages).toHaveLength(2)
    expect(kept.cut).toBeFalsy()
  })
})
