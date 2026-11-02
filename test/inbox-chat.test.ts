// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatDraft, ChatDraftRequest, ChatForkRequest, ChatForkResult, ChatMessage, ChatMessagesPage, ChatOptions, ChatRequests, ChatRevert, ChatRevertRequest, InboxFolder, InboxThread } from '../src/shared/types'
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useWorkspace } from '../src/renderer/store/workspace'
import { getTerminalSettings, saveTerminalSettings, TERMINAL_SETTINGS_STORAGE_KEY } from '../src/renderer/terminal/terminal-settings'

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
    createdAt: 1, lastActivityAt: Date.now(), readAt: Date.now(), archived: false, folderId: 'fld_app',
    ...overrides,
  }
}

/** What a fork of `ses_one` looks like once recorded. */
function forkedThread(): InboxThread {
  return thread({ id: 'ses_fork', title: 'Fix login (fork #1)', status: 'idle', forkedFrom: 'ses_one', readAt: Date.now() })
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
    draft: vi.fn(async (req: { text?: string }) => ({ text: req.text ?? '', revision: 1, attachments: [] })),
    options: vi.fn(async () => options),
    create: vi.fn(async () => thread({ id: 'ses_new', title: 'New thread' })),
    messages: vi.fn(async () => page),
    requests: vi.fn(async () => requests),
    send: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    redo: vi.fn(async (): Promise<void> => undefined),
    revert: vi.fn(async (request: ChatRevertRequest): Promise<ChatRevert> => ({ messageId: request.messageId, files: [] })),
    fork: vi.fn(async (_request: ChatForkRequest): Promise<ChatForkResult> => ({ thread: forkedThread() })),
    regenerateTitle: vi.fn(async (): Promise<void> => undefined),
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

/**
 * A draft store in miniature: what a composer loads is what was last typed or put above it, kept per
 * draft. `initial` is the text of the open thread's draft.
 */
function draftStore(initial: string): { saved: (key?: string) => string } {
  const stored: Record<string, string> = { 'thread:ses_one': initial }
  api.chat.draft.mockImplementation((async (request: ChatDraftRequest): Promise<ChatDraft> => {
    const current = stored[request.key] ?? ''
    if (request.action === 'text') stored[request.key] = request.text
    if (request.action === 'prepend') stored[request.key] = current.trim() ? `${request.text}\n\n${current}` : request.text
    return { text: stored[request.key] ?? current, revision: 1, attachments: [] }
  }) as never)
  return { saved: (key = 'thread:ses_one') => stored[key] ?? '' }
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
    inboxThreads: [],
    selectedInboxThreadId: null,
    activeWorkspaceView: 'inbox',
  })
  useInboxChat.setState({ folders: [folder], composer: { folderId: 'fld_app' }, foldersLoaded: true, options: {}, threads: {}, recent: [], titleRegenerations: {} })
})

afterEach(async () => {
  // Tests that stand in for the service put the plain answers back.
  api.chat.draft.mockImplementation(async (req: { text?: string }) => ({ text: req.text ?? '', revision: 1, attachments: [] }))
  api.chat.revert.mockImplementation(async (request: ChatRevertRequest) => ({ messageId: request.messageId, files: [] }))
  api.chat.fork.mockImplementation(async () => ({ thread: forkedThread() }))
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
      attachmentIds: [], draftRevision: 1, folderId: 'fld_app', text: 'Add a dark mode', agent: 'build', model: { id: 'free-1', providerId: 'opencode' },
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
  it('regenerates the selected title, keeps pending state across navigation, and follows title updates', async () => {
    const original = thread({ archived: true })
    useWorkspace.setState({ inboxThreads: [original, thread({ id: 'ses_two', title: 'Other' })], selectedInboxThreadId: original.id })
    let finish!: () => void
    api.chat.regenerateTitle.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const view = await render()
    await act(async () => button(view, 'Regenerate title').click())
    expect(api.chat.regenerateTitle).toHaveBeenCalledWith({ threadId: 'ses_one' })
    expect(button(view, 'Regenerate title').disabled).toBe(true)
    expect(view.textContent).toContain('Regenerating…')
    await act(async () => useWorkspace.setState({ selectedInboxThreadId: 'ses_two' }))
    expect(button(view, 'Regenerate title').disabled).toBe(false)
    await act(async () => useWorkspace.setState({ selectedInboxThreadId: 'ses_one' }))
    expect(button(view, 'Regenerate title').disabled).toBe(true)
    await act(async () => {
      useWorkspace.getState().upsertInboxThread({ ...original, title: 'Updated title' })
      finish()
    })
    expect(view.querySelector('h2')?.textContent).toBe('Updated title')
    expect(button(view, 'Regenerate title').disabled).toBe(false)
    expect(useWorkspace.getState().inboxThreads.find((item) => item.id === original.id)?.title).toBe('Updated title')
  })

  it('shows title errors only on their thread and permits retry', async () => {
    useWorkspace.setState({ inboxThreads: [thread(), thread({ id: 'ses_two' })], selectedInboxThreadId: 'ses_one' })
    api.chat.regenerateTitle.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:regenerate-title': Error: Service unavailable"))
    const view = await render()
    await act(async () => button(view, 'Regenerate title').click())
    expect(view.querySelector('[role="alert"]')?.textContent).toBe('Service unavailable')
    expect(view.querySelector('h2')?.textContent).toBe('Fix login')
    await act(async () => useWorkspace.setState({ selectedInboxThreadId: 'ses_two' }))
    expect(view.querySelector('[role="alert"]')).toBeNull()
    await act(async () => useWorkspace.setState({ selectedInboxThreadId: 'ses_one' }))
    expect(view.querySelector('[role="alert"]')?.textContent).toBe('Service unavailable')
    await act(async () => button(view, 'Regenerate title').click())
    expect(view.querySelector('[role="alert"]')).toBeNull()
    expect(api.chat.regenerateTitle).toHaveBeenCalledTimes(2)
  })

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
    await vi.waitFor(() => expect(api.chat.send).toHaveBeenCalledWith({ threadId: 'ses_one', text: 'Thanks', attachmentIds: [], draftRevision: 1 }))
  })

  describe('file changes', () => {
    const model = options.defaultModel!
    const patch = [
      'Index: /home/me/app/src/auth.ts', '='.repeat(67), '--- /home/me/app/src/auth.ts', '+++ /home/me/app/src/auth.ts',
      '@@ -8,5 +8,5 @@', ' export function total(items: string[]) {', '-  return items.length', '+  return items.size', ' }', ' ', ' export const limit = 3', '',
    ].join('\n')
    type Tool = Extract<ChatMessagesPage['messages'][number], { kind: 'assistant' }>['parts'][number]
    const assistant = (...parts: Tool[]): ChatMessagesPage['messages'][number] =>
      ({ kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model, completed: true, parts })
    const edit = (overrides: Record<string, unknown> = {}): Tool => ({
      kind: 'tool', id: 'call_1', name: 'edit', status: 'completed',
      input: JSON.stringify({ filePath: '/home/me/app/src/auth.ts', oldString: '  return items.length', newString: '  return items.size' }),
      output: 'Edited auth.ts (1 replacement)',
      patches: [{ path: '/home/me/app/src/auth.ts', patch }],
      ...overrides,
    } as Tool)
    const card = (view: HTMLElement): HTMLElement | null => view.querySelector('[data-testid="chat-diff"]')
    const rows = (view: HTMLElement): { kind: string | null; text: string }[] =>
      Array.from(view.querySelectorAll('.file-diff-row')).map((row) => ({ kind: row.getAttribute('data-kind'), text: row.querySelector('.file-diff-code')?.textContent ?? '' }))

    it.each(['completed', 'running'] as const)('follows the code preview font in %s tools and newly expanded details', async (status) => {
      const stored = localStorage.getItem(TERMINAL_SETTINGS_STORAGE_KEY)
      const fonts = Object.getOwnPropertyDescriptor(document, 'fonts')
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: { check: (query: string) => query.includes('Fira Code') || query.includes('JetBrains Mono') },
      })
      // happy-dom does not apply cascade layers; load the actual font rule outside its layer.
      const css = readFileSync(join(__dirname, '../src/renderer/index.css'), 'utf8')
      const rule = css.match(/\.inbox-code-font,\s*\.file-diff\s*\{[^}]+\}/)?.[0]
      expect(rule).toBeTruthy()
      const style = document.createElement('style')
      style.textContent = `:root { --font-mono: monospace; }\n${rule}`
      document.head.append(style)
      try {
        saveTerminalSettings({ ...getTerminalSettings(), family: 'JetBrains Mono', codeFamily: 'Fira Code' })
        page = { running: status === 'running', older: null, messages: [assistant(
          edit({ status }),
          { kind: 'tool', id: 'call_write', name: 'write', status, existed: false, input: JSON.stringify({ filePath: '/home/me/app/new.ts', content: 'export const a = 1\n' }) },
          { kind: 'tool', id: 'call_read', name: 'read', status: 'completed', input: '{"path":"/home/me/app/src/auth.ts"}', output: 'file contents' },
          edit({ id: 'call_failed', status: 'error', error: 'Edit failed' }),
        )] }
        const view = await render()
        await vi.waitFor(() => expect(card(view)).not.toBeNull())
        const diff = view.querySelector('.file-diff-code')!
        await act(async () => view.querySelector<HTMLButtonElement>('[data-testid="chat-tool-call_read"] button')!.click())
        const codeNodes = (): Element[] => Array.from(view.querySelectorAll(
          '.file-diff-code, .file-diff-gutter, .file-diff-sign, .inbox-code-font',
        ))
        expect(codeNodes().length).toBeGreaterThan(10)
        expect(view.querySelector('[data-testid="chat-tool-call_read"] pre')).not.toBeNull()
        for (const node of codeNodes()) expect(getComputedStyle(node).fontFamily).toContain('Fira Code')

        await act(async () => saveTerminalSettings({ ...getTerminalSettings(), codeFamily: 'JetBrains Mono' }))
        expect(view.querySelector('.file-diff-code')).toBe(diff)
        for (const node of codeNodes()) expect(getComputedStyle(node).fontFamily).toContain('JetBrains Mono')

        await act(async () => view.querySelector<HTMLButtonElement>('[data-testid="chat-tool-call_failed"] button')!.click())
        const details = Array.from(view.querySelectorAll('[data-testid="chat-tool-call_failed"] pre'))
        expect(details.length).toBeGreaterThan(0)
        for (const node of details) expect(getComputedStyle(node).fontFamily).toContain('JetBrains Mono')

        await act(async () => saveTerminalSettings({ ...getTerminalSettings(), family: 'Fira Code' }))
        for (const node of codeNodes()) expect(getComputedStyle(node).fontFamily).toContain('JetBrains Mono')
        await act(async () => saveTerminalSettings({ ...getTerminalSettings(), codeFamily: 'monospace' }))
        for (const node of codeNodes()) expect(getComputedStyle(node).fontFamily).toBe('monospace')
      } finally {
        style.remove()
        if (fonts) Object.defineProperty(document, 'fonts', fonts)
        else delete (document as { fonts?: unknown }).fonts
        if (stored === null) localStorage.removeItem(TERMINAL_SETTINGS_STORAGE_KEY)
        else localStorage.setItem(TERMINAL_SETTINGS_STORAGE_KEY, stored)
      }
    })

    it('draws a finished edit as a numbered diff instead of raw JSON', async () => {
      page = { running: false, older: null, messages: [assistant(edit())] }
      const view = await render()
      await vi.waitFor(() => expect(card(view)).not.toBeNull())
      expect(card(view)?.getAttribute('aria-label')).toBe('Edited src/auth.ts')
      expect(view.querySelector('.file-diff[data-quiet]')).toBeNull()
      expect(card(view)?.querySelector('[data-testid="chat-diff-stats"]')?.textContent).toBe('+1−1')
      expect(rows(view)).toEqual([
        { kind: 'context', text: 'export function total(items: string[]) {' },
        { kind: 'del', text: '  return items.length' },
        { kind: 'add', text: '  return items.size' },
        { kind: 'context', text: '}' },
        { kind: 'context', text: '' },
        { kind: 'context', text: 'export const limit = 3' },
      ])
      // The numbers: a deleted line has its old number, the others their new one.
      expect(Array.from(view.querySelectorAll('.file-diff-gutter')).map((cell) => cell.textContent)).toEqual(['8', '9', '9', '10', '11', '12'])
      expect(view.textContent).not.toContain('oldString')
      expect(view.textContent).not.toContain('Index:')
    })

    it('marks the words that changed within a line', async () => {
      page = { running: false, older: null, messages: [assistant(edit())] }
      const view = await render()
      await vi.waitFor(() => expect(card(view)).not.toBeNull())
      const marked = Array.from(view.querySelectorAll('.file-diff-row')).map((row) =>
        Array.from(row.querySelectorAll('.file-diff-emphasis')).map((span) => span.textContent).join(''))
      expect(marked).toEqual(['', 'length', 'size', '', '', ''])
    })

    it('colors the code by its language once that has loaded', async () => {
      page = { running: false, older: null, messages: [assistant(edit())] }
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('.file-diff-row[data-kind="del"]')?.innerHTML).toContain('--color-syntax-keyword'))
      // Colors never change the text.
      expect(rows(view)[1]!.text).toBe('  return items.length')
    })

    it('shows an edit that waits for permission with the change it asks for', async () => {
      page = { running: true, older: null, messages: [assistant(edit({ status: 'running', patches: undefined, output: undefined }))] }
      requests = { permissions: [{ id: 'per_1', action: 'edit', resources: ['src/auth.ts'] }], forms: [] }
      const view = await render()
      await vi.waitFor(() => expect(card(view)).not.toBeNull())
      await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-permission-per_1"]')).not.toBeNull())
      expect(card(view)?.getAttribute('aria-label')).toBe('Editing src/auth.ts')
      expect(rows(view)).toEqual([{ kind: 'del', text: '  return items.length' }, { kind: 'add', text: '  return items.size' }])
      // Without OpenCode's diff there are no line numbers.
      expect(view.querySelector('.file-diff-gutter')).toBeNull()
    })

    it('folds the diff away from its header', async () => {
      page = { running: false, older: null, messages: [assistant(edit())] }
      const view = await render()
      await vi.waitFor(() => expect(card(view)).not.toBeNull())
      const header = card(view)!.querySelector('button')!
      expect(header.getAttribute('aria-expanded')).toBe('true')
      await act(async () => header.click())
      expect(header.getAttribute('aria-expanded')).toBe('false')
      expect(view.querySelector('.file-diff-row')).toBeNull()
      expect(card(view)?.textContent).toContain('src/auth.ts')
      await act(async () => header.click())
      expect(view.querySelectorAll('.file-diff-row')).toHaveLength(6)
    })

    it('shows a written file as additions, and says whether it replaced one', async () => {
      const write = (existed: boolean | undefined): Tool => ({
        kind: 'tool', id: 'call_2', name: 'write', status: 'completed',
        input: JSON.stringify({ filePath: '/home/me/app/NOTES.md', content: '# Notes\n\nHello\n' }),
        ...(existed === undefined ? {} : { existed }),
      } as Tool)
      page = { running: false, older: null, messages: [assistant(write(false))] }
      const view = await render()
      await vi.waitFor(() => expect(card(view)).not.toBeNull())
      expect(card(view)?.getAttribute('aria-label')).toBe('Created NOTES.md')
      expect(card(view)?.querySelector('[data-testid="chat-diff-stats"]')?.textContent).toBe('+3')
      expect(rows(view).map((row) => row.kind)).toEqual(['add', 'add', 'add'])
      // A whole file is tinted lightly; an edit's changed lines are not.
      expect(view.querySelector('.file-diff[data-quiet]')).not.toBeNull()
      expect(Array.from(view.querySelectorAll('.file-diff-gutter')).map((cell) => cell.textContent)).toEqual(['1', '2', '3'])

      page = { running: false, older: null, messages: [assistant(write(true))] }
      await act(async () => { useInboxChat.getState().applyEvent({ type: 'messages', threadId: 'ses_one' }) })
      await vi.waitFor(() => expect(card(view)?.getAttribute('aria-label')).toBe('Overwrote NOTES.md'))
    })

    it('keeps the plain row, with the reason, for an edit that failed', async () => {
      page = { running: false, older: null, messages: [assistant(edit({ status: 'error', patches: undefined, output: undefined, error: 'Found 2 matches for oldString' }))] }
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-tool-call_1"]')).not.toBeNull())
      expect(card(view)).toBeNull()
      expect(view.querySelector('[data-testid="chat-tool-call_1"]')?.textContent).toContain('Found 2 matches for oldString')
    })

    it('shortens a long diff and shows the rest on request', async () => {
      const body = Array.from({ length: 60 }, (_, index) => `line ${index}`).join('\n')
      const write: Tool = { kind: 'tool', id: 'call_3', name: 'write', status: 'completed', input: JSON.stringify({ filePath: '/home/me/app/long.txt', content: body }), existed: false }
      page = { running: false, older: null, messages: [assistant(write)] }
      const view = await render()
      await vi.waitFor(() => expect(card(view)).not.toBeNull())
      expect(view.querySelectorAll('.file-diff-row')).toHaveLength(28)
      expect(button(view, 'Show 32 more lines')).toBeTruthy()
      await act(async () => button(view, 'Show 32 more lines').click())
      expect(view.querySelectorAll('.file-diff-row')).toHaveLength(60)
      expect(() => button(view, 'Show 32 more lines')).toThrow()
    })

    it('leaves other tools as they were', async () => {
      page = { running: false, older: null, messages: [assistant({ kind: 'tool', id: 'call_4', name: 'read', status: 'completed', input: '{"path":"/home/me/app/src/auth.ts"}', output: 'x' })] }
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-tool-call_4"]')).not.toBeNull())
      expect(card(view)).toBeNull()
      expect(view.querySelector('[data-testid="chat-tool-call_4"]')?.textContent).toContain('Read src/auth.ts')
    })
  })

  describe('time worked', () => {
    const model = options.defaultModel!
    const user = (id: string, time: number): ChatMessagesPage['messages'][number] => ({ kind: 'user', id, time, text: `Ask ${id}` })
    const step = (id: string, time: number, completedAt?: number): ChatMessagesPage['messages'][number] => ({
      kind: 'assistant', id, time, agent: 'build', model, completed: completedAt !== undefined, parts: [{ kind: 'text', text: `Answer ${id}` }],
      ...(completedAt !== undefined ? { completedAt } : {}),
    })
    const durations = (view: HTMLElement): string[] =>
      Array.from(view.querySelectorAll('[data-testid="chat-turn-duration"]')).map((item) => item.textContent ?? '')

    it('says how long each finished turn took, under its answer and above the next question', async () => {
      useWorkspace.setState({ inboxThreads: [thread({ status: 'completed' })], selectedInboxThreadId: 'ses_one' })
      page = {
        running: false, older: null,
        messages: [
          user('u1', 1_000), step('a1', 1_010, 6_000), step('a2', 6_020, 91_000),
          user('u2', 200_000), step('a3', 200_010, 203_400),
        ],
      }
      const view = await render()
      await vi.waitFor(() => expect(durations(view)).toHaveLength(2))
      expect(durations(view)).toEqual(['Worked for 1m 30s', 'Worked for 3s'])
      expect(view.querySelector('[data-testid="chat-turn-duration"]')?.getAttribute('title')).toBe('1 minute 30 seconds')
      expect(view.querySelector('[data-testid="chat-working"]')).toBeNull()

      const order = Array.from(view.querySelectorAll('[data-testid^="chat-message-"], [data-testid="chat-turn-duration"]'))
        .map((item) => item.getAttribute('data-testid') === 'chat-turn-duration' ? 'time' : item.getAttribute('data-testid'))
      expect(order).toEqual(['chat-message-u1', 'chat-message-a1', 'chat-message-a2', 'time', 'chat-message-u2', 'chat-message-a3', 'time'])
    })

    it('adds how fast the model generated when OpenCode\'s numbers give it, and leaves it out when they do not', async () => {
      useWorkspace.setState({ inboxThreads: [thread({ status: 'completed' })], selectedInboxThreadId: 'ses_one' })
      const timed = (id: string, time: number, streamedAt: number, completedAt: number, output: number): ChatMessagesPage['messages'][number] => ({
        kind: 'assistant', id, time, agent: 'build', model, completed: true, completedAt, streamedAt,
        parts: [{ kind: 'text', text: `Answer ${id}` }], tokens: { input: 5, output, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      })
      page = {
        running: false, older: null,
        messages: [
          user('u1', 1_000), timed('a1', 1_010, 3_010, 8_000, 106), timed('a2', 8_020, 9_020, 9_100, 100),
          user('u2', 20_000), step('a3', 20_010, 21_000),
        ],
      }
      const view = await render()
      await vi.waitFor(() => expect(durations(view)).toHaveLength(2))
      // (106 + 100) tokens over 2 s + 1 s of generating; the 5 s the first step spent on tools do not count.
      expect(durations(view)).toEqual(['Worked for 8s·68.7 tok/s', 'Worked for 1s'])
      const rates = view.querySelectorAll('[data-testid="chat-turn-rate"]')
      expect(rates).toHaveLength(1)
      expect(rates[0]!.getAttribute('title')).toContain('tokens per second')
    })

    it('counts the turn in progress from when the thread began working, not from the service clock', async () => {
      // The service's clock is far off; the count must not follow it.
      useWorkspace.setState({
        inboxThreads: [thread({ status: 'working', workingSince: Date.now() - 90_000 })], selectedInboxThreadId: 'ses_one',
      })
      page = { running: true, older: null, messages: [user('u1', 5), step('a1', 6, 50), step('a2', 60)] }
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-working"]')).not.toBeNull())
      expect(view.querySelector('[data-testid="chat-working"]')?.textContent).toMatch(/^Working for 1m (30|31|32)s$/)
      // The unfinished turn has no finished-turn line yet.
      expect(durations(view)).toEqual([])
      // The same count is not repeated in the header, which only names the state.
      expect(view.querySelector('[data-testid="inbox-thread-view"] [data-testid="inbox-status-chip"]')?.textContent).toBe('Working')
    })

    it('counts from the question when the thread has no clock of its own, and keeps the previous turn\'s time', async () => {
      useWorkspace.setState({ inboxThreads: [thread({ status: 'working' })], selectedInboxThreadId: 'ses_one' })
      const sent = Date.now() - 20_000
      page = { running: true, older: null, messages: [user('u1', 1_000), step('a1', 1_010, 5_000), user('u2', sent)] }
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-working"]')).not.toBeNull())
      expect(view.querySelector('[data-testid="chat-working"]')?.textContent).toMatch(/^Working for (19|20|21|22)s$/)
      expect(durations(view)).toEqual(['Worked for 4s'])
    })

    it('starts at zero when nothing says when the work began, and turns into the finished line when it ends', async () => {
      useWorkspace.setState({ inboxThreads: [thread({ status: 'working' })], selectedInboxThreadId: 'ses_one' })
      page = { running: true, older: null, messages: [] }
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-working"]')?.textContent).toBe('Working for 0s'))

      page = { running: false, older: null, messages: [user('u1', 1_000), step('a1', 1_010, 66_000)] }
      await act(async () => {
        useInboxChat.getState().applyEvent({ type: 'running', threadId: 'ses_one', running: false })
      })
      await vi.waitFor(() => expect(durations(view)).toEqual(['Worked for 1m 5s']))
      expect(view.querySelector('[data-testid="chat-working"]')).toBeNull()
    })
  })

  describe('context usage', () => {
    const windowed: ChatOptions = {
      ...options,
      models: [
        { id: 'free-1', providerId: 'opencode', providerName: 'OpenCode', name: 'Flint Free', contextLimit: 200_000, outputLimit: 64_000 },
        { id: 'small-1', providerId: 'opencode', providerName: 'OpenCode', name: 'Small', contextLimit: 160_000 },
      ],
    }
    const step = (tokens: { input: number; output: number; cacheRead: number }, completed = true): ChatMessagesPage['messages'][number] => ({
      kind: 'assistant', id: `msg_${tokens.input}`, time: 2, agent: 'build', model: options.defaultModel!, completed, parts: [],
      ...(completed ? { tokens: { reasoning: 0, cacheWrite: 0, ...tokens } } : {}),
    })
    const meter = (view: HTMLElement): HTMLElement | null => view.querySelector('[data-testid="chat-context-meter"]')
    afterEach(() => { api.chat.options.mockImplementation(async () => options) })
    /** Radix opens its menus on a pointer press; the keyboard route is what happy-dom supports reliably. */
    const open = async (trigger: Element): Promise<void> => {
      await act(async () => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    }

    it('waits for a finished step, then shows how full the window is', async () => {
      api.chat.options.mockResolvedValue(windowed)
      page = { running: true, older: null, messages: [{ kind: 'user', id: 'msg_1', time: 1, text: 'Fix it' }, step({ input: 1, output: 1, cacheRead: 1 }, false)] }
      const view = await render()
      await vi.waitFor(() => expect(view.textContent).toContain('Fix it'))
      expect(meter(view)).toBeNull()

      page = {
        running: false, older: null,
        usage: { cost: 0.42, tokens: { input: 5000, output: 900, reasoning: 100, cacheRead: 400_000, cacheWrite: 0 } },
        messages: [{ kind: 'user', id: 'msg_1', time: 1, text: 'Fix it' }, step({ input: 2000, output: 1000, cacheRead: 147_000 })],
      }
      await act(async () => { useInboxChat.getState().applyEvent({ type: 'messages', threadId: 'ses_one' }) })
      await vi.waitFor(() => expect(meter(view)).not.toBeNull())
      expect(meter(view)?.getAttribute('aria-label')).toBe('Context: 150K of 200K tokens used (75%)')
      expect(meter(view)?.getAttribute('data-tone')).toBe('warn')
      expect(meter(view)?.textContent).toBe('150K')

      await open(meter(view)!)
      const details = await vi.waitFor(() => {
        const found = document.querySelector('[data-testid="chat-context-details"]')
        expect(found).not.toBeNull()
        return found!
      })
      expect(details.textContent).toContain('150K')
      expect(details.textContent).toContain('of 200K tokens')
      expect(details.textContent).toContain('75%')
      expect(details.textContent).toContain('Cache read147K')
      expect(details.textContent).toContain('New input2K')
      expect(details.textContent).toContain('Output1K')
      expect(details.textContent).not.toContain('Cache write')
      expect(details.textContent).toContain('Thread total406K')
      expect(details.textContent).toContain('Reported cost$0.42')
      expect(details.textContent).toContain('Flint Free · 200K window · 64K max reply')
    })

    it('measures against the model chosen in the composer', async () => {
      api.chat.options.mockResolvedValue(windowed)
      page = { running: false, older: null, messages: [step({ input: 2000, output: 1000, cacheRead: 117_000 })] }
      const view = await render()
      await vi.waitFor(() => expect(meter(view)).not.toBeNull())
      expect(meter(view)?.getAttribute('aria-label')).toBe('Context: 120K of 200K tokens used (60%)')
      expect(meter(view)?.getAttribute('data-tone')).toBe('normal')

      // The same conversation in a smaller window is fuller, before anything is sent.
      await open(view.querySelector('[data-testid="chat-model-picker"]')!)
      const small = await vi.waitFor(() => {
        const found = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) => item.textContent === 'Small')
        expect(found).toBeDefined()
        return found!
      })
      await act(async () => small.click())
      await vi.waitFor(() => expect(meter(view)?.getAttribute('aria-label')).toBe('Context: 120K of 160K tokens used (75%)'))
      expect(meter(view)?.getAttribute('data-tone')).toBe('warn')
    })

    it('shows only the count when the model reports no window', async () => {
      page = { running: false, older: null, messages: [step({ input: 2000, output: 1000, cacheRead: 117_000 })] }
      const view = await render()
      await vi.waitFor(() => expect(meter(view)).not.toBeNull())
      expect(meter(view)?.getAttribute('aria-label')).toBe('Context: 120K tokens used')
      expect(meter(view)?.getAttribute('data-tone')).toBe('normal')
      await open(meter(view)!)
      await vi.waitFor(() => expect(document.querySelector('[data-testid="chat-context-details"]')?.textContent).toContain('window size unknown'))
    })

    it('turns red when the window is nearly full', async () => {
      api.chat.options.mockResolvedValue(windowed)
      page = { running: false, older: null, messages: [step({ input: 1000, output: 1000, cacheRead: 183_000 })] }
      const view = await render()
      await vi.waitFor(() => expect(meter(view)?.getAttribute('data-tone')).toBe('danger'))
      expect(meter(view)?.getAttribute('aria-label')).toBe('Context: 185K of 200K tokens used (93%)')
    })
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

describe('Inbox staged revert', () => {
  beforeEach(() => {
    useWorkspace.setState({ inboxThreads: [thread()], selectedInboxThreadId: 'ses_one' })
  })

  const user = (id: string, text: string): ChatMessage => ({ kind: 'user', id, time: 1, text })
  const reply = (id: string, text: string): ChatMessage => ({
    kind: 'assistant', id, time: 2, agent: 'build', model: options.defaultModel!, completed: true, parts: [{ kind: 'text', text }],
  })
  const conversation = [user('msg_1', 'First request'), reply('msg_2', 'First answer'), user('msg_3', 'Second request'), reply('msg_4', 'Second answer')]
  // The stub takes no arguments in its type, but the store passes the request.
  const pageRequestsWithCursor = (): unknown[] =>
    (api.chat.messages.mock.calls as unknown as Array<[{ threadId: string; cursor?: string }?]>).filter(([request]) => request?.cursor)
  const refetch = async (): Promise<void> => {
    await act(async () => useInboxChat.getState().applyEvent({ type: 'messages', threadId: 'ses_one' }))
  }

  it('hides the messages from the revert on, says what it restored, and shows them again once it is gone', async () => {
    page = {
      running: false,
      older: null,
      messages: conversation,
      revert: {
        messageId: 'msg_3',
        files: [
          { path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1 },
          { path: 'b.txt', status: 'deleted', additions: 0, deletions: 1 },
        ],
      },
    }
    const view = await render()
    await vi.waitFor(() => expect(view.textContent).toContain('First answer'))
    expect(view.textContent).not.toContain('Second request')
    expect(view.textContent).not.toContain('Second answer')
    expect(view.querySelector('[data-testid="chat-revert-summary"]')?.textContent).toBe('1 message reverted · 2 files restored')
    const files = view.querySelector('[data-testid="chat-revert-files"]')!.textContent!
    expect(files).toContain('Restoredsrc/a.ts+2−1')
    expect(files).toContain('Removedb.txt−1')
    expect(view.querySelector('[data-testid="chat-revert"]')?.textContent).toContain('Sending a message now removes the reverted messages for good.')

    // A reply that does not say whether a revert is staged leaves things as they are.
    page = { running: false, older: null, messages: conversation }
    await refetch()
    await vi.waitFor(() => expect(api.chat.messages).toHaveBeenCalledTimes(2))
    expect(view.querySelector('[data-testid="chat-revert"]')).not.toBeNull()
    expect(view.textContent).not.toContain('Second request')

    // Redone: the messages were never dropped, so they are back with the next read.
    page = { running: false, older: null, messages: conversation, revert: null }
    await refetch()
    await vi.waitFor(() => expect(view.textContent).toContain('Second answer'))
    expect(view.textContent).toContain('Second request')
    expect(view.querySelector('[data-testid="chat-revert"]')).toBeNull()
  })

  it('shows the banner alone when the revert reaches the start, and names a partial reply honestly', async () => {
    page = { running: false, older: null, messages: conversation, revert: { messageId: 'msg_1', files: [] } }
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-revert"]')).not.toBeNull())
    expect(view.textContent).not.toContain('First request')
    expect(view.textContent).not.toContain('No messages yet.')
    expect(view.querySelector('[data-testid="chat-revert-summary"]')?.textContent).toBe('2 messages reverted')
    // No files, so there is nothing to fold open.
    expect(view.querySelector('[data-testid="chat-revert-files"]')).toBeNull()

    page = { running: false, older: null, messages: conversation, revert: { messageId: 'msg_4', files: [] } }
    await refetch()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-revert-summary"]')?.textContent).toBe('The conversation reverted'))
    expect(view.textContent).toContain('Second request')
    expect(view.textContent).not.toContain('Second answer')
  })

  it('folds a long file list and counts the files it leaves out', async () => {
    const files = Array.from({ length: 24 }, (_, index) => ({ path: `src/f${index}.ts`, status: 'modified' as const, additions: 1, deletions: 0 }))
    page = { running: false, older: null, messages: conversation, revert: { messageId: 'msg_3', files } }
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-revert"]')).not.toBeNull())
    expect(view.querySelector('[data-testid="chat-revert-files"]')).toBeNull()
    await act(async () => button(view, 'Show files').click())
    expect(view.querySelectorAll('[data-testid="chat-revert-files"] li')).toHaveLength(21)
    expect(view.querySelector('[data-testid="chat-revert-files"]')?.textContent).toContain('and 4 more')
  })

  it('redoes the revert from the note: the messages come back at once and the note goes', async () => {
    const reverted = { messageId: 'msg_3', files: [{ path: 'src/a.ts', status: 'modified' as const, additions: 2, deletions: 1 }] }
    page = { running: false, older: null, messages: conversation, revert: reverted }
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-revert"]')).not.toBeNull())
    expect(view.textContent).not.toContain('Second request')
    // After the redo OpenCode reports no revert, which the next refetch confirms.
    page = { running: false, older: null, messages: conversation, revert: null }
    await act(async () => button(view, 'Redo').click())
    expect(api.chat.redo).toHaveBeenCalledTimes(1)
    expect(api.chat.redo).toHaveBeenCalledWith({ threadId: 'ses_one' })
    expect(view.querySelector('[data-testid="chat-revert"]')).toBeNull()
    expect(view.textContent).toContain('Second request')
    expect(view.textContent).toContain('Second answer')
    await vi.waitFor(() => expect(api.chat.messages).toHaveBeenCalledTimes(2))
    expect(view.querySelector('[data-testid="chat-revert"]')).toBeNull()
  })

  it('keeps the note and the hidden messages when a redo fails, and lets you try again', async () => {
    page = { running: false, older: null, messages: conversation, revert: { messageId: 'msg_3', files: [] } }
    api.chat.redo.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:redo': Error: OpenCode is still working on this thread. Stop it, then redo."))
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-revert"]')).not.toBeNull())
    await act(async () => button(view, 'Redo').click())
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-revert"] [role="alert"]')?.textContent)
      .toBe('OpenCode is still working on this thread. Stop it, then redo.'))
    expect(view.textContent).not.toContain('Second request')
    expect(button(view, 'Redo').disabled).toBe(false)

    page = { running: false, older: null, messages: conversation, revert: null }
    await act(async () => button(view, 'Redo').click())
    expect(api.chat.redo).toHaveBeenCalledTimes(2)
    expect(view.querySelector('[data-testid="chat-revert"]')).toBeNull()
    expect(view.textContent).toContain('Second request')
  })

  it('shows that it is redoing and ignores a second click meanwhile', async () => {
    page = { running: false, older: null, messages: conversation, revert: { messageId: 'msg_3', files: [] } }
    let finish!: () => void
    api.chat.redo.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-revert"]')).not.toBeNull())
    await act(async () => button(view, 'Redo').click())
    const pending = button(view, 'Redoing…')
    expect(pending.disabled).toBe(true)
    await act(async () => pending.click())
    expect(api.chat.redo).toHaveBeenCalledTimes(1)
    expect(view.textContent).not.toContain('Second request')
    page = { running: false, older: null, messages: conversation, revert: null }
    await act(async () => finish())
    expect(view.querySelector('[data-testid="chat-revert"]')).toBeNull()
    expect(view.textContent).toContain('Second request')
  })

  it('loads earlier pages until a message before the revert is in view, once per page', async () => {
    const newest: ChatMessagesPage = {
      running: false,
      older: 'cursor-1',
      messages: [user('msg_5', 'Third request'), reply('msg_6', 'Third answer')],
      revert: { messageId: 'msg_5', files: [] },
    }
    const earlier: ChatMessagesPage = { running: false, older: null, messages: conversation }
    api.chat.messages.mockImplementation(async (request?: { cursor?: string }) => (request?.cursor ? earlier : newest))
    try {
      const view = await render()
      await vi.waitFor(() => expect(view.textContent).toContain('Second answer'))
      expect(view.textContent).not.toContain('Third request')
      expect(view.querySelector('[data-testid="chat-revert-summary"]')?.textContent).toBe('1 message reverted')
      const older = pageRequestsWithCursor()
      expect(older).toEqual([[{ threadId: 'ses_one', cursor: 'cursor-1' }]])
    } finally {
      api.chat.messages.mockImplementation(async () => page)
    }
  })

  it('stops loading when an earlier page fails, instead of asking again and again', async () => {
    const newest: ChatMessagesPage = {
      running: false,
      older: 'cursor-1',
      messages: [user('msg_5', 'Third request')],
      revert: { messageId: 'msg_5', files: [] },
    }
    api.chat.messages.mockImplementation(async (request?: { cursor?: string }) => {
      if (request?.cursor) throw new Error('Earlier page unavailable')
      return newest
    })
    try {
      const view = await render()
      await vi.waitFor(() => expect(view.querySelector('[role="alert"]')?.textContent).toContain('Earlier page unavailable'))
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
      const older = pageRequestsWithCursor()
      expect(older).toHaveLength(1)
    } finally {
      api.chat.messages.mockImplementation(async () => page)
    }
  })

  describe('reverting to a message', () => {
    const open = async (view: HTMLElement, id: string): Promise<HTMLElement> => {
      await act(async () => (view.querySelector(`[data-testid="chat-revert-to-${id}"]`) as HTMLButtonElement).click())
      // The dialog is in a portal.
      return document.body.querySelector('[data-testid="chat-revert-dialog"]') as HTMLElement
    }
    const dialogButton = (dialog: HTMLElement, label: string): HTMLButtonElement => button(dialog, label)
    const withPicture = (id: string, text: string, size: number): ChatMessage => ({
      kind: 'user', id, time: 1, text, attachments: [{ id: 'att_1', name: 'shot.png', mime: 'image/png', size }],
    })
    const checkbox = (dialog: HTMLElement): HTMLInputElement => dialog.querySelector('input[type="checkbox"]') as HTMLInputElement
    const showConversation = async (): Promise<HTMLElement> => {
      page = { running: false, older: null, messages: conversation }
      const view = await render()
      await vi.waitFor(() => expect(view.textContent).toContain('Second answer'))
      return view
    }

    it('offers the revert on the user\'s own messages only', async () => {
      const view = await showConversation()
      expect(view.querySelector('[data-testid="chat-revert-to-msg_1"]')).not.toBeNull()
      expect(view.querySelector('[data-testid="chat-revert-to-msg_3"]')?.getAttribute('aria-label')).toBe('Revert to before this message')
      expect(view.querySelector('[data-testid="chat-revert-to-msg_2"]')).toBeNull()
      expect(view.querySelector('[data-testid="chat-revert-to-msg_4"]')).toBeNull()
      expect(document.body.querySelector('[data-testid="chat-revert-dialog"]')).toBeNull()
    })

    it('asks first: shows the message, how much goes, and restoring files as the default', async () => {
      const view = await showConversation()
      const dialog = await open(view, 'msg_1')
      expect(dialog.textContent).toContain('Revert to before this message?')
      expect(dialog.querySelector('[data-testid="chat-revert-quote"]')?.textContent).toBe('First request')
      expect(dialog.textContent).toContain('These 2 messages and the agent\'s replies will be hidden')
      expect(checkbox(dialog).checked).toBe(true)
      expect(dialog.textContent).toContain('You can redo this until you send a message.')
      // Nothing is said about work in progress or attachments when there is none.
      expect(dialog.textContent).not.toContain('still working')
      expect(dialog.textContent).not.toContain('Attachments on this message')

      await act(async () => dialogButton(dialog, 'Cancel').click())
      expect(document.body.querySelector('[data-testid="chat-revert-dialog"]')).toBeNull()
      expect(api.chat.revert).not.toHaveBeenCalled()
      const single = await open(view, 'msg_3')
      expect(single.textContent).toContain('This message and the agent\'s replies will be hidden')
      expect(single.querySelector('[data-testid="chat-revert-quote"]')?.textContent).toBe('Second request')
    })

    it('reverts, hides the messages, and puts the text in the box above what is there', async () => {
      const draft = draftStore('Something half written')
      api.chat.revert.mockResolvedValueOnce({ messageId: 'msg_3', files: [{ path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1 }] })
      const view = await showConversation()
      const textarea = view.querySelector('textarea') as HTMLTextAreaElement
      await vi.waitFor(() => expect(textarea.value).toBe('Something half written'))

      const dialog = await open(view, 'msg_3')
      await act(async () => dialogButton(dialog, 'Revert').click())
      expect(api.chat.revert).toHaveBeenCalledTimes(1)
      expect(api.chat.revert).toHaveBeenCalledWith({ threadId: 'ses_one', messageId: 'msg_3' })
      expect(api.chat.draft).toHaveBeenCalledWith({ key: 'thread:ses_one', action: 'prepend', text: 'Second request' })
      expect(document.body.querySelector('[data-testid="chat-revert-dialog"]')).toBeNull()

      expect(view.textContent).toContain('First answer')
      expect(view.textContent).not.toContain('Second answer')
      expect(view.querySelector('[data-testid="chat-revert-summary"]')?.textContent).toBe('1 message reverted · 1 file restored')
      await vi.waitFor(() => expect(textarea.value).toBe('Second request\n\nSomething half written'))
      expect(draft.saved()).toBe('Second request\n\nSomething half written')
      // Ready for changes: focused, with the caret at the end of the restored text.
      await vi.waitFor(() => expect(document.activeElement).toBe(textarea))
      expect(textarea.selectionStart).toBe('Second request'.length)
      expect(textarea.selectionEnd).toBe('Second request'.length)
      expect(view.querySelector('[data-testid="chat-notice"]')).toBeNull()
    })

    it('leaves the files alone when the box is unticked', async () => {
      draftStore('')
      const view = await showConversation()
      const dialog = await open(view, 'msg_1')
      await act(async () => checkbox(dialog).click())
      expect(checkbox(dialog).checked).toBe(false)
      await act(async () => dialogButton(dialog, 'Revert').click())
      expect(api.chat.revert).toHaveBeenCalledWith({ threadId: 'ses_one', messageId: 'msg_1', files: false })
      await vi.waitFor(() => expect((view.querySelector('textarea') as HTMLTextAreaElement).value).toBe('First request'))
      // The revert reached the start, so only the note is left of the conversation.
      expect(view.textContent).not.toContain('First answer')
    })

    it('keeps the dialog open with the reason when the revert fails, and does not touch the box', async () => {
      const draft = draftStore('Keep me')
      api.chat.revert.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:revert': Error: OpenCode is still stopping this thread. Try again in a moment."))
      const view = await showConversation()
      const dialog = await open(view, 'msg_3')
      await act(async () => dialogButton(dialog, 'Revert').click())
      await vi.waitFor(() => expect(dialog.querySelector('[role="alert"]')?.textContent)
        .toBe('OpenCode is still stopping this thread. Try again in a moment.'))
      expect(document.body.querySelector('[data-testid="chat-revert-dialog"]')).toBe(dialog)
      expect(api.chat.draft).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'prepend' }))
      expect(draft.saved()).toBe('Keep me')
      expect(view.textContent).toContain('Second answer')
      expect(view.querySelector('[data-testid="chat-revert"]')).toBeNull()

      // Asking again works, and the error is gone while it does.
      await act(async () => dialogButton(dialog, 'Revert').click())
      expect(api.chat.revert).toHaveBeenCalledTimes(2)
      expect(document.body.querySelector('[data-testid="chat-revert-dialog"]')).toBeNull()
      expect(view.textContent).not.toContain('Second answer')
    })

    it('ignores a second click while the revert is under way', async () => {
      draftStore('')
      let finish!: (value: ChatRevert) => void
      api.chat.revert.mockImplementationOnce(() => new Promise<ChatRevert>((resolve) => { finish = resolve }))
      const view = await showConversation()
      const dialog = await open(view, 'msg_3')
      await act(async () => dialogButton(dialog, 'Revert').click())
      expect(dialogButton(dialog, 'Revert').disabled).toBe(true)
      expect(dialogButton(dialog, 'Cancel').disabled).toBe(true)
      expect(checkbox(dialog).disabled).toBe(true)
      await act(async () => dialogButton(dialog, 'Revert').click())
      expect(api.chat.revert).toHaveBeenCalledTimes(1)
      await act(async () => finish({ messageId: 'msg_3', files: [] }))
      expect(document.body.querySelector('[data-testid="chat-revert-dialog"]')).toBeNull()
    })

    it('says that a working agent is stopped first, and that attachments are not put back', async () => {
      page = {
        running: true,
        older: null,
        messages: [withPicture('msg_1', 'See picture', 2048), reply('msg_2', 'Looking')],
      }
      const view = await render()
      await vi.waitFor(() => expect(view.textContent).toContain('Looking'))
      const dialog = await open(view, 'msg_1')
      expect(dialog.textContent).toContain('The agent is still working and will be stopped first.')
      expect(dialog.textContent).toContain('Attachments on this message are not put back.')
    })

    it('says so when the message could not be put back in the box, though the conversation is reverted', async () => {
      draftStore('')
      api.chat.draft.mockImplementation((async (request: ChatDraftRequest): Promise<ChatDraft> => {
        if (request.action === 'prepend') throw new Error("Error invoking remote method 'chat:draft': Error: The text is too long to add to this draft.")
        return { text: '', revision: 1, attachments: [] }
      }) as never)
      const view = await showConversation()
      const dialog = await open(view, 'msg_3')
      await act(async () => dialogButton(dialog, 'Revert').click())
      expect(document.body.querySelector('[data-testid="chat-revert-dialog"]')).toBeNull()
      expect(view.querySelector('[data-testid="chat-revert"]')).not.toBeNull()
      expect(view.textContent).not.toContain('Second answer')
      expect(view.querySelector('[data-testid="chat-notice"]')?.textContent)
        .toBe('The conversation was reverted, but the message could not be put back in the box: The text is too long to add to this draft.')
      expect((view.querySelector('textarea') as HTMLTextAreaElement).value).toBe('')

      // Redoing clears the notice along with the note.
      await act(async () => button(view, 'Redo').click())
      expect(view.querySelector('[data-testid="chat-notice"]')).toBeNull()
    })

    it('puts nothing in the box for a message without text', async () => {
      draftStore('')
      page = { running: false, older: null, messages: [withPicture('msg_1', '', 10), reply('msg_2', 'Seen')] }
      const view = await render()
      await vi.waitFor(() => expect(view.textContent).toContain('Seen'))
      const dialog = await open(view, 'msg_1')
      expect(dialog.querySelector('[data-testid="chat-revert-quote"]')?.textContent).toBe('A message without text')
      await act(async () => dialogButton(dialog, 'Revert').click())
      expect(api.chat.revert).toHaveBeenCalledTimes(1)
      expect(api.chat.draft).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'prepend' }))
      expect(view.querySelector('[data-testid="chat-notice"]')).toBeNull()
    })

    it('closes the question when another thread is opened', async () => {
      useWorkspace.setState({ inboxThreads: [thread(), thread({ id: 'ses_two', title: 'Other' })] })
      const view = await showConversation()
      await open(view, 'msg_3')
      expect(document.body.querySelector('[data-testid="chat-revert-dialog"]')).not.toBeNull()
      await act(async () => useWorkspace.setState({ selectedInboxThreadId: 'ses_two' }))
      expect(document.body.querySelector('[data-testid="chat-revert-dialog"]')).toBeNull()
      expect(api.chat.revert).not.toHaveBeenCalled()
    })
  })
})


describe('Inbox fork from a message', () => {
  beforeEach(() => {
    useWorkspace.setState({ inboxThreads: [thread()], selectedInboxThreadId: 'ses_one' })
  })

  const user = (id: string, text: string): ChatMessage => ({ kind: 'user', id, time: 1, text })
  const reply = (id: string, text: string): ChatMessage => ({
    kind: 'assistant', id, time: 2, agent: 'build', model: options.defaultModel!, completed: true, parts: [{ kind: 'text', text }],
  })
  const conversation = [user('msg_1', 'First request'), reply('msg_2', 'First answer'), user('msg_3', 'Second request'), reply('msg_4', 'Second answer')]
  const showConversation = async (): Promise<HTMLElement> => {
    page = { running: false, older: null, messages: conversation }
    const view = await render()
    await vi.waitFor(() => expect(view.textContent).toContain('Second answer'))
    return view
  }
  const forkButton = (view: HTMLElement, id: string): HTMLButtonElement | null =>
    view.querySelector(`[data-testid="chat-fork-from-${id}"]`)

  it('offers the fork beside the revert on the user\'s own messages only', async () => {
    const view = await showConversation()
    for (const id of ['msg_1', 'msg_3']) {
      expect(forkButton(view, id)?.getAttribute('aria-label')).toBe('Fork from before this message')
      expect(forkButton(view, id)?.getAttribute('title')).toBe('Fork from here')
      const revert = view.querySelector(`[data-testid="chat-revert-to-${id}"]`)!
      expect(revert).not.toBeNull()
      expect(forkButton(view, id)!.parentElement).toBe(revert.parentElement)
    }
    expect(forkButton(view, 'msg_2')).toBeNull()
    expect(forkButton(view, 'msg_4')).toBeNull()
  })

  it('forks from before the message at once, opens the new thread and puts the message in its box', async () => {
    const draft = draftStore('')
    const view = await showConversation()
    await act(async () => forkButton(view, 'msg_3')!.click())
    // Nothing is deleted, so there is nothing to ask.
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(api.chat.fork).toHaveBeenCalledTimes(1)
    expect(api.chat.fork).toHaveBeenCalledWith({ threadId: 'ses_one', messageId: 'msg_3' })
    expect(api.chat.draft).toHaveBeenCalledWith({ key: 'thread:ses_fork', action: 'prepend', text: 'Second request' })
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_fork')
    expect(useWorkspace.getState().inboxThreads.map((item) => item.id).sort()).toEqual(['ses_fork', 'ses_one'])
    await vi.waitFor(() => expect(api.chat.subscribe).toHaveBeenCalledWith({ threadId: 'ses_fork' }))

    const textarea = view.querySelector('textarea') as HTMLTextAreaElement
    await vi.waitFor(() => expect(textarea.value).toBe('Second request'))
    expect(draft.saved('thread:ses_fork')).toBe('Second request')
    // Ready for changes: focused, with the caret after the restored text.
    await vi.waitFor(() => expect(document.activeElement).toBe(textarea))
    expect(textarea.selectionStart).toBe('Second request'.length)
    expect(textarea.selectionEnd).toBe('Second request'.length)
    // The box took the instruction, so a thread opened later is not told again.
    expect(useInboxChat.getState().draftReloads.ses_fork).toBeUndefined()
    expect(view.querySelector('[data-testid="chat-notice"]')).toBeNull()
    expect(view.querySelector('[data-testid="chat-fork-error"]')).toBeNull()
  })

  it('leaves the original thread as it was', async () => {
    draftStore('Half written follow-up')
    const view = await showConversation()
    await vi.waitFor(() => expect((view.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Half written follow-up'))
    await act(async () => forkButton(view, 'msg_1')!.click())
    expect(api.chat.draft).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'thread:ses_one', action: 'prepend' }))
    expect(api.chat.revert).not.toHaveBeenCalled()
    expect(api.chat.interrupt).not.toHaveBeenCalled()
    // Back in the original, its messages are all there and its box still holds what was typed.
    await act(async () => useWorkspace.getState().selectInboxThread('ses_one'))
    await vi.waitFor(() => expect(view.textContent).toContain('Second answer'))
    expect(view.querySelector('[data-testid="chat-revert"]')).toBeNull()
    await vi.waitFor(() => expect((view.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Half written follow-up'))
  })

  it('opens the fork without touching its box for a message that has no text', async () => {
    draftStore('')
    page = { running: false, older: null, messages: [{ kind: 'user', id: 'msg_1', time: 1, text: '', attachments: [{ id: 'att_1', name: 'shot.png', mime: 'image/png', size: 10 }] }, reply('msg_2', 'Seen')] }
    const view = await render()
    await vi.waitFor(() => expect(view.textContent).toContain('Seen'))
    await act(async () => forkButton(view, 'msg_1')!.click())
    expect(api.chat.fork).toHaveBeenCalledWith({ threadId: 'ses_one', messageId: 'msg_1' })
    expect(api.chat.draft).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'prepend' }))
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_fork')
  })

  it('shows that it is forking and ignores a second click meanwhile', async () => {
    draftStore('')
    let finish!: (result: ChatForkResult) => void
    api.chat.fork.mockImplementationOnce(() => new Promise<ChatForkResult>((resolve) => { finish = resolve }))
    const view = await showConversation()
    await act(async () => forkButton(view, 'msg_3')!.click())
    expect(view.querySelector('[data-testid="chat-fork-status"]')?.textContent).toContain('Forking thread…')
    await act(async () => forkButton(view, 'msg_1')!.click())
    expect(api.chat.fork).toHaveBeenCalledTimes(1)
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_one')
    await act(async () => finish({ thread: forkedThread() }))
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_fork')
    expect(view.querySelector('[data-testid="chat-fork-status"]')).toBeNull()
  })

  it('says why the fork failed, stays in the thread, and clears the message when tried again', async () => {
    draftStore('')
    api.chat.fork.mockRejectedValueOnce(new Error("Error invoking remote method 'chat:fork': Error: That message is no longer in the conversation."))
    const view = await showConversation()
    await act(async () => forkButton(view, 'msg_3')!.click())
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-fork-error"]')?.textContent).toBe('That message is no longer in the conversation.'))
    expect(view.querySelector('[data-testid="chat-fork-status"]')).toBeNull()
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_one')
    expect(useWorkspace.getState().inboxThreads.map((item) => item.id)).toEqual(['ses_one'])
    expect(api.chat.draft).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'prepend' }))
    expect(view.textContent).toContain('Second answer')

    await act(async () => forkButton(view, 'msg_3')!.click())
    expect(api.chat.fork).toHaveBeenCalledTimes(2)
    expect(view.querySelector('[data-testid="chat-fork-error"]')).toBeNull()
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_fork')
  })

  it('opens the fork and says so when the message could not be put in its box', async () => {
    draftStore('')
    api.chat.draft.mockImplementation((async (request: ChatDraftRequest): Promise<ChatDraft> => {
      if (request.action === 'prepend') throw new Error("Error invoking remote method 'chat:draft': Error: The text is too long to add to this draft.")
      return { text: '', revision: 1, attachments: [] }
    }) as never)
    const view = await showConversation()
    await act(async () => forkButton(view, 'msg_3')!.click())
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_fork')
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-notice"]')?.textContent)
      .toBe('The thread was forked, but the message could not be put in its box: The text is too long to add to this draft.'))
    expect((view.querySelector('textarea') as HTMLTextAreaElement).value).toBe('')
  })

  it('forks from a message that a revert leaves visible, and offers nothing on the ones it hides', async () => {
    draftStore('')
    page = { running: false, older: null, messages: conversation, revert: { messageId: 'msg_3', files: [] } }
    const view = await render()
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-revert"]')).not.toBeNull())
    expect(forkButton(view, 'msg_3')).toBeNull()
    await act(async () => forkButton(view, 'msg_1')!.click())
    expect(api.chat.fork).toHaveBeenCalledWith({ threadId: 'ses_one', messageId: 'msg_1' })
  })
})


describe('Inbox draft reload', () => {
  beforeEach(() => {
    useWorkspace.setState({ inboxThreads: [thread()], selectedInboxThreadId: 'ses_one' })
    useInboxChat.setState({ draftReloads: {} })
  })

  it('takes a reload that was set before the box appeared, then lets go of it', async () => {
    draftStore('Added text and the rest')
    useInboxChat.setState({ draftReloads: { ses_one: { id: 4, caret: 10 } } })
    const view = await render()
    const textarea = view.querySelector('textarea') as HTMLTextAreaElement
    await vi.waitFor(() => expect(textarea.value).toBe('Added text and the rest'))
    await vi.waitFor(() => expect(document.activeElement).toBe(textarea))
    expect(textarea.selectionStart).toBe(10)
    expect(useInboxChat.getState().draftReloads.ses_one).toBeUndefined()
  })

  it('waits for the box to switch on before taking focus, however slowly the draft loads', async () => {
    draftStore('Existing text')
    // The first read, which the box needs before it can be used, is the slow one.
    const answer = api.chat.draft.getMockImplementation()! as unknown as (request: ChatDraftRequest) => Promise<ChatDraft>
    let loads = 0
    api.chat.draft.mockImplementation((async (request: ChatDraftRequest) => {
      if (request.action === 'load' && loads++ === 0) await new Promise((resolve) => setTimeout(resolve, 120))
      return answer(request)
    }) as never)
    useInboxChat.setState({ draftReloads: { ses_one: { id: 1, caret: 4 } } })
    const view = await render()
    const textarea = view.querySelector('textarea') as HTMLTextAreaElement
    // Until then the box is switched off, and a box that is off cannot take focus.
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(textarea.disabled).toBe(true)
    expect(document.activeElement).not.toBe(textarea)
    await vi.waitFor(() => expect(document.activeElement).toBe(textarea))
    expect(textarea.disabled).toBe(false)
    expect(textarea.value).toBe('Existing text')
    expect(textarea.selectionStart).toBe(4)
  })

  it('takes the next reload as well, even when it has the number the last one had', async () => {
    draftStore('Hello world')
    const view = await render()
    const textarea = view.querySelector('textarea') as HTMLTextAreaElement
    await vi.waitFor(() => expect(textarea.value).toBe('Hello world'))
    for (const caret of [5, 2]) {
      textarea.blur()
      expect(document.activeElement).not.toBe(textarea)
      await act(async () => useInboxChat.setState({ draftReloads: { ses_one: { id: 1, caret } } }))
      await vi.waitFor(() => expect(document.activeElement).toBe(textarea))
      expect(textarea.selectionStart).toBe(caret)
      expect(useInboxChat.getState().draftReloads.ses_one).toBeUndefined()
    }
  })

  it('does not let go of a newer reload than the one that was taken', () => {
    useInboxChat.setState({ draftReloads: { ses_one: { id: 2, caret: 4 }, ses_two: { id: 1, caret: 0 } } })
    useInboxChat.getState().clearDraftReload('ses_one', 1)
    expect(useInboxChat.getState().draftReloads.ses_one).toEqual({ id: 2, caret: 4 })
    useInboxChat.getState().clearDraftReload('ses_one', 2)
    expect(useInboxChat.getState().draftReloads).toEqual({ ses_two: { id: 1, caret: 0 } })
    useInboxChat.getState().clearDraftReload('ses_three', 1)
    expect(useInboxChat.getState().draftReloads).toEqual({ ses_two: { id: 1, caret: 0 } })
  })
})
