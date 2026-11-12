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
import type { ChatMessage, ChatMessagesPage, ChatPart, ChatRequests, InboxThread } from '../src/shared/types'
import { parseMessage } from '../src/main/opencode/service/parse'

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
    requests: vi.fn(async (): Promise<ChatRequests> => ({ permissions: [], forms: [] })),
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
  it('folds a command, its process notification and later thinking into one activity line', async () => {
    const notice = parseMessage({
      id: 'n_process', type: 'synthetic', description: 'python3 server.py',
      text: 'The background command received SIGTERM and exited cleanly.',
    })!
    page = {
      messages: [
        prompt,
        step('a_command', [shell('kill "$SERVER_PID"')]),
        notice,
        step('a_answer', [{ kind: 'reasoning', text: 'The server has stopped.' }, { kind: 'text', text: 'The server has been stopped. Port 8000 is now free.' }]),
      ], older: null, running: false,
    }
    useInboxView.setState({ compactChat: true })
    await render()
    await vi.waitFor(() => expect(q('[data-testid="chat-message-a_answer"]')).not.toBeNull())
    expect(all('[data-testid="chat-activity"]')).toHaveLength(1)
    expect(text(q('[data-testid="chat-activity-summary"]'))).toBe('Thought, ran 1 command and received 1 update')
    expect(q('[data-testid="chat-message-n_process"]')).toBeNull()
    expect(q('[data-testid="chat-reasoning"]')).toBeNull()
    expect(text(q('[data-testid="chat-message-a_answer"]'))).toContain('Port 8000 is now free.')
    await click(q('[data-testid="chat-activity"] button'))
    expect(all('[data-testid^="chat-tool-"]')).toHaveLength(1)
    expect(q('[data-testid="chat-reasoning"]')).not.toBeNull()
    const row = q('[data-testid="chat-note-n_process"]')!
    expect(text(row)).toContain('python3 server.py')
    await click(row.querySelector('button'))
    expect(text(row)).toContain('received SIGTERM and exited cleanly')
    await click(q(TOGGLE))
    expect(all('[data-testid="chat-activity"]')).toHaveLength(0)
    expect(q('[data-testid="chat-message-n_process"]')).not.toBeNull()
    expect(q('[data-testid="chat-reasoning"]')).not.toBeNull()
  })

  it('can start an activity group with a notification before the next assistant step', async () => {
    page = {
      messages: [prompt, parseMessage({ id: 'n_context', type: 'system', text: 'Background job finished.', description: 'Job finished' })!, step('a_answer', [{ kind: 'text', text: 'Ready.' }])],
      older: null, running: false,
    }
    useInboxView.setState({ compactChat: true })
    await render()
    await vi.waitFor(() => expect(q('[data-testid="chat-activity-summary"]')).not.toBeNull())
    expect(text(q('[data-testid="chat-activity-summary"]'))).toBe('Received 1 update')
    expect(text(q('[data-testid="chat-message-a_answer"]'))).toBe('Ready.')
    await click(q('[data-testid="chat-activity"] button'))
    expect(text(q('[data-testid="chat-note-n_context"]'))).toBe('Job finished')
  })

  it('shows every step as it always did until compact is turned on', async () => {
    await render()
    await vi.waitFor(() => expect(q('[data-testid="chat-message-a4"]')).not.toBeNull())
    // Each step has its own message, and two commands are two rows, not a group.
    for (const id of ['a1', 'a2', 'a3', 'a4']) expect(q(`[data-testid="chat-message-${id}"]`)).not.toBeNull()
    expect(all('[data-testid="chat-activity"]')).toHaveLength(0)
  })

  it('folds everything but the answer into one line, across the steps of the turn', async () => {
    useInboxView.setState({ compactChat: true })
    await render()
    await vi.waitFor(() => expect(q('[data-testid="chat-message-a4"]')).not.toBeNull())

    // Only the answer is drawn as it is; what the agent said on the way is part of the line.
    const groups = all('[data-testid="chat-activity"]')
    expect(groups).toHaveLength(1)
    expect(text(q('[data-testid="chat-activity-summary"]'))).toBe('Thought, wrote an update, read 1 file and ran 3 commands')
    expect(groups[0]!.querySelector('button')!.getAttribute('aria-expanded')).toBe('false')
    expect(text(q('[data-testid="chat-message-a1"]'))).not.toContain('I will check the failing test.')
    expect(all('[data-testid^="chat-tool-"]')).toHaveLength(0)
    expect(q('[data-testid="chat-reasoning"]')).toBeNull()
    expect(q('[data-testid="chat-said"]')).toBeNull()
    // The steps that only did work have nothing left to draw.
    expect(q('[data-testid="chat-message-a2"]')).toBeNull()
    expect(q('[data-testid="chat-message-a3"]')).toBeNull()
    expect(text(q('[data-testid="chat-message-a4"]'))).toBe('All fixed.')

    // Opening the line shows every step, from all the messages that did them, the words among them.
    await click(groups[0]!.querySelector('button'))
    expect(all('[data-testid^="chat-tool-"]')).toHaveLength(4)
    expect(q('[data-testid="chat-reasoning"]')).not.toBeNull()
    expect(text(q('[data-testid="chat-said"]'))).toBe('Said I will check the failing test.')
  })

  it('folds the words the agent wrote between its tool calls, and shows the last ones', async () => {
    page = {
      messages: [
        prompt,
        step('a1', [{ kind: 'text', text: 'Let me look at the **handler**.' }, read('reset.ts')]),
        step('a2', [{ kind: 'text', text: 'The cause is clear now.\n\nI will fix it.' }, shell('npm test')]),
        step('a3', [{ kind: 'text', text: 'Fixed it.' }]),
      ],
      older: null,
      running: false,
    }
    useInboxView.setState({ compactChat: true })
    await render()
    await vi.waitFor(() => expect(q('[data-testid="chat-message-a3"]')).not.toBeNull())
    expect(text(q('[data-testid="chat-message-a1"]'))).not.toContain('Let me look')
    expect(text(q('[data-testid="chat-activity-summary"]'))).toBe('Wrote 2 updates, read 1 file and ran 1 command')
    expect(text(q('[data-testid="chat-message-a3"]'))).toBe('Fixed it.')

    await click(q('[data-testid="chat-activity"] button'))
    const said = all('[data-testid="chat-said"]')
    expect(said.map((row) => text(row))).toEqual(['Said Let me look at the handler.', 'Said The cause is clear now.'])
    // A row opens onto all of the words, as the text it was written as.
    await click(said[1]!.querySelector('button'))
    expect(text(said[1]!)).toContain('I will fix it.')
  })

  it('draws the words being written as they are, while no more work has followed them', async () => {
    page = { messages: [prompt, step('a1', [shell('npm test'), { kind: 'text', text: 'The test fails because' }], false)], older: null, running: true }
    useWorkspace.setState({ inboxThreads: [thread({ status: 'working' })] })
    useInboxView.setState({ compactChat: true })
    await render()
    await vi.waitFor(() => expect(q('[data-testid="chat-message-a1"]')).not.toBeNull())
    expect(text(q('[data-testid="chat-message-a1"]'))).toContain('The test fails because')
    expect(q('[data-testid="chat-activity"]')!.hasAttribute('data-live')).toBe(false)
    expect(q('[data-testid="chat-said"]')).toBeNull()
  })

  it('folds the words into the line once the agent goes on to more work, which is then at work again', async () => {
    page = {
      messages: [prompt, step('a1', [shell('npm test'), { kind: 'text', text: 'The test fails because the redirect is wrong.' }, shell('git diff', { status: 'running', exitCode: undefined, output: undefined })], false)],
      older: null,
      running: true,
    }
    useWorkspace.setState({ inboxThreads: [thread({ status: 'working' })] })
    useInboxView.setState({ compactChat: true })
    await render()
    await vi.waitFor(() => expect(q('[data-testid="chat-activity"]')).not.toBeNull())
    expect(text(q('[data-testid="chat-message-a1"]'))).not.toContain('The test fails')
    expect(q('[data-testid="chat-activity"]')!.hasAttribute('data-live')).toBe(true)
    expect(text(q('[data-testid="chat-activity-summary"]'))).toBe('Wrote an update and running 2 commands')
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
    await vi.waitFor(() => expect(q('[data-testid="chat-activity"]')).not.toBeNull())
    expect(q('[data-testid="chat-diff"]')).toBeNull()
    expect(text(q('[data-testid="chat-activity-summary"]'))).toBe('Wrote an update and edited 1 file')
    await click(q('[data-testid="chat-activity"] button'))
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

  it('folds thinking, a file write, a patch, a notification and a test command into one line', async () => {
    const write = tool('write', { filePath: '/home/me/app/server.py', content: 'print("Hello World")' }, { existed: false })
    const patch = tool('patch', { patchText: '*** Begin Patch\n*** Add File: README.md\n+Run python3 server.py\n*** End Patch' })
    page = {
      messages: [
        prompt,
        step('a1', [{ kind: 'reasoning', text: 'I will create the server.' }, { kind: 'text', text: 'Writing the file.' }, write]),
        step('a2', [patch]),
        parseMessage({ id: 'n_process', type: 'synthetic', description: 'python3 server.py', text: 'Process started.' })!,
        step('a3', [{ kind: 'reasoning', text: 'Now test it.' }, shell('curl http://localhost:8000')]),
        step('a4', [{ kind: 'text', text: 'Done! The server works.' }]),
      ], older: null, running: false,
    }
    useInboxView.setState({ compactChat: true })
    await render()
    await vi.waitFor(() => expect(q('[data-testid="chat-message-a4"]')).not.toBeNull())
    expect(all('[data-testid="chat-activity"]')).toHaveLength(1)
    expect(text(q('[data-testid="chat-activity-summary"]')))
      .toBe('Thought 2 times, wrote an update, wrote 1 file, applied 1 patch, ran 1 command and received 1 update')
    expect(q('[data-testid="chat-diff"]')).toBeNull()
    expect(q('[data-testid="chat-reasoning"]')).toBeNull()
    expect(text(q('[data-testid="chat-message-a4"]'))).toBe('Done! The server works.')
    await click(q('[data-testid="chat-activity"] button'))
    expect(all('[data-testid="chat-diff"]')).toHaveLength(2)
    expect(all('[data-testid="chat-reasoning"]')).toHaveLength(2)
    expect(q('[data-testid="chat-note-n_process"]')).not.toBeNull()
  })

  it('keeps subagent cards inside the group with their details intact', async () => {
    const subagent = (id: string) => tool('subagent', { agent: 'general', description: `Review ${id}`, prompt: 'Check the server.' }, {
      output: 'Looks good.', subagent: { sessionId: `ses_${id}`, model: { id: 'review-model', providerId: 'p', variant: 'high' } },
    })
    page = { messages: [prompt, step('a1', [subagent('one'), subagent('two')]), step('a2', [shell('npm test'), { kind: 'text', text: 'All done.' }])], older: null, running: false }
    useInboxView.setState({ compactChat: true })
    await render()
    await vi.waitFor(() => expect(q('[data-testid="chat-message-a2"]')).not.toBeNull())
    expect(all('[data-testid="chat-activity"]')).toHaveLength(1)
    expect(q('[data-testid="chat-subagents"]')).toBeNull()
    await click(q('[data-testid="chat-activity"] button'))
    expect(all('[data-testid="chat-subagents"]')).toHaveLength(1)
    expect(all('[data-testid^="chat-subagent-"]')).toHaveLength(2)
    expect(all('[aria-label="Model: review-model · high"]')).toHaveLength(2)
    await click(q(TOGGLE))
    expect(q('[data-testid="chat-subagents"]')).not.toBeNull()
  })

  it('shows a question with the words that lead up to it, and starts a new line for the work after the answer', async () => {
    const question = tool('question', { questions: [{ question: 'Which port?' }] }, { answers: [['8000']] })
    page = {
      messages: [
        prompt,
        step('a1', [{ kind: 'text', text: 'I will check the config.' }, read('server.py'), { kind: 'text', text: 'The server can listen on 8000 or 9000.' }, question]),
        step('a2', [shell('python3 server.py'), shell('npm test')]),
        step('a3', [{ kind: 'text', text: 'Running on 8000.' }]),
      ],
      older: null,
      running: false,
    }
    useInboxView.setState({ compactChat: true })
    await render()
    await vi.waitFor(() => expect(q('[data-testid="chat-message-a3"]')).not.toBeNull())
    const groups = all('[data-testid="chat-activity"]')
    expect(groups.map((group) => text(group.querySelector('button')))).toEqual([
      'Wrote an update and read 1 file',
      'Ran 2 commands',
    ])
    const message = q('[data-testid="chat-message-a1"]')!
    expect(text(message)).toContain('The server can listen on 8000 or 9000.')
    expect(text(message)).not.toContain('I will check the config.')
    const answered = q('[data-testid="chat-answered-question"]')!
    expect(text(answered)).toContain('Which port?')
    expect(text(answered)).toContain('8000')
    expect(groups.some((group) => group.contains(answered))).toBe(false)
  })

  it('leaves active permission and question requests outside the collapsed activity', async () => {
    const answer: ChatRequests = {
      permissions: [{ id: 'per_active', action: 'shell', resources: ['python3 server.py'] }],
      forms: [{ id: 'form_active', title: 'Which port?', unsupported: false, fields: [{ key: 'port', type: 'string', title: 'Port', required: true, options: [], custom: true }] }],
    }
    api.chat.requests.mockResolvedValueOnce(answer)
    page = { messages: [prompt, step('a1', [tool('write', { filePath: '/home/me/app/server.py' }, { status: 'running' }), tool('question', {}, { status: 'running' })], false)], older: null, running: true }
    useWorkspace.setState({ inboxThreads: [thread({ status: 'attention', attentionReason: 'question' })] })
    useInboxView.setState({ compactChat: true })
    await render()
    await vi.waitFor(() => expect(q('[data-testid="chat-question-form_active"]')).not.toBeNull())
    const group = q('[data-testid="chat-activity"]')!
    expect(group.querySelector('button')?.getAttribute('aria-expanded')).toBe('false')
    expect(q('[data-testid="chat-permission-per_active"]')).not.toBeNull()
    expect(group.contains(q('[data-testid="chat-permission-per_active"]'))).toBe(false)
    expect(group.contains(q('[data-testid="chat-question-form_active"]'))).toBe(false)
    expect(q('[data-testid="chat-permission-per_active"] button')?.hasAttribute('disabled')).toBe(false)
  })

  it.each(['write', 'edit', 'subagent'])('keeps failed %s activity visible in the collapsed failure count', async (name) => {
    page = { messages: [prompt, step('a1', [tool(name, {}, { status: 'error', error: 'Operation failed.' })]), step('a2', [{ kind: 'text', text: 'It failed.' }])], older: null, running: false }
    useInboxView.setState({ compactChat: true })
    await render()
    await vi.waitFor(() => expect(q('[data-testid="chat-activity"]')).not.toBeNull())
    expect(text(q('[data-testid="chat-activity"] button'))).toContain('1 failed')
    expect(q('[data-testid="chat-activity"] button')?.getAttribute('aria-expanded')).toBe('false')
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
