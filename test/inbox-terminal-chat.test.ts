// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatCreateRequest, ChatOptions, InboxThread } from '../src/shared/types'
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useInboxDrafts } from '../src/renderer/store/inbox-drafts'
import { useWorkspace } from '../src/renderer/store/workspace'
import { attachSession, detachSession, disposeSession } from '../src/renderer/terminal/sessions'
import { messageInput, setMessageText } from './helpers/chat-input'

vi.mock('../src/renderer/terminal/sessions', () => {
  const terminals = new Map()
  return {
    attachSession: vi.fn((terminalId: string, host: HTMLElement) => {
      if (!terminals.has(terminalId)) terminals.set(terminalId, { terminalId, themeId: 'slate', term: { focus: vi.fn(), reset: vi.fn() }, container: document.createElement('div') })
      const terminal = terminals.get(terminalId)
      host.append(terminal.container)
      return terminal
    }),
    detachSession: vi.fn((terminalId: string) => terminals.get(terminalId)?.container.remove()),
    disposeSession: vi.fn((terminalId: string) => terminals.delete(terminalId)),
    getSession: (terminalId: string) => terminals.get(terminalId),
    fitSession: () => ({ cols: 100, rows: 35 }),
  }
})

const model = { id: 'model-1', providerId: 'provider-1' }
const options: ChatOptions = { agents: [{ id: 'build', name: 'Build' }], models: [{ ...model, name: 'Test Model', providerName: 'Test' }], defaultModel: model, defaultAgent: 'build', skills: [] }
const folder = { id: 'fld_app', name: 'app', directory: '/home/me/app', target: { kind: 'native' as const }, createdAt: 1, lastUsedAt: 1 }
const thread = (id = 'ses_one', mode: InboxThread['mode'] = 'terminal'): InboxThread => ({ id, mode, title: 'Review tests', directory: folder.directory, target: folder.target, branch: 'main', model, status: 'working', createdAt: 1, lastActivityAt: 1, readAt: 1, archived: false, folderId: folder.id })
const terminalId = 'inbox-thread:ses_one'
const api = {
  pty: { ensure: vi.fn(async () => 'running'), restart: vi.fn(async () => 'running'), resize: vi.fn(async () => {}) },
  inbox: { setRead: vi.fn(async () => null), setComposer: vi.fn(async (value) => value), gitInfo: vi.fn(async () => ({ repository: false, branch: null, branches: [] })), remove: vi.fn(async () => {}) },
  chat: {
    options: vi.fn(async () => options),
    draft: vi.fn(async (request) => ({ text: request.text ?? '', revision: 1, attachments: [] })),
    create: vi.fn(async (request: ChatCreateRequest) => thread('ses_one', request.mode)),
    messages: vi.fn(async () => ({ messages: [], older: null, running: true })),
    requests: vi.fn(async () => ({ permissions: [], forms: [] })),
    mcp: vi.fn(async () => ({ servers: [], supported: true })),
    subscribe: vi.fn(async () => {}), unsubscribe: vi.fn(async () => {}), send: vi.fn(async () => null),
  },
}
let root: Root
let container: HTMLDivElement
const render = () => act(async () => root.render(createElement(InboxThreadView)))
const button = (label: string) => Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label)!
/** The chip that says how a new thread is shown. Radix opens its menus on a keyboard press in happy-dom. */
const modePicker = () => container.querySelector<HTMLElement>('[data-testid="thread-mode-picker"]')!
const chooseMode = async (id: 'gui' | 'terminal') => {
  await act(async () => { modePicker().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  await act(async () => document.body.querySelector<HTMLElement>(`[data-testid="thread-mode-${id}"]`)!.click())
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
  vi.stubGlobal('api', api)
  useWorkspace.setState({ activeWorkspaceView: 'inbox', platform: { platform: 'darwin', isWindows: false }, inboxThreads: [], selectedInboxThreadId: null, inboxTerminalHighlights: {}, statuses: {}, exits: {}, terminalDirectories: {} })
  useInboxChat.setState({ folders: [folder], composer: { folderId: folder.id }, foldersLoaded: true, threads: {}, options: {}, recent: [], titleRegenerations: {}, draftReloads: {} })
  useInboxDrafts.setState({ page: { id: 'drf_terminal', opened: false }, drafts: [], threadDrafts: [] })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('Inbox terminal chat', () => {
  it('defaults to GUI and starts a selected terminal thread with the same composer choices', async () => {
    await render()
    expect(modePicker().textContent).toBe('GUI')
    await chooseMode('terminal')
    expect(modePicker().textContent).toBe('Terminal')
    await setMessageText(messageInput(container), 'Review the tests')
    await act(async () => button('Send').click())
    expect(api.chat.create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'terminal', folderId: folder.id, agent: 'build', model, text: 'Review the tests' }))
    await vi.waitFor(() => expect(api.pty.ensure).toHaveBeenCalledWith(expect.objectContaining({ terminalId, sessionId: terminalId, size: { cols: 100, rows: 35 } })))
    expect(container.querySelector('[data-testid="inbox-terminal-thread"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="chat-transcript"]')).toBeNull()
    expect(api.chat.subscribe).toHaveBeenCalledWith({ threadId: 'ses_one' })
  })

  it('keeps each terminal alive when switching threads and returns to the same pane', async () => {
    useWorkspace.setState({ inboxThreads: [thread(), thread('ses_two')], selectedInboxThreadId: 'ses_one' })
    await render()
    await vi.waitFor(() => expect(api.pty.ensure).toHaveBeenCalled())
    const first = vi.mocked(attachSession).mock.results.at(-1)!.value
    await act(async () => useWorkspace.getState().selectInboxThread('ses_two'))
    await vi.waitFor(() => expect(api.pty.ensure).toHaveBeenCalledWith(expect.objectContaining({ terminalId: 'inbox-thread:ses_two' })))
    expect(detachSession).toHaveBeenCalledWith(terminalId)
    expect(disposeSession).not.toHaveBeenCalled()
    await act(async () => useWorkspace.getState().selectInboxThread('ses_one'))
    await vi.waitFor(() => expect(vi.mocked(attachSession).mock.results.at(-1)!.value).toBe(first))
    expect(api.chat.unsubscribe).toHaveBeenCalledWith({ threadId: 'ses_one' })
  })

  it('reopens the same API conversation after the OpenCode terminal exits', async () => {
    useWorkspace.setState({ inboxThreads: [thread()], selectedInboxThreadId: 'ses_one' })
    await render()
    await vi.waitFor(() => expect(api.pty.ensure).toHaveBeenCalled())
    await act(async () => useWorkspace.getState().noteExit({ terminalId, sessionId: terminalId, exitCode: 0 }))
    await act(async () => button('Reopen OpenCode').click())
    expect(api.pty.restart).toHaveBeenCalledWith(expect.objectContaining({ terminalId, sessionId: terminalId }))
    expect(api.chat.create).not.toHaveBeenCalled()
    expect(api.chat.send).not.toHaveBeenCalled()
    expect(useWorkspace.getState().statuses[terminalId]).toBe('running')
  })

  it.each([
    ['attention', 'attention'], ['completed', 'done'], ['error', 'error'],
  ] as const)('animates only the OpenCode surface when the API reports %s', async (status, tone) => {
    useWorkspace.setState({ inboxThreads: [thread()], selectedInboxThreadId: 'ses_one' })
    await render()
    expect(container.querySelector('[data-testid="inbox-terminal-highlight"]')).toBeNull()
    await act(async () => useWorkspace.getState().upsertInboxThread({ ...thread(), status, lastActivityAt: 2 }))
    const surface = container.querySelector('[data-testid="inbox-terminal-surface"]')
    const highlight = surface?.querySelector<HTMLElement>('[data-testid="inbox-terminal-highlight"]')
    expect(highlight?.dataset.tone).toBe(tone)
    expect(surface?.querySelector('.terminal-host')).not.toBeNull()
    expect(container.querySelectorAll('[data-testid="inbox-terminal-highlight"]')).toHaveLength(1)
  })

  it('does not animate a terminal when a GUI thread completes', async () => {
    const gui = thread('ses_gui', 'gui')
    useWorkspace.setState({ inboxThreads: [thread(), gui], selectedInboxThreadId: 'ses_one' })
    await render()
    await act(async () => useWorkspace.getState().upsertInboxThread({ ...gui, status: 'completed', lastActivityAt: 2 }))
    expect(container.querySelector('[data-testid="inbox-terminal-highlight"]')).toBeNull()
    expect(useWorkspace.getState().inboxTerminalHighlights).toEqual({})
  })

  it('restores a terminal draft and resets fresh pages to GUI', async () => {
    useInboxDrafts.setState({ page: { id: 'drf_restored', opened: true, folderId: folder.id, choice: { mode: 'terminal', agent: 'build', model } } })
    await render()
    expect(modePicker().textContent).toBe('Terminal')
    await act(async () => useInboxDrafts.setState({ page: { id: 'drf_fresh', opened: false } }))
    expect(modePicker().textContent).toBe('GUI')
  })

  it('has the interface chip in the strip under the box and no longer in the box\'s toolbar, for a folder that is not a Git repository', async () => {
    await render()
    const strip = container.querySelector('[data-testid="thread-bar"]')!
    expect(strip.contains(modePicker())).toBe(true)
    expect(container.querySelector('[data-testid="chat-composer"]')!.contains(modePicker())).toBe(false)
    expect(container.querySelector('[data-testid="chat-composer"]')!.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelector('[data-testid="worktree-bar"]')).toBeNull()
    expect(container.querySelector('[data-testid="thread-mode-switch"]')).toBeNull()
  })

  it('lists GUI and Terminal in the menu, with what each does, and marks the one in use', async () => {
    await render()
    await act(async () => { modePicker().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    const items = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    expect(items.map((item) => item.getAttribute('data-testid'))).toEqual(['thread-mode-gui', 'thread-mode-terminal'])
    expect(items[0]!.textContent).toBe('GUIFollow the conversation in MDE.')
    expect(items[1]!.textContent).toBe('TerminalWork in the OpenCode terminal.')
    expect(items[0]!.querySelector('svg.lucide-check')).not.toBeNull()
    expect(items[1]!.querySelector('svg.lucide-check')).toBeNull()
  })

  it('goes back to GUI by choosing it in the menu, and starts a GUI thread without a mode', async () => {
    await render()
    await chooseMode('terminal')
    await chooseMode('gui')
    expect(modePicker().textContent).toBe('GUI')
    await setMessageText(messageInput(container), 'Review the tests')
    await act(async () => button('Send').click())
    expect(api.chat.create).toHaveBeenCalledOnce()
    expect(api.chat.create.mock.calls[0]![0]).not.toHaveProperty('mode')
  })

  it('releases terminal resources when the thread is removed', async () => {
    useWorkspace.setState({ inboxThreads: [thread()], selectedInboxThreadId: 'ses_one' })
    await render()
    await vi.waitFor(() => expect(api.pty.ensure).toHaveBeenCalled())
    await act(async () => useWorkspace.getState().upsertInboxThread({ ...thread(), status: 'completed', lastActivityAt: 2 }))
    expect(useWorkspace.getState().inboxTerminalHighlights.ses_one).toBeDefined()
    await act(async () => useWorkspace.getState().removeInboxThread('ses_one'))
    expect(disposeSession).toHaveBeenCalledWith(terminalId)
    expect(useWorkspace.getState().statuses[terminalId]).toBe('none')
    expect(useWorkspace.getState().selectedInboxThreadId).toBeNull()
    expect(useWorkspace.getState().inboxTerminalHighlights).toEqual({})
  })

  it('keeps an unfinished message from a sidebar fork available without submitting it automatically', async () => {
    useWorkspace.setState({ inboxThreads: [thread()], selectedInboxThreadId: 'ses_one' })
    await render()
    api.chat.draft.mockResolvedValueOnce({ text: 'Continue the original task', revision: 3, attachments: [] })
    await act(async () => useInboxChat.setState({ draftReloads: { ses_one: { id: 1, caret: 26 } } }))
    expect(container.textContent).toContain('Continue the original task')
    expect(api.chat.send).not.toHaveBeenCalled()
    api.chat.draft.mockResolvedValueOnce({ text: 'Continue the original task', revision: 3, attachments: [] })
    await act(async () => button('Send saved draft').click())
    expect(api.chat.send).toHaveBeenCalledWith({ threadId: 'ses_one', text: 'Continue the original task', attachmentIds: [], draftRevision: 3 })
    expect(container.textContent).not.toContain('Send saved draft')
  })
})
