// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, ChatMessagesPage, InboxFolder, InboxThread } from '../src/shared/types'
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useWorkspace } from '../src/renderer/store/workspace'

const roots: Root[] = []

const folder: InboxFolder = {
  id: 'fld_app', name: 'app', directory: '/home/me/app',
  target: { kind: 'wsl', distro: 'Ubuntu' }, createdAt: 1, lastUsedAt: 1,
}
const model = { id: 'free-1', providerId: 'opencode' }

function thread(): InboxThread {
  return {
    id: 'ses_one', title: 'Fix login', directory: '/home/me/app', target: { kind: 'wsl', distro: 'Ubuntu' },
    branch: 'main', model, status: 'completed',
    createdAt: 1, lastActivityAt: Date.now(), readAt: Date.now(), archived: false, folderId: 'fld_app',
  }
}

const reply = 'Done. See [the docs](https://example.com/docs) and [the notes](./notes.md).\n\n```ts\nconst a = 1\n```'
const conversation: ChatMessage[] = [
  { kind: 'user', id: 'msg_1', time: 1, text: 'Fix the login' },
  {
    kind: 'assistant', id: 'msg_2', time: 2, agent: 'build', model, completed: true,
    parts: [
      { kind: 'reasoning', text: 'Looking at auth.ts' },
      { kind: 'tool', id: 'call_1', name: 'read', status: 'completed', input: '{"path":"/home/me/app/src/auth.ts"}', output: 'export {}' },
      { kind: 'text', text: reply },
    ],
  },
]

let page: ChatMessagesPage
const writeText = vi.fn(async (_text: string): Promise<void> => undefined)
const api = {
  inbox: {
    setRead: vi.fn(async () => null),
    folders: vi.fn(async () => ({ folders: [folder], composer: {} })),
    gitInfo: vi.fn(async () => ({ repository: false, branch: null, branches: [] })),
  },
  clipboard: { writeText, paste: vi.fn(async () => undefined) },
  chat: {
    draft: vi.fn(async (req: { text?: string }) => ({ text: req.text ?? '', revision: 1, attachments: [] })),
    options: vi.fn(() => new Promise(() => {})),
    messages: vi.fn(async () => page),
    requests: vi.fn(async () => ({ permissions: [], forms: [] })),
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
  await vi.waitFor(() => expect(container.querySelector('[data-testid="chat-transcript"]')).not.toBeNull())
  await vi.waitFor(() => expect(container.textContent).not.toContain('Loading conversation'))
  return container
}

const items = (): HTMLElement[] => Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'))
const labels = (): string[] => items().map((item) => item.textContent?.trim() ?? '')
const item = (label: string): HTMLElement => {
  const found = items().find((candidate) => candidate.textContent?.trim() === label)
  if (!found) throw new Error(`No menu item ${label}; there are ${labels().join(', ')}`)
  return found
}

async function rightClick(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20, button: 2 }))
  })
}
async function choose(label: string): Promise<void> {
  await act(async () => item(label).click())
}

/** Selects the text of an element, as dragging across it would. */
function select(element: Element): void {
  const range = document.createRange()
  range.selectNodeContents(element)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('api', api)
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
  page = { messages: conversation, older: null, running: false }
  useWorkspace.setState({
    platform: { platform: 'win32', isWindows: true },
    wslAvailable: true,
    inboxThreads: [thread()],
    selectedInboxThreadId: 'ses_one',
    activeWorkspaceView: 'inbox',
  })
  useInboxChat.setState({ folders: [folder], composer: { folderId: 'fld_app' }, foldersLoaded: true, options: {}, threads: {}, recent: [], titleRegenerations: {} })
})

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()))
  window.getSelection()?.removeAllRanges()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the right-click menu of a conversation', () => {
  it('copies a reply as the Markdown it was written in, not as flattened text', async () => {
    const view = await render()
    await rightClick(view.querySelector('[data-chat-message="msg_2"] p')!)
    expect(labels()).toEqual(['Copy message as Markdown', 'Select all', 'Copy conversation as Markdown'])
    await choose('Copy message as Markdown')
    // The reasoning and the tool call are not part of the answer; the fence and the links are.
    expect(writeText).toHaveBeenCalledExactlyOnceWith(reply)
  })

  it('copies one of your own messages', async () => {
    const view = await render()
    await rightClick(view.querySelector('[data-chat-message="msg_1"]')!)
    await choose('Copy message as Markdown')
    expect(writeText).toHaveBeenCalledExactlyOnceWith('Fix the login')
  })

  it('offers to copy and open a link on the web, and only to copy one that is not', async () => {
    const view = await render()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await rightClick(view.querySelector('a[href="https://example.com/docs"]')!)
    expect(labels()).toEqual(['Copy link address', 'Open link', 'Copy message as Markdown', 'Select all', 'Copy conversation as Markdown'])
    await choose('Open link')
    expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com/docs', '_blank', 'noopener,noreferrer')

    await rightClick(view.querySelector('a[href="https://example.com/docs"]')!)
    await choose('Copy link address')
    expect(writeText).toHaveBeenLastCalledWith('https://example.com/docs')

    await rightClick(view.querySelector('a[href="./notes.md"]')!)
    expect(labels()).not.toContain('Open link')
    await choose('Copy link address')
    expect(writeText).toHaveBeenLastCalledWith('./notes.md')
    expect(open).toHaveBeenCalledOnce()
  })

  it('copies the code of a code block, and of a tool call that has been opened', async () => {
    const view = await render()
    await rightClick(view.querySelector('[data-chat-message="msg_2"] pre')!)
    expect(labels()[0]).toBe('Copy code')
    await choose('Copy code')
    expect(writeText).toHaveBeenLastCalledWith('const a = 1')

    await act(async () => view.querySelector<HTMLButtonElement>('[data-testid="chat-tool-call_1"] button')!.click())
    await rightClick(view.querySelector('[data-testid="chat-tool-call_1"] pre')!)
    await choose('Copy code')
    expect(writeText).toHaveBeenLastCalledWith('{"path":"/home/me/app/src/auth.ts"}')
  })

  it('copies the selected text when the click lands on it, and not when it lands elsewhere', async () => {
    const view = await render()
    const paragraph = view.querySelector('[data-chat-message="msg_2"] p')!
    select(paragraph)
    await rightClick(paragraph)
    expect(labels()[0]).toBe('Copy')
    await choose('Copy')
    expect(writeText).toHaveBeenLastCalledWith(window.getSelection()!.toString())
    expect(writeText.mock.calls.at(-1)![0]).toContain('Done. See the docs')

    // Pointing at another message is not pointing at the selection.
    await rightClick(view.querySelector('[data-chat-message="msg_1"]')!)
    expect(labels()).not.toContain('Copy')
    expect(labels()[0]).toBe('Copy message as Markdown')
  })

  it('offers only the whole-conversation items on empty space', async () => {
    const view = await render()
    await rightClick(view.querySelector('[data-testid="chat-transcript"]')!)
    expect(labels()).toEqual(['Select all', 'Copy conversation as Markdown'])
  })

  it('copies the conversation, one heading for each side', async () => {
    const view = await render()
    await rightClick(view.querySelector('[data-testid="chat-transcript"]')!)
    await choose('Copy conversation as Markdown')
    expect(writeText).toHaveBeenCalledExactlyOnceWith(`## You\n\nFix the login\n\n## Assistant\n\n${reply}`)
  })

  it('selects the whole transcript with Select all', async () => {
    const view = await render()
    await rightClick(view.querySelector('[data-testid="chat-transcript"]')!)
    await choose('Select all')
    const selected = window.getSelection()!.toString()
    expect(selected).toContain('Fix the login')
    expect(selected).toContain('const a = 1')
  })

  it('says it copies only what is loaded while earlier messages are not', async () => {
    page = { messages: conversation, older: 'cursor', running: false }
    const view = await render()
    await rightClick(view.querySelector('[data-testid="chat-transcript"]')!)
    expect(labels()).toEqual(['Select all', 'Copy loaded messages as Markdown'])
  })

  it('has nothing to copy or select in an empty conversation', async () => {
    page = { messages: [], older: null, running: false }
    const view = await render()
    await vi.waitFor(() => expect(view.textContent).toContain('No messages yet.'))
    await rightClick(view.querySelector('[data-testid="chat-transcript"]')!)
    expect(labels()).toEqual(['Select all', 'Copy conversation as Markdown'])
    expect(items().every((entry) => entry.hasAttribute('data-disabled'))).toBe(true)
  })

  it('tells the person when the clipboard could not be written', async () => {
    writeText.mockRejectedValueOnce(new Error("Error invoking remote method 'clipboard:write-text': Error: Invalid IPC payload for clipboard:write-text."))
    const view = await render()
    await rightClick(view.querySelector('[data-testid="chat-transcript"]')!)
    await choose('Copy conversation as Markdown')
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-copy-error"]')?.textContent).toContain('Invalid IPC payload'))

    // The next copy that works takes the message away.
    await rightClick(view.querySelector('[data-testid="chat-transcript"]')!)
    await choose('Copy conversation as Markdown')
    await vi.waitFor(() => expect(view.querySelector('[data-testid="chat-copy-error"]')).toBeNull())
  })
})
