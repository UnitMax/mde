// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessagesPage, ChatOptions, ChatRequests, InboxFolder, InboxThread } from '../src/shared/types'
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useWorkspace } from '../src/renderer/store/workspace'

const roots: Root[] = []

const folder: InboxFolder = {
  id: 'fld_app', name: 'app', directory: '/home/me/app',
  target: { kind: 'wsl', distro: 'Ubuntu' }, createdAt: 1, lastUsedAt: 1,
}
const options: ChatOptions = {
  agents: [{ id: 'plan', name: 'Plan' }, { id: 'build', name: 'Build' }],
  models: [{ id: 'free-1', providerId: 'opencode', providerName: 'OpenCode', name: 'Flint Free' }],
  defaultModel: { id: 'free-1', providerId: 'opencode' },
  defaultAgent: 'build',
}

function thread(overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id: 'ses_one', title: 'Fix login', directory: '/home/me/app', target: { kind: 'wsl', distro: 'Ubuntu' },
    branch: 'main', model: { id: 'free-1', providerId: 'opencode' }, status: 'working',
    createdAt: 1, lastActivityAt: Date.now(), readAt: Date.now(), archived: false, origin: 'chat', folderId: 'fld_app',
    ...overrides,
  }
}

let page: ChatMessagesPage
let requests: ChatRequests
const api = {
  inbox: {
    setRead: vi.fn(async () => null),
    setComposer: vi.fn(async (composer: unknown) => composer),
    removeFolder: vi.fn(async () => undefined),
  },
  chat: {
    options: vi.fn(async () => options),
    create: vi.fn(async () => thread({ id: 'ses_new', title: 'New thread' })),
    messages: vi.fn(async () => page),
    requests: vi.fn(async () => requests),
    send: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    replyPermission: vi.fn(async () => undefined),
    replyForm: vi.fn(async () => undefined),
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
  return container
}

async function type(element: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button'))
    .find((item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label)
  if (!found) throw new Error(`No button ${label}`)
  return found
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('api', api)
  for (const group of Object.values(api)) for (const fn of Object.values(group)) fn.mockClear()
  page = { messages: [], older: null, running: false }
  requests = { permissions: [], forms: [] }
  useWorkspace.setState({
    platform: { platform: 'win32', isWindows: true },
    wslAvailable: true,
    opencodeTuiEnabled: true,
    inboxThreads: [],
    selectedInboxThreadId: null,
    activeWorkspaceView: 'inbox',
  })
  useInboxChat.setState({ folders: [folder], composer: { folderId: 'fld_app' }, foldersLoaded: true, options: {}, threads: {}, recent: [] })
})

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()))
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('Inbox new thread', () => {
  it('asks for a folder first', async () => {
    useInboxChat.setState({ folders: [], composer: {} })
    const view = await render()
    expect(view.querySelector('h1')?.textContent).toBe('What should we build?')
    expect(button(view, 'Add a folder')).toBeTruthy()
    expect(view.querySelector('[data-testid="chat-composer"]')).toBeNull()
  })

  it('names the folder, picks the default model and agent, and starts a thread on Enter', async () => {
    const view = await render()
    expect(view.querySelector('h1')?.textContent).toContain('What should we build in app')
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-model-picker"]')?.textContent).toContain('Flint Free'))
    expect(view.querySelector('[data-testid="chat-agent-picker"]')?.textContent).toContain('Build')
    expect(api.chat.options).toHaveBeenCalledWith({ folderId: 'fld_app' })

    const send = button(view, 'Send')
    expect(send.disabled).toBe(true)
    const textarea = view.querySelector('textarea')!
    await type(textarea, 'Add a dark mode')
    expect(send.disabled).toBe(false)
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await vi.waitFor(() => expect(api.chat.create).toHaveBeenCalledWith({
      folderId: 'fld_app', text: 'Add a dark mode', agent: 'build', model: { id: 'free-1', providerId: 'opencode' },
    }))
    await vi.waitFor(() => expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_new'))
    expect(useWorkspace.getState().inboxThreads.map((item) => item.id)).toEqual(['ses_new'])
  })

  it('keeps the text and shows the error when starting fails', async () => {
    api.chat.create.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:create': Error: Model unavailable"))
    const view = await render()
    await vi.waitFor(() => expect(button(view, 'Send')).toBeTruthy())
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-model-picker"]')).not.toBeNull())
    const textarea = view.querySelector('textarea')!
    await type(textarea, 'Hello')
    await act(async () => button(view, 'Send').click())
    await vi.waitFor(() => expect(view.querySelector('[role="alert"]')?.textContent).toBe('Model unavailable'))
    expect(textarea.value).toBe('Hello')
  })
})

describe('Inbox conversation', () => {
  beforeEach(() => {
    useWorkspace.setState({ inboxThreads: [thread()], selectedInboxThreadId: 'ses_one' })
  })

  it('shows messages, tools and reasoning, and streams new text', async () => {
    page = {
      running: true,
      older: null,
      messages: [
        { kind: 'user', id: 'msg_1', time: 1, text: 'Fix the login' },
        {
          kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model: options.defaultModel!, completed: true,
          parts: [
            { kind: 'reasoning', text: 'Looking at auth.ts' },
            { kind: 'tool', id: 'call_1', name: 'read', status: 'completed', input: '{"path":"/home/me/app/src/auth.ts"}', output: '1: export {}' },
          ],
        },
      ],
    }
    const view = await render()
    await vi.waitFor(() => expect(view.textContent).toContain('Fix the login'))
    expect(api.chat.subscribe).toHaveBeenCalledWith({ threadId: 'ses_one' })
    expect(view.querySelector('[data-testid="chat-tool-call_1"]')?.textContent).toContain('Read src/auth.ts')
    expect(view.querySelector('[data-testid="chat-reasoning"]')?.textContent).toContain('Thought')
    // Expanding a tool shows its input and output.
    await act(async () => view.querySelector<HTMLButtonElement>('[data-testid="chat-tool-call_1"] button')!.click())
    expect(view.querySelector('[data-testid="chat-tool-call_1"]')?.textContent).toContain('1: export {}')
    expect(view.querySelector('[data-testid="chat-working"]')).not.toBeNull()

    await act(async () => {
      useInboxChat.getState().applyEvent({ type: 'delta', threadId: 'ses_one', messageId: 'msg_3', part: 'text', ordinal: 0, delta: 'Streaming ' })
      useInboxChat.getState().applyEvent({ type: 'delta', threadId: 'ses_one', messageId: 'msg_3', part: 'text', ordinal: 0, delta: 'answer' })
    })
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-message-msg_3"]')?.textContent).toContain('Streaming answer'))
  })

  it('shows parallel subagents as cards with their task and result', async () => {
    const input = (description: string) => JSON.stringify({ agent: 'explore', description, prompt: `Look at ${description}.\nDo not edit files.` })
    page = {
      running: true, older: null,
      messages: [{
        kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model: options.defaultModel!, completed: false,
        parts: [
          { kind: 'text', text: 'Launching two subagents.' },
          { kind: 'tool', id: 'call_a', name: 'subagent', status: 'running', input: input('structure') },
          { kind: 'tool', id: 'call_b', name: 'subagent', status: 'completed', input: input('logic'), output: '<subagent sessionID="ses_c" state="completed">\nThe **core** loop is in `main.ts`.\n</subagent>' },
        ],
      }],
    }
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-subagents"]')).not.toBeNull())
    expect(view.querySelectorAll('[data-testid="chat-subagents"]')).toHaveLength(1)
    expect(view.querySelector('[data-testid="chat-subagents"]')?.textContent).toContain('2 subagents · 1 working')
    const running = view.querySelector<HTMLElement>('[data-testid="chat-subagent-call_a"]')!
    expect(running.textContent).toContain('structure')
    expect(running.textContent).toContain('Working')
    expect(running.textContent).not.toContain('"agent"')
    const done = view.querySelector<HTMLElement>('[data-testid="chat-subagent-call_b"]')!
    expect(done.textContent).toContain('Done')
    expect(done.textContent).not.toContain('core loop')
    await act(async () => done.querySelector('button')!.click())
    expect(done.textContent).toContain('Do not edit files.')
    await vi.waitFor(() => expect(done.textContent).toContain('The core loop is in main.ts.'))
    expect(done.textContent).not.toContain('sessionID')
  })

  it('stops a running thread and sends follow-ups with a changed agent only', async () => {
    page = {
      running: true, older: null,
      messages: [{ kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model: options.defaultModel!, completed: true, parts: [] }],
    }
    const view = await render()
    await vi.waitFor(() => expect(button(view, 'Stop')).toBeTruthy())
    await act(async () => button(view, 'Stop').click())
    expect(api.chat.interrupt).toHaveBeenCalledWith({ threadId: 'ses_one' })

    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-agent-picker"]')?.textContent).toContain('Build'))
    await type(view.querySelector('textarea')!, 'Thanks')
    await act(async () => button(view, 'Send').click())
    await vi.waitFor(() => expect(api.chat.send).toHaveBeenCalledWith({ threadId: 'ses_one', text: 'Thanks' }))
  })

  it('answers permission requests and questions inline', async () => {
    requests = {
      permissions: [{ id: 'per_1', action: 'read', resources: ['.env'] }],
      forms: [{
        id: 'frm_1', title: 'Questions', unsupported: false,
        fields: [{ key: 'q0', type: 'string', title: 'Beverage', required: false, custom: true,
          description: 'Would you like tea or coffee?',
          options: [{ value: 'Tea', label: 'Tea', description: 'A nice cup of tea' }, { value: 'Coffee', label: 'Coffee', description: 'A cup of coffee' }] }],
      }],
    }
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-permission-per_1"]')).not.toBeNull())
    expect(view.textContent).toContain('Permission: Read a file')
    expect(view.textContent).toContain('.env')
    await act(async () => button(view, 'Allow once').click())
    expect(api.chat.replyPermission).toHaveBeenCalledWith({ threadId: 'ses_one', requestId: 'per_1', decision: 'once' })
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-permission-per_1"]')).toBeNull())

    const question = view.querySelector<HTMLElement>('[data-testid="chat-question-frm_1"]')!
    await act(async () => button(question, 'Send answer').click())
    expect(question.textContent).toContain('Answer “Beverage”.')
    expect(question.textContent).toContain('Would you like tea or coffee?')
    expect(question.querySelector('[data-testid="chat-option-Tea"]')?.textContent).toContain('A nice cup of tea')
    expect(question.querySelector('[data-testid="chat-option-Coffee"]')?.textContent).toContain('A cup of coffee')
    await act(async () => question.querySelector<HTMLButtonElement>('[data-testid="chat-option-Tea"]')!.click())
    await act(async () => button(question, 'Send answer').click())
    expect(api.chat.replyForm).toHaveBeenCalledWith({ threadId: 'ses_one', formId: 'frm_1', answer: { q0: 'Tea' } })
  })

  it('refetches when the service reports changes and unsubscribes on leave', async () => {
    const view = await render()
    await vi.waitFor(() => expect(api.chat.messages).toHaveBeenCalledTimes(1))
    await act(async () => {
      useInboxChat.getState().applyEvent({ type: 'messages', threadId: 'ses_one' })
      useInboxChat.getState().applyEvent({ type: 'messages', threadId: 'ses_one' })
      useInboxChat.getState().applyEvent({ type: 'requests', threadId: 'ses_one' })
    })
    await vi.waitFor(() => expect(api.chat.messages).toHaveBeenCalledTimes(2))
    expect(api.chat.requests).toHaveBeenCalledTimes(2)
    expect(view.textContent).toContain('No messages yet.')
    await act(async () => roots.splice(0).forEach((root) => root.unmount()))
    expect(api.chat.unsubscribe).toHaveBeenCalledWith({ threadId: 'ses_one' })
  })
})
