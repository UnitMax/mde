// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ChatMcpRequest,
  ChatMcpServer,
  ChatMcpState,
  ChatMessage,
  ChatMessagesPage,
  ChatOptions,
  InboxFolder,
  InboxThread,
} from '../src/shared/types'
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useInboxMcp } from '../src/renderer/store/inbox-mcp'
import { useWorkspace } from '../src/renderer/store/workspace'

const roots: Root[] = []

const folder: InboxFolder = {
  id: 'fld_app', name: 'app', directory: '/home/me/app',
  target: { kind: 'wsl', distro: 'Ubuntu' }, createdAt: 1, lastActivityAt: 1, lastUsedAt: 1,
} as InboxFolder
const model = { id: 'free-1', providerId: 'opencode' }
const options: ChatOptions = {
  agents: [{ id: 'build', name: 'build' }],
  models: [{ id: 'free-1', providerId: 'opencode', providerName: 'OpenCode', name: 'Free' }],
  defaultModel: model,
  defaultAgent: 'build',
  skills: [],
}

const thread: InboxThread = {
  id: 'ses_one', title: 'Add numbers', directory: '/home/me/app', target: { kind: 'wsl', distro: 'Ubuntu' },
  branch: 'main', model, status: 'idle',
  createdAt: 1, lastActivityAt: Date.now(), readAt: Date.now(), archived: false, folderId: 'fld_app',
}

const conversation: ChatMessage[] = [
  { kind: 'user', id: 'msg_1', time: 1, text: 'Add 7 and 5' },
  {
    kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model, completed: true,
    parts: [{
      kind: 'tool', id: 'call_one', name: 'execute', status: 'completed',
      input: '{"code":"return await tools.demo_math.add({ a: 7, b: 5 })"}',
      output: '{ "sum": 12 }',
      calls: [{ tool: 'demo_math.add', status: 'completed', input: '{"a":7,"b":5}' }],
      durationMs: 11,
    }],
  },
]

let servers: ChatMcpServer[]
const mcp = vi.fn(async (_request: ChatMcpRequest): Promise<ChatMcpState> => ({ servers, supported: true }))
const page: ChatMessagesPage = { messages: conversation, older: null, running: false, pending: [] }

const chat = {
  draft: vi.fn(async (req: { text?: string }) => ({ text: req.text ?? '', revision: 1, attachments: [] })),
  options: vi.fn(async () => options),
  messages: vi.fn(async () => page),
  requests: vi.fn(async () => ({ permissions: [], forms: [] })),
  subscribe: vi.fn(async () => undefined),
  unsubscribe: vi.fn(async () => undefined),
}
const baseApi = {
  inbox: {
    setRead: vi.fn(async () => null),
    folders: vi.fn(async () => ({ folders: [folder], composer: {} })),
    gitInfo: vi.fn(async () => ({ repository: false, branch: null, branches: [] })),
  },
  clipboard: { writeText: vi.fn(async () => undefined), paste: vi.fn(async () => undefined) },
}

async function render(api: unknown): Promise<HTMLElement> {
  vi.stubGlobal('api', api)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(createElement(InboxThreadView)))
  return container
}

const q = (selector: string): HTMLElement | null => document.body.querySelector<HTMLElement>(selector)
const chip = (): HTMLElement | null => q('[data-testid="chat-mcp-chip"]')

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  servers = [{ name: 'demo_display', status: 'connected' }, { name: 'demo_math', status: 'connected' }]
  mcp.mockClear()
  useInboxMcp.setState({ entries: {} })
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
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('MCP in the Inbox views', () => {
  it('leaves the thread working, without a chip, when the build has no MCP methods', async () => {
    await render({ ...baseApi, chat })
    await vi.waitFor(() => expect(q('[data-testid="chat-input"]')).not.toBeNull())
    await vi.waitFor(() => expect(q('[data-testid="chat-transcript"]')?.textContent).toContain('Add 7 and 5'))
    expect(chip()).toBeNull()
    // The call is still drawn as a card, because it needs no server list.
    expect(q('[data-mcp-calls="1"]')).not.toBeNull()
  })

  it('shows the chip in the thread’s composer, and tells the servers from OpenCode’s tools by their names', async () => {
    await render({ ...baseApi, chat: { ...chat, mcp, setMcp: vi.fn(async () => undefined) } })
    await vi.waitFor(() => expect(chip()).not.toBeNull())
    expect(chip()?.getAttribute('aria-label')).toBe('MCP servers: 2 connected')
    // It sits in the toolbar of the composer, after the agent picker.
    const composer = q('[data-testid="chat-composer"]')!
    expect(composer.contains(chip())).toBe(true)
    expect(composer.contains(q('[data-testid="chat-input"]'))).toBe(true)
    const agent = q('[data-testid="chat-agent-picker"]')!
    expect(agent.compareDocumentPosition(chip()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(mcp).toHaveBeenCalledWith({ threadId: 'ses_one' })
    await vi.waitFor(() => expect(q('[data-kind="mcp"]')).not.toBeNull())
    expect(q('[data-kind="mcp"]')?.textContent).toBe('demo_math')
  })

  it('reads the servers again when OpenCode says one changed, for the thread’s own service only', async () => {
    await render({ ...baseApi, chat: { ...chat, mcp, setMcp: vi.fn(async () => undefined) } })
    await vi.waitFor(() => expect(chip()).not.toBeNull())
    const reads = mcp.mock.calls.length

    servers = [{ name: 'demo_display', status: 'connected' }, { name: 'demo_math', status: 'failed', error: 'closed' }]
    await act(async () => useInboxChat.getState().applyEvent({ type: 'mcp', target: { kind: 'wsl', distro: 'Other' } }))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)) })
    expect(mcp.mock.calls.length).toBe(reads)
    expect(chip()?.getAttribute('data-tone')).toBe('ok')

    await act(async () => useInboxChat.getState().applyEvent({ type: 'mcp', target: { kind: 'wsl', distro: 'Ubuntu' } }))
    await vi.waitFor(() => expect(chip()?.getAttribute('data-tone')).toBe('danger'))
    expect(mcp.mock.calls.length).toBeGreaterThan(reads)
  })

  it('is not in the composer while OpenCode has no MCP server for the folder', async () => {
    servers = []
    await render({ ...baseApi, chat: { ...chat, mcp, setMcp: vi.fn(async () => undefined) } })
    await vi.waitFor(() => expect(mcp).toHaveBeenCalled())
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(chip()).toBeNull()
  })

  it('shows the folder’s servers on the new-thread page, asked for by folder', async () => {
    useWorkspace.setState({ selectedInboxThreadId: null })
    await render({ ...baseApi, chat: { ...chat, mcp, setMcp: vi.fn(async () => undefined) } })
    await vi.waitFor(() => expect(q('[data-testid="inbox-new-thread"]')).not.toBeNull())
    await vi.waitFor(() => expect(chip()).not.toBeNull())
    expect(mcp).toHaveBeenCalledWith({ folderId: 'fld_app' })
  })
})
