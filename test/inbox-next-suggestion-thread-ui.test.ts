// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, ChatMessagesPage, InboxFolder, InboxThread } from '../src/shared/types'
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { SUGGESTION_DELAY_MS } from '../src/renderer/lib/next-suggestion'
import { cancelScheduledRefreshes, useInboxChat } from '../src/renderer/store/inbox-chat'
import { useInboxSuggestion } from '../src/renderer/store/inbox-suggestion'
import { useInboxView } from '../src/renderer/store/inbox-view'
import { useWorkspace } from '../src/renderer/store/workspace'

const roots: Root[] = []
const folder: InboxFolder = {
  id: 'fld_app', name: 'app', directory: '/home/me/app',
  target: { kind: 'wsl', distro: 'Ubuntu' }, createdAt: 1, lastUsedAt: 1,
}
const model = { id: 'free-1', providerId: 'opencode' }
const thread: InboxThread = {
  id: 'ses_one', title: 'One', directory: '/home/me/app', target: { kind: 'wsl', distro: 'Ubuntu' },
  branch: 'main', model, status: 'idle',
  createdAt: 1, lastActivityAt: Date.now(), readAt: Date.now(), archived: false, folderId: 'fld_app',
}
const finished: ChatMessage[] = [
  { kind: 'user', id: 'msg_1', time: 1, text: 'Add a function' },
  { kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model, completed: true, parts: [{ kind: 'text', text: 'Done.' }] },
]

let page: ChatMessagesPage
let draftText: string
const api = {
  inbox: {
    setRead: vi.fn(async () => null),
    folders: vi.fn(async () => ({ folders: [folder], composer: {} })),
    gitInfo: vi.fn(async () => ({ repository: false, branch: null, branches: [] })),
  },
  clipboard: { writeText: vi.fn(async () => undefined), paste: vi.fn(async () => undefined) },
  chat: {
    draft: vi.fn(async (req: { action: string; text?: string }) => ({ text: req.action === 'text' ? req.text ?? '' : draftText, revision: 1, attachments: [] })),
    options: vi.fn(() => new Promise(() => {})),
    messages: vi.fn(async (): Promise<ChatMessagesPage> => page),
    requests: vi.fn(async () => ({ permissions: [], forms: [] })),
    goal: vi.fn(async () => null),
    asideHistory: vi.fn(async () => []),
    suggest: vi.fn(async () => ({ text: 'Run the tests' })),
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
const wait = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); await Promise.resolve() })
const ghost = () => document.body.querySelector('[data-testid="chat-suggestion"]')

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('api', api)
  api.chat.suggest.mockClear()
  page = { messages: finished, older: null, running: false, pending: [] }
  draftText = ''
  useWorkspace.setState({
    platform: { platform: 'win32', isWindows: true },
    wslAvailable: true,
    inboxThreads: [thread],
    selectedInboxThreadId: 'ses_one',
    activeWorkspaceView: 'inbox',
  })
  useInboxChat.setState({ folders: [folder], composer: { folderId: 'fld_app' }, foldersLoaded: true, options: {}, threads: {}, recent: [], titleRegenerations: {} })
  useInboxSuggestion.setState({ threads: {} })
  useInboxView.setState({ nextSuggestion: true })
})
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  vi.useRealTimers()
  cancelScheduledRefreshes()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('the next-message suggestion in a thread', () => {
  it('is asked for five seconds after a finished turn and shown in the empty box', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    await render()
    await wait(SUGGESTION_DELAY_MS - 500)
    expect(api.chat.suggest).not.toHaveBeenCalled()
    await wait(1000)
    expect(api.chat.suggest).toHaveBeenCalledWith({ threadId: 'ses_one' })
    await vi.waitFor(() => expect(ghost()?.textContent).toBe('Run the testsTab'))
    // Once per turn: more waiting asks nothing more.
    await wait(SUGGESTION_DELAY_MS * 2)
    expect(api.chat.suggest).toHaveBeenCalledTimes(1)
  })

  it('is not asked for when the setting is off, while the agent works, or with a draft in the box', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    useInboxView.setState({ nextSuggestion: false })
    await render()
    await wait(SUGGESTION_DELAY_MS * 2)
    expect(api.chat.suggest).not.toHaveBeenCalled()
    for (const root of roots.splice(0)) await act(async () => root.unmount())

    useInboxView.setState({ nextSuggestion: true })
    useInboxChat.setState({ threads: {} })
    page = { messages: finished, older: null, running: true, pending: [] }
    await render()
    await wait(SUGGESTION_DELAY_MS * 2)
    expect(api.chat.suggest).not.toHaveBeenCalled()
    for (const root of roots.splice(0)) await act(async () => root.unmount())

    useInboxChat.setState({ threads: {} })
    page = { messages: finished, older: null, running: false, pending: [] }
    draftText = 'my own next message'
    await render()
    await wait(SUGGESTION_DELAY_MS * 2)
    expect(api.chat.suggest).not.toHaveBeenCalled()
    expect(ghost()).toBeNull()
  })
})
