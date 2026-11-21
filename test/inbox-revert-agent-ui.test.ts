// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, ChatMessagesPage, ChatOptions, InboxFolder, InboxThread } from '../src/shared/types'
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { cancelScheduledRefreshes, useInboxChat } from '../src/renderer/store/inbox-chat'
import { useWorkspace } from '../src/renderer/store/workspace'
import { messageInput, setMessageText } from './helpers/chat-input'

const roots: Root[] = []
const folder: InboxFolder = {
  id: 'fld_app', name: 'app', directory: '/home/me/app',
  target: { kind: 'wsl', distro: 'Ubuntu' }, createdAt: 1, lastUsedAt: 1,
}
const model = { id: 'free-1', providerId: 'opencode' }
const thread: InboxThread = {
  id: 'ses_one', title: 'Fix login', directory: '/home/me/app', target: { kind: 'wsl', distro: 'Ubuntu' },
  branch: 'main', model, status: 'idle',
  createdAt: 1, lastActivityAt: Date.now(), readAt: Date.now(), archived: false, folderId: 'fld_app',
}
const options: ChatOptions = {
  agents: [{ id: 'build', name: 'Build' }, { id: 'plan', name: 'Plan' }],
  models: [{ id: 'free-1', providerId: 'opencode', providerName: 'OpenCode', name: 'Free 1' }],
  defaultModel: model,
  defaultAgent: 'build',
  skills: [],
}
// A Build turn, then a Plan turn that was stopped and reverted: OpenCode still has the session in Plan.
const conversation: ChatMessage[] = [
  { kind: 'user', id: 'msg_1', time: 1, text: 'Fix the login' },
  { kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model, completed: true, parts: [{ kind: 'text', text: 'Fixed it.' }] },
  { kind: 'user', id: 'msg_3', time: 3, text: 'Plan the logout' },
  { kind: 'assistant', id: 'msg_4', time: 4, agent: 'plan', model, completed: true, parts: [{ kind: 'text', text: 'First, …' }] },
]
const page: ChatMessagesPage = { messages: conversation, older: null, running: false, pending: [], revert: { messageId: 'msg_3', files: [] } }

const send = vi.fn(async (_request: unknown) => null)
const api = {
  inbox: {
    setRead: vi.fn(async () => null),
    setComposer: vi.fn(async () => undefined),
    folders: vi.fn(async () => ({ folders: [folder], composer: {} })),
    gitInfo: vi.fn(async () => ({ repository: false, branch: null, branches: [] })),
  },
  clipboard: { writeText: vi.fn(async () => undefined), paste: vi.fn(async () => undefined) },
  chat: {
    draft: vi.fn(async (req: { text?: string }) => ({ text: req.text ?? '', revision: 1, attachments: [] })),
    options: vi.fn(async () => options),
    messages: vi.fn(async () => page),
    send,
    requests: vi.fn(async () => ({ permissions: [], forms: [] })),
    goal: vi.fn(async () => null),
    subscribe: vi.fn(async () => undefined),
    unsubscribe: vi.fn(async () => undefined),
  },
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('api', api)
  send.mockClear()
  useWorkspace.setState({
    platform: { platform: 'win32', isWindows: true },
    wslAvailable: true,
    inboxThreads: [thread],
    selectedInboxThreadId: 'ses_one',
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

describe('sending after a revert', () => {
  it('sends the agent and model the box shows, even when the last reply still shown used them', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => root.render(createElement(InboxThreadView)))
    await vi.waitFor(() => expect(container.textContent).toContain('Fixed it.'))
    expect(container.textContent).not.toContain('First, …')
    // The box starts with the last shown reply's agent, Build, which is not the session's.
    await vi.waitFor(() => expect(container.querySelector('[data-testid="chat-agent-picker"]')?.textContent).toContain('Build'))
    await setMessageText(messageInput(container), 'Now do it')
    await act(async () => container.querySelector<HTMLElement>('[data-testid="chat-send"]')!.click())
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'ses_one', text: 'Now do it', agent: 'build', model }))
  })
})
