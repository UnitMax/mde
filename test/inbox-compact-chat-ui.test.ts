// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/renderer/components/inbox/InboxTerminal', () => ({
  // The real one draws xterm.js, which needs a real browser.
  InboxTerminal: () => createElement('div'),
  focusInboxTerminalWhenShown: vi.fn(),
}))
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { getInboxCompactChat, INBOX_COMPACT_CHAT_STORAGE_KEY, saveInboxCompactChat } from '../src/renderer/lib/inbox-settings'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useInboxView } from '../src/renderer/store/inbox-view'
import { useWorkspace } from '../src/renderer/store/workspace'
import type { ChatMessage, ChatMessagesPage, ChatPart, InboxThread } from '../src/shared/types'

const MODEL = { id: 'free-1', providerId: 'opencode' }
const TOGGLE = '[data-testid="chat-compact-toggle"]'

function thread(overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id: 'ses_one', title: 'Fix login', directory: '/home/me/app', target: { kind: 'native' }, branch: null, model: MODEL,
    status: 'completed', createdAt: 1, lastActivityAt: Date.now() - 60_000, readAt: Date.now(), archived: false, folderId: 'fld_app',
    ...overrides,
  }
}

let counter = 0
const tool = (name: string, input: unknown, extra: Record<string, unknown> = {}): ChatPart =>
  ({ kind: 'tool', id: `call_${++counter}`, name, status: 'completed', input: JSON.stringify(input), ...extra }) as ChatPart
const shell = (command: string, extra: Record<string, unknown> = {}): ChatPart => tool('shell', { command }, { exitCode: 0, output: 'ok', ...extra })
const read = (name: string): ChatPart => tool('read', { path: `/home/me/app/${name}` }, { output: '1: x' })
const edit = (): ChatPart =>
  tool('edit', { filePath: '/home/me/app/a.ts', oldString: 'a', newString: 'b' }, { patches: [{ path: '/home/me/app/a.ts', patch: '@@ -1,2 +1,2 @@\n keep\n-old\n+new\n' }] })
const step = (id: string, parts: ChatPart[], completed = true): ChatMessage =>
  ({ kind: 'assistant', id, time: 2, agent: 'build', model: MODEL, parts, completed }) as ChatMessage
const prompt: ChatMessage = { kind: 'user', id: 'u1', time: 1, text: 'Fix the login redirect' } as ChatMessage

/** A turn of the agent as OpenCode writes it: a new step for every round of tool calls. */
const turn = (): ChatMessage[] => [
  prompt,
  step('a1', [{ kind: 'text', text: 'I will check the failing test.' }, shell('npm test'), shell('git status')]),
  step('a2', [{ kind: 'reasoning', text: 'The redirect is wrong.' }, read('login.ts')]),
  step('a3', [shell('npm test -- login')]),
  step('a4', [{ kind: 'text', text: 'All fixed.' }]),
]

let page: ChatMessagesPage
let root: Root
let container: HTMLDivElement
const api = {
  paths: { revealInbox: vi.fn(async () => undefined), openInboxInVsCode: vi.fn(async () => undefined) },
  inbox: { setRead: vi.fn(async () => null), changes: vi.fn(async () => ({ available: false })), folders: vi.fn(async () => ({ folders: [], composer: {} })) },
  chat: {
    draft: vi.fn(async () => ({ text: '', revision: 0, attachments: [] })),
    subscribe: vi.fn(async () => undefined),
    unsubscribe: vi.fn(async () => undefined),
    messages: vi.fn(async () => page),
    requests: vi.fn(async () => ({ permissions: [], forms: [] })),
    options: vi.fn(() => new Promise(() => {})),
  },
}

const q = (selector: string): HTMLElement | null => container.querySelector<HTMLElement>(selector)
const all = (selector: string): HTMLElement[] => Array.from(container.querySelectorAll<HTMLElement>(selector))
const text = (element: Element | null | undefined): string => (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
const click = (element: HTMLElement | null): Promise<void> => act(async () => element!.click())

async function render(): Promise<void> {
  await act(async () => root.render(createElement(InboxThreadView)))
  await vi.waitFor(() => expect(q('[data-testid="inbox-thread-view"]')).not.toBeNull())
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('api', api)
  try { localStorage.removeItem(INBOX_COMPACT_CHAT_STORAGE_KEY) } catch { /* the default is off */ }
  useInboxView.setState({ compactChat: false })
  page = { messages: turn(), older: null, running: false }
  useInboxChat.setState({ folders: [], composer: {}, foldersLoaded: true, options: {}, threads: {}, recent: [], titleRegenerations: {} })
  useWorkspace.setState({
    platform: { platform: 'darwin', isWindows: false },
    wslAvailable: false,
    inboxThreads: [thread()],
    selectedInboxThreadId: 'ses_one',
    activeWorkspaceView: 'inbox',
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('the compact mode switch', () => {
  it('is in the header of a conversation, off until it is turned on', async () => {
    await render()
    const toggle = q(`[data-testid="inbox-thread-view"] ${TOGGLE}`)!
    expect(toggle.getAttribute('aria-label')).toBe('Compact mode')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('is not offered for a thread that is a terminal', async () => {
    useWorkspace.setState({ inboxThreads: [thread({ mode: 'terminal' })] })
    await render()
    expect(q('[data-testid="inbox-thread-view"]')).not.toBeNull()
    expect(q(TOGGLE)).toBeNull()
  })

  it('turns on and off, and remembers what it was left at', async () => {
    await render()
    await click(q(TOGGLE))
    expect(q(TOGGLE)!.getAttribute('aria-pressed')).toBe('true')
    expect(useInboxView.getState().compactChat).toBe(true)
    expect(localStorage.getItem(INBOX_COMPACT_CHAT_STORAGE_KEY)).toBe('on')
    expect(getInboxCompactChat()).toBe(true)

    await click(q(TOGGLE))
    expect(q(TOGGLE)!.getAttribute('aria-pressed')).toBe('false')
    expect(localStorage.getItem(INBOX_COMPACT_CHAT_STORAGE_KEY)).toBe('off')
    expect(getInboxCompactChat()).toBe(false)
  })

  it('is off when nothing was saved, and when storage cannot be read', () => {
    expect(getInboxCompactChat()).toBe(false)
    saveInboxCompactChat(true)
    expect(getInboxCompactChat()).toBe(true)
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') } })
    expect(getInboxCompactChat()).toBe(false)
  })
})

describe('a conversation in compact mode', () => {
  it('shows every step as it always did until compact is turned on', async () => {
    await render()
    await vi.waitFor(() => expect(q('[data-testid="chat-message-a4"]')).not.toBeNull())
    // Each step has its own message, and two commands are two rows, not a group.
    for (const id of ['a1', 'a2', 'a3', 'a4']) expect(q(`[data-testid="chat-message-${id}"]`)).not.toBeNull()
    expect(all('[data-testid="chat-activity"]')).toHaveLength(0)
  })

  it('folds everything but the text into one line, across the steps of the turn', async () => {
    useInboxView.setState({ compactChat: true })
    await render()
    await vi.waitFor(() => expect(q('[data-testid="chat-message-a4"]')).not.toBeNull())

    // The agent's words stay as they are; the steps between them are one line.
    expect(text(q('[data-testid="chat-message-a1"]'))).toContain('I will check the failing test.')
    const groups = all('[data-testid="chat-activity"]')
    expect(groups).toHaveLength(1)
    expect(text(q('[data-testid="chat-activity-summary"]'))).toBe('Thought, read 1 file and ran 3 commands')
    expect(groups[0]!.querySelector('button')!.getAttribute('aria-expanded')).toBe('false')
    expect(all('[data-testid^="chat-tool-"]')).toHaveLength(0)
    expect(q('[data-testid="chat-reasoning"]')).toBeNull()
    // The steps that only did work have nothing left to draw.
    expect(q('[data-testid="chat-message-a2"]')).toBeNull()
    expect(q('[data-testid="chat-message-a3"]')).toBeNull()
    expect(text(q('[data-testid="chat-message-a4"]'))).toBe('All fixed.')

    // Opening the line shows every step, from all the messages that did them.
    await click(groups[0]!.querySelector('button'))
    expect(all('[data-testid^="chat-tool-"]')).toHaveLength(4)
    expect(q('[data-testid="chat-reasoning"]')).not.toBeNull()
  })

  it('puts the steps back when compact is turned off, and folds them again when it is turned on', async () => {
    useInboxView.setState({ compactChat: true })
    await render()
    await vi.waitFor(() => expect(q('[data-testid="chat-message-a4"]')).not.toBeNull())
    expect(all('[data-testid="chat-activity"]')).toHaveLength(1)

    await click(q(TOGGLE))
    expect(all('[data-testid="chat-activity"]')).toHaveLength(0)
    for (const id of ['a1', 'a2', 'a3']) expect(q(`[data-testid="chat-message-${id}"]`)).not.toBeNull()

    await click(q(TOGGLE))
    expect(all('[data-testid="chat-activity"]')).toHaveLength(1)
    expect(q('[data-testid="chat-message-a2"]')).toBeNull()
  })

  it('starts a file change shut, as a line with its counts, and opens it when asked', async () => {
    page = { messages: [prompt, step('a1', [{ kind: 'text', text: 'Fixing it.' }, edit()]), step('a2', [{ kind: 'text', text: 'Done.' }])], older: null, running: false }
    useInboxView.setState({ compactChat: true })
    await render()
    await vi.waitFor(() => expect(q('[data-testid="chat-diff"]')).not.toBeNull())
    const row = q('[data-testid="chat-diff"]')!
    expect(row.querySelector('button')!.getAttribute('aria-expanded')).toBe('false')
    expect(text(q('[data-testid="chat-diff-stats"]'))).toBe('+1−1')
    expect(all('.file-diff-row')).toHaveLength(0)

    await click(row.querySelector('button'))
    expect(all('.file-diff-row')).toHaveLength(3)

    // Not compact, it is open as it always was; and what was chosen by hand stays.
    await click(q(TOGGLE))
    expect(all('.file-diff-row')).toHaveLength(3)
  })

  it('opens a file change in a conversation that is not compact', async () => {
    page = { messages: [prompt, step('a1', [edit()])], older: null, running: false }
    await render()
    await vi.waitFor(() => expect(q('[data-testid="chat-diff"]')).not.toBeNull())
    expect(q('[data-testid="chat-diff"] button')!.getAttribute('aria-expanded')).toBe('true')
    expect(all('.file-diff-row')).toHaveLength(3)
  })

  it('shows the work in progress as one shut line that spins, not as the rows of each step', async () => {
    page = {
      messages: [prompt, step('a1', [shell('npm test')]), step('a2', [shell('npm run build', { status: 'running', exitCode: undefined, output: undefined })], false)],
      older: null,
      running: true,
    }
    useWorkspace.setState({ inboxThreads: [thread({ status: 'working' })] })
    useInboxView.setState({ compactChat: true })
    await render()
    await vi.waitFor(() => expect(q('[data-testid="chat-activity"]')).not.toBeNull())
    const group = q('[data-testid="chat-activity"]')!
    expect(group.hasAttribute('data-live')).toBe(true)
    expect(text(q('[data-testid="chat-activity-summary"]'))).toBe('Running 2 commands')
    expect(group.querySelector('button')!.getAttribute('aria-expanded')).toBe('false')
    expect(all('[data-testid^="chat-tool-"]')).toHaveLength(0)
  })

  it('keeps a failure in sight on the shut line', async () => {
    page = { messages: [prompt, step('a1', [shell('npm test', { exitCode: 1 }), read('a.ts')]), step('a2', [{ kind: 'text', text: 'It failed.' }])], older: null, running: false }
    useInboxView.setState({ compactChat: true })
    await render()
    await vi.waitFor(() => expect(q('[data-testid="chat-activity"]')).not.toBeNull())
    expect(text(q('[data-testid="chat-activity"] button'))).toContain('1 failed')
  })

  it('still shows an error a step ended with, when that step has no activity of its own', async () => {
    page = { messages: [prompt, step('a1', [shell('npm test')]), { ...step('a2', [shell('npm run build')]), error: 'The provider closed the connection.' } as ChatMessage], older: null, running: false }
    useInboxView.setState({ compactChat: true })
    await render()
    await vi.waitFor(() => expect(q('[data-testid="chat-message-a2"]')).not.toBeNull())
    expect(text(q('[data-testid="chat-message-a2"]'))).toBe('The provider closed the connection.')
    expect(text(q('[data-testid="chat-activity-summary"]'))).toBe('Ran 2 commands')
  })
})
