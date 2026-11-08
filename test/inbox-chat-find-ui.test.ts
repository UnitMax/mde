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
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useInboxView } from '../src/renderer/store/inbox-view'
import { useWorkspace } from '../src/renderer/store/workspace'
import type { ChatMessage, ChatMessagesPage, ChatPart, ChatRequests, InboxThread } from '../src/shared/types'

const MODEL = { id: 'free-1', providerId: 'opencode' }

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
const step = (id: string, parts: ChatPart[], completed = true): ChatMessage =>
  ({ kind: 'assistant', id, time: 2, agent: 'build', model: MODEL, parts, completed }) as ChatMessage
const prompt: ChatMessage = { kind: 'user', id: 'u1', time: 1, text: 'Fix the login redirect' } as ChatMessage

/** A turn of the agent as OpenCode writes it: a new step for every round of tool calls. */
const turn = (): ChatMessage[] => [
  prompt,
  step('a2', [{ kind: 'reasoning', text: 'The redirect is wrong.' }, read('login.ts')]),
  step('a3', [shell('npm test -- login')]),
  step('a4', [{ kind: 'text', text: 'All fixed, the redirect works.' }]),
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
    requests: vi.fn(async (): Promise<ChatRequests> => ({ permissions: [], forms: [] })),
    options: vi.fn(() => new Promise(() => {})),
  },
}

const q = (selector: string): HTMLElement | null => container.querySelector<HTMLElement>(selector)
const text = (element: Element | null | undefined): string => (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
const click = (element: HTMLElement | null): Promise<void> => act(async () => element!.click())

async function render(): Promise<void> {
  await act(async () => root.render(createElement(InboxThreadView)))
  await vi.waitFor(() => expect(q('[data-testid="inbox-thread-view"]')).not.toBeNull())
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('api', api)
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


const input = (): HTMLInputElement | null => q('[data-testid="chat-find-input"]') as HTMLInputElement | null
const status = (): string => text(q('[data-testid="chat-find-status"]'))
const press = (init: KeyboardEventInit, target: EventTarget = document.body): Promise<void> =>
  act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })) })
const type = (value: string): Promise<void> =>
  act(async () => {
    const field = input()!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })

// What the painting would have been told, since the browser's highlight registry is not in the test environment.
const painted = new Map<string, string[]>()

beforeEach(() => {
  painted.clear()
  class FakeHighlight {
    ranges: Range[]
    constructor(...ranges: Range[]) { this.ranges = ranges }
  }
  vi.stubGlobal('Highlight', FakeHighlight)
  vi.stubGlobal('CSS', {
    highlights: {
      set: (name: string, highlight: FakeHighlight) => painted.set(name, highlight.ranges.map((range) => range.toString())),
      delete: (name: string) => painted.delete(name),
    },
  })
})

describe('find in a conversation', () => {
  it('opens with Ctrl+F from the page and takes the focus', async () => {
    await render()
    expect(q('[data-testid="chat-find"]')).toBeNull()
    await press({ key: 'f', ctrlKey: true })
    expect(q('[data-testid="chat-find"]')).not.toBeNull()
    expect(document.activeElement).toBe(input())
  })

  it('opens with Cmd+F too, and leaves other letters and a held Shift alone', async () => {
    await render()
    await press({ key: 'g', ctrlKey: true })
    await press({ key: 'f', ctrlKey: true, shiftKey: true })
    expect(q('[data-testid="chat-find"]')).toBeNull()
    await press({ key: 'f', metaKey: true })
    expect(q('[data-testid="chat-find"]')).not.toBeNull()
  })

  it('does not open from inside a dialog', async () => {
    await render()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)
    await press({ key: 'f', ctrlKey: true }, dialog)
    dialog.remove()
    expect(q('[data-testid="chat-find"]')).toBeNull()
  })

  it('counts and paints what the user and the agent wrote, and not the thinking or the tools', async () => {
    await render()
    await press({ key: 'f', ctrlKey: true })
    // "redirect" is in the prompt, in the reply, and in the agent's reasoning, which is left out.
    await type('redirect')
    await vi.waitFor(() => expect(status()).toMatch(/of 2$/))
    expect([...(painted.get('chat-find') ?? []), ...(painted.get('chat-find-current') ?? [])].sort()).toEqual(['redirect', 'redirect'])
    expect(painted.get('chat-find-current')).toHaveLength(1)
    // The command's own text is not searched.
    await type('npm test')
    await vi.waitFor(() => expect(status()).toBe('No results'))
    expect(painted.has('chat-find-current')).toBe(false)
  })

  it('steps through the matches with Enter and Shift+Enter, around the ends', async () => {
    await render()
    await press({ key: 'f', ctrlKey: true })
    await type('redirect')
    await vi.waitFor(() => expect(status()).toMatch(/of 2$/))
    const start = Number(status().split(' ')[0])
    await press({ key: 'Enter' }, input()!)
    expect(Number(status().split(' ')[0])).toBe(start === 2 ? 1 : 2)
    await press({ key: 'Enter', shiftKey: true }, input()!)
    expect(Number(status().split(' ')[0])).toBe(start)
    await click(q('[data-testid="chat-find-next"]'))
    await click(q('[data-testid="chat-find-next"]'))
    expect(Number(status().split(' ')[0])).toBe(start)
  })

  it('is case-insensitive', async () => {
    await render()
    await press({ key: 'f', ctrlKey: true })
    await type('FIX')
    await vi.waitFor(() => expect(status()).toMatch(/of 2$/))
  })

  it('closes with Escape and clears the painting', async () => {
    await render()
    await press({ key: 'f', ctrlKey: true })
    await type('fix')
    await vi.waitFor(() => expect(painted.size).toBeGreaterThan(0))
    await press({ key: 'Escape' }, input()!)
    expect(q('[data-testid="chat-find"]')).toBeNull()
    expect(painted.size).toBe(0)
  })

  it('loads the earlier messages while it searches, and finds what was in them', async () => {
    const earlier: ChatMessage = { kind: 'user', id: 'u0', time: 0, text: 'The very first question about pagination' } as ChatMessage
    page = { messages: turn(), older: 'cursor-1', running: false }
    api.chat.messages.mockImplementation(async (request?: { cursor?: string }) => (request?.cursor ? { messages: [earlier], older: null, running: false } : page))
    await render()
    await press({ key: 'f', ctrlKey: true })
    await type('pagination')
    await vi.waitFor(() => expect(status()).toBe('1 of 1'))
    expect(api.chat.messages).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'cursor-1' }))
    api.chat.messages.mockImplementation(async () => page)
  })
})
