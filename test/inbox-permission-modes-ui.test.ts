// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatCreateRequest, ChatOptions, ChatPermissionModeRequest, InboxThread } from '../src/shared/types'
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useInboxDrafts } from '../src/renderer/store/inbox-drafts'
import { useWorkspace } from '../src/renderer/store/workspace'
import { messageInput, setMessageText } from './helpers/chat-input'

const model = { id: 'model-1', providerId: 'provider-1' }
const options: ChatOptions = { agents: [{ id: 'build', name: 'Build' }], models: [{ ...model, name: 'Test Model', providerName: 'Test' }], defaultModel: model, defaultAgent: 'build', skills: [] }
const folder = { id: 'fld_app', name: 'app', directory: '/home/me/app', target: { kind: 'native' as const }, createdAt: 1, lastUsedAt: 1 }
const thread = (patch: Partial<InboxThread> = {}): InboxThread => ({
  id: 'ses_one', title: 'Review tests', directory: folder.directory, target: folder.target, branch: 'main', model, status: 'idle',
  createdAt: 1, lastActivityAt: 1, readAt: 1, archived: false, folderId: folder.id, ...patch,
})
let agentRunning = false
const api = {
  inbox: { setRead: vi.fn(async () => null), setComposer: vi.fn(async (value) => value), gitInfo: vi.fn(async () => ({ repository: false, branch: null, branches: [] })) },
  chat: {
    options: vi.fn(async () => options),
    draft: vi.fn(async (request) => ({ text: request.text ?? '', revision: 1, attachments: [] })),
    create: vi.fn(async (request: ChatCreateRequest) => thread({ ...(request.permissionMode && request.permissionMode !== 'default' ? { permissionMode: request.permissionMode } : {}) })),
    setPermissionMode: vi.fn(async (request: ChatPermissionModeRequest): Promise<InboxThread> =>
      thread(request.mode === 'default' ? {} : { permissionMode: request.mode })),
    messages: vi.fn(async () => ({ messages: [], older: null, running: agentRunning })),
    requests: vi.fn(async () => ({ permissions: [], forms: [] })),
    mcp: vi.fn(async () => ({ servers: [], supported: true })),
    subscribe: vi.fn(async () => {}), unsubscribe: vi.fn(async () => {}), send: vi.fn(async () => null),
  },
}

let root: Root
let container: HTMLDivElement
const render = () => act(async () => root.render(createElement(InboxThreadView)))
const button = (label: string) => Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label)!
const picker = () => container.querySelector<HTMLElement>('[data-testid="permission-mode-picker"]')!
/** Radix opens its menus on a keyboard press in happy-dom. */
const openPicker = () => act(async () => { picker().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
const menuItem = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="permission-mode-${id}"]`)

beforeEach(() => {
  vi.clearAllMocks()
  agentRunning = false
  localStorage.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
  vi.stubGlobal('api', api)
  useWorkspace.setState({ activeWorkspaceView: 'inbox', platform: { platform: 'darwin', isWindows: false }, inboxThreads: [], selectedInboxThreadId: null, inboxTerminalHighlights: {}, statuses: {}, exits: {}, terminalDirectories: {} })
  useInboxChat.setState({ folders: [folder], composer: { folderId: folder.id }, foldersLoaded: true, threads: {}, options: {}, recent: [], titleRegenerations: {}, draftReloads: {} })
  useInboxDrafts.setState({ page: { id: 'drf_perm', opened: false }, drafts: [], threadDrafts: [] })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('Inbox permission modes', () => {
  it('starts a new thread with the default permissions, which sends no mode', async () => {
    await render()
    await vi.waitFor(() => expect(picker().getAttribute('aria-label')).toMatch(/^Permissions: Default permissions./))
    await setMessageText(messageInput(container), 'Fix it')
    await act(async () => button('Send').click())
    expect(api.chat.create).toHaveBeenCalledTimes(1)
    expect(api.chat.create.mock.calls[0]![0]).not.toHaveProperty('permissionMode')
  })

  it('starts a new thread with the mode picked in the strip under the box', async () => {
    await render()
    await vi.waitFor(() => expect(picker()).not.toBeNull())
    await openPicker()
    expect(document.body.querySelector('[data-testid="permission-mode-menu"]')?.textContent).toContain('Things you allowed with Always still run without asking.')
    await act(async () => menuItem('read-only')!.click())
    expect(picker().textContent).toBe('Read-only')
    expect(picker().dataset.mode).toBe('read-only')
    await setMessageText(messageInput(container), 'Look around')
    await act(async () => button('Send').click())
    expect(api.chat.create).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'read-only', text: 'Look around' }))
  })

  it('keeps the default as a quiet shield in a thread and changes the running thread\'s mode', async () => {
    agentRunning = true
    useWorkspace.setState({ inboxThreads: [thread({ status: 'working' })], selectedInboxThreadId: 'ses_one' })
    await render()
    await vi.waitFor(() => expect(picker()).not.toBeNull())
    expect(picker().dataset.mode).toBe('default')
    expect(picker().textContent).toBe('')
    expect(picker().getAttribute('aria-label')).toBe('Permissions: Default permissions. Your OpenCode settings, global and project.')
    await openPicker()
    expect(document.body.querySelector('[data-testid="permission-mode-menu"]')?.textContent).toContain('A change applies from the agent’s next step.')
    await act(async () => menuItem('full')!.click())
    expect(api.chat.setPermissionMode).toHaveBeenCalledWith({ threadId: 'ses_one', mode: 'full' })
    await vi.waitFor(() => expect(picker().dataset.mode).toBe('full'))
    expect(picker().textContent).toBe('Full access')
    expect(useWorkspace.getState().inboxThreads[0]?.permissionMode).toBe('full')
    expect(document.body.querySelector('[data-testid="permission-mode-menu"]')).toBeNull()
  })

  it('keeps the menu open with the reason when the change is refused, and the mode as it was', async () => {
    useWorkspace.setState({ inboxThreads: [thread({ permissionMode: 'ask' })], selectedInboxThreadId: 'ses_one' })
    api.chat.setPermissionMode.mockRejectedValueOnce(new Error('This OpenCode service does not support permissions per thread. Update OpenCode and try again.'))
    await render()
    await vi.waitFor(() => expect(picker()?.dataset.mode).toBe('ask'))
    await openPicker()
    await act(async () => menuItem('full-web-asks')!.click())
    await vi.waitFor(() => expect(document.body.querySelector('[data-testid="permission-mode-error"]')?.textContent).toContain('Update OpenCode'))
    expect(picker().dataset.mode).toBe('ask')
    expect(useWorkspace.getState().inboxThreads[0]?.permissionMode).toBe('ask')
  })
})
