// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatCreateRequest, ChatOptions, InboxFolder, InboxThread } from '../src/shared/types'
import { NewThreadView } from '../src/renderer/components/inbox/NewThreadView'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useInboxDrafts } from '../src/renderer/store/inbox-drafts'
import { useWorkspace } from '../src/renderer/store/workspace'
import { messageInput, pressMessageKey, setMessageText } from './helpers/chat-input'

const roots: Root[] = []
const folder: InboxFolder = { id: 'fld_app', name: 'app', directory: '/home/me/app', target: { kind: 'native' }, createdAt: 1, lastUsedAt: 1 }
const model = { id: 'free-1', providerId: 'opencode' }
const made: InboxThread = {
  id: 'ses_new', title: 'Ship it', directory: '/home/me/app', target: { kind: 'native' }, branch: 'main', model, status: 'working',
  createdAt: 1, lastActivityAt: 1, readAt: 1, archived: false, folderId: 'fld_app',
}

const create = vi.fn(async (_request: ChatCreateRequest): Promise<InboxThread> => made)
const api = {
  inbox: {
    folders: vi.fn(async () => ({ folders: [folder], composer: {} })),
    gitInfo: vi.fn(async () => ({ repository: false, branch: null, branches: [] })),
  },
  automations: { list: vi.fn(async () => []) },
  clipboard: { writeText: vi.fn(async () => undefined), paste: vi.fn(async () => undefined) },
  chat: {
    create,
    draft: vi.fn(async (req: { text?: string }) => ({ text: req.text ?? '', revision: 1, attachments: [] })),
    drafts: vi.fn(async () => ({ drafts: [], threads: [] })),
    options: vi.fn(async (): Promise<ChatOptions> => ({ agents: [{ id: 'build', name: 'build' }], models: [], defaultModel: model, defaultAgent: 'build', skills: [] })),
    mcp: vi.fn(async () => ({ servers: [] })),
  },
}

async function render(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(createElement(NewThreadView)))
  await vi.waitFor(() => expect(container.querySelector('.cm-content')).not.toBeNull())
  return container
}

const byId = (id: string): HTMLElement | null => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('api', api)
  create.mockClear()
  useWorkspace.setState({ platform: { platform: 'linux', isWindows: false }, inboxThreads: [], selectedInboxThreadId: null, activeWorkspaceView: 'inbox' })
  useInboxChat.setState({ folders: [folder], composer: { folderId: 'fld_app' }, foldersLoaded: true, options: {}, threads: {}, recent: [] })
  useInboxDrafts.setState({ page: { id: 'drf_page' } } as never)
})

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('the commands of the new-thread page', () => {
  it('lists /goal alone, since the others need a conversation', async () => {
    const container = await render()
    const box = messageInput(container)
    await setMessageText(box, '/')
    await vi.waitFor(() => expect(byId('slash-picker')).not.toBeNull())
    expect(byId('slash-option-goal')).not.toBeNull()
    for (const name of ['btw', 'fork', 'compact']) expect(byId(`slash-option-${name}`)).toBeNull()
  })

  it('starts the thread with a goal on /goal, in the folder and with the agent and model the page shows', async () => {
    const container = await render()
    const box = messageInput(container)
    await vi.waitFor(() => expect(api.chat.options).toHaveBeenCalled())
    await setMessageText(box, '/goal Make the tests pass')
    await pressMessageKey(box, 'Enter')
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create.mock.calls[0]![0]).toEqual({ folderId: 'fld_app', text: 'Make the tests pass', goal: true, agent: 'build', model, draftId: 'drf_page' })
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_new')
  })

  it('sends /btw as an ordinary first message, and refuses /goal pause with the reason under the box', async () => {
    const container = await render()
    const box = messageInput(container)
    await vi.waitFor(() => expect(api.chat.options).toHaveBeenCalled())
    await setMessageText(box, '/goal pause')
    await pressMessageKey(box, 'Enter')
    await vi.waitFor(() => expect(container.textContent).toContain('There is no goal to pause yet.'))
    expect(create).not.toHaveBeenCalled()
    await setMessageText(box, '/btw why?')
    await pressMessageKey(box, 'Enter')
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create.mock.calls[0]![0]).toMatchObject({ text: '/btw why?' })
    expect(create.mock.calls[0]![0].goal).toBeUndefined()
  })
})
