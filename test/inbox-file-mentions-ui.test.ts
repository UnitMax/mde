// @vitest-environment happy-dom
import { act, createElement } from 'react'
import type { EditorView } from '@codemirror/view'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatComposer, type ChatComposerProps } from '../src/renderer/components/inbox/ChatComposer'
import { UserBubble } from '../src/renderer/components/inbox/ChatMessageView'
import type { ChatDraft, ChatDraftRequest, ChatFileEntry, ChatFilesCheckRequest, ChatFilesRequest } from '../src/shared/types'
import { messageInput, pressMessageKey, setMessageText } from './helpers/chat-input'

let dispose: (() => void) | undefined
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => { await act(async () => dispose?.()); vi.unstubAllGlobals(); document.body.innerHTML = '' })

const project: ChatFileEntry[] = [
  { path: 'src/app.ts', directory: false },
  { path: 'src/sub/', directory: true },
  { path: 'my notes.txt', directory: false },
  { path: 'README.md', directory: false },
]
const find = (query: string): ChatFileEntry[] => {
  const needle = query.toLowerCase().replace(/\/$/, '')
  return project.filter((entry) => entry.path.toLowerCase().includes(needle))
}

async function setup({ scope = { folderId: 'fld_one' }, files = async (request: ChatFilesRequest) => find(request.query), initial = '' }: {
  scope?: ChatComposerProps['fileScope'] | null
  files?: (request: ChatFilesRequest) => Promise<ChatFileEntry[]>
  initial?: string
} = {}) {
  let draft: ChatDraft = { text: initial, revision: 0, attachments: [] }
  const request = vi.fn(async (input: ChatDraftRequest) => {
    if (input.action === 'text') draft = { ...draft, text: input.text, revision: draft.revision + 1 }
    return draft
  })
  const filesApi = vi.fn(files)
  const checkFiles = vi.fn(async (input: ChatFilesCheckRequest) => input.paths.flatMap((path) => {
    const found = find(path).find((entry) => entry.path === path || entry.path === `${path.replace(/\/$/, '')}/`)
    return found ? [{ path, directory: found.directory }] : []
  }))
  Object.defineProperty(window, 'api', { configurable: true, value: { chat: { draft: request, files: filesApi, checkFiles } } })
  const send = vi.fn(async () => {})
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  dispose = () => root.unmount()
  await act(async () => root.render(createElement(ChatComposer, {
    draftKey: 'draft:drf_one', agent: 'build', model: { id: 'm', providerId: 'p' }, fileScope: scope ?? undefined,
    options: { status: 'ready', value: { agents: [], models: [], defaultModel: null, defaultAgent: null, skills: [{ id: 'demo', name: 'demo' }] } },
    onAgentChange: () => {}, onModelChange: () => {}, onSend: send,
  })))
  return { container, box: messageInput(container), request, send, files: filesApi, checkFiles }
}

async function type(box: EditorView, value: string, caret = value.length) { await setMessageText(box, value, caret) }
/** Waits for something that arrives after a pause or an answer, the way the picker's list does. */
async function until(check: () => void) {
  await vi.waitFor(async () => {
    // Each look lets React draw what has arrived, which `act` only does when it ends.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    check()
  }, { timeout: 3000 })
}
/** Lets time pass, with what arrives in it drawn. */
async function pause(ms: number) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) }) }
const press = pressMessageKey
const picker = (container: HTMLElement) => container.querySelector('[data-testid="file-picker"]')
const rows = (container: HTMLElement) => Array.from(container.querySelectorAll('[role="option"]')).map((row) => row.getAttribute('data-testid')?.replace('file-option-', ''))
const marked = (container: HTMLElement) => Array.from(container.querySelectorAll('.chat-input-file')).map((element) => element.textContent ?? '')

describe('the @ file picker in the message box', () => {
  it('stays closed without a place to look in, and for an @ inside a word', async () => {
    const lost = await setup({ scope: null })
    await type(lost.box, '@src')
    await pause(150)
    expect(picker(lost.container)).toBeNull()
    expect(lost.files).not.toHaveBeenCalled()
    await act(async () => dispose?.())
    document.body.innerHTML = ''
    const { container, box, files } = await setup()
    await type(box, 'mail me@src')
    await pause(150)
    expect(picker(container)).toBeNull()
    expect(files).not.toHaveBeenCalled()
  })

  it('lists what the project has for what follows the @, asking for the folder it was given', async () => {
    const { container, box, files } = await setup()
    await type(box, 'look at @')
    await until(() => expect(rows(container)).toEqual(['src/app.ts', 'src/sub/', 'my notes.txt', 'README.md']))
    expect(files).toHaveBeenLastCalledWith({ folderId: 'fld_one', query: '' })
    expect(picker(container)?.getAttribute('role')).toBe('listbox')
    expect(box.contentDOM.getAttribute('aria-controls')).toBe(picker(container)?.id)
    // The name comes first and the folders it is in after it.
    const first = container.querySelector('[role="option"]')!
    expect(first.textContent).toBe('app.tssrc/')
    await type(box, 'look at @app')
    await until(() => expect(files).toHaveBeenLastCalledWith({ folderId: 'fld_one', query: 'app' }))
    await until(() => expect(rows(container)).toEqual(['src/app.ts']))
    await type(box, 'look at @zzz')
    await until(() => expect(picker(container)).toBeNull())
  })

  it('asks for a thread when it is given one', async () => {
    const { box, files } = await setup({ scope: { threadId: 'ses_one' } })
    await type(box, '@a')
    await until(() => expect(files).toHaveBeenLastCalledWith({ threadId: 'ses_one', query: 'a' }))
  })

  it('writes the file with Enter instead of sending, and marks it as a file', async () => {
    const { container, box, send, request } = await setup()
    await type(box, 'look at @ap')
    await until(() => expect(rows(container)).toEqual(['src/app.ts']))
    const enter = await press(box, 'Enter')
    expect(enter.defaultPrevented).toBe(true)
    expect(box.state.doc.toString()).toBe('look at @src/app.ts ')
    expect(box.state.selection.main.from).toBe(20)
    expect(picker(container)).toBeNull()
    expect(send).not.toHaveBeenCalled()
    expect(request).toHaveBeenLastCalledWith({ key: 'draft:drf_one', action: 'text', text: 'look at @src/app.ts ' })
    expect(marked(container)).toEqual(['@src/app.ts'])
  })

  it('writes a folder with its closing slash, and a path with a space in quotes', async () => {
    const { container, box } = await setup()
    await type(box, '@sub')
    await until(() => expect(rows(container)).toEqual(['src/sub/']))
    await press(box, 'Tab')
    expect(box.state.doc.toString()).toBe('@src/sub/ ')
    await type(box, 'and @notes')
    await until(() => expect(rows(container)).toEqual(['my notes.txt']))
    await press(box, 'Enter')
    expect(box.state.doc.toString()).toBe('and @"my notes.txt" ')
    expect(marked(container)).toEqual(['@"my notes.txt"'])
  })

  it('moves with the arrow keys and writes the one that is clicked, without taking the caret out of the box', async () => {
    const { container, box, send } = await setup()
    await type(box, '@')
    await until(() => expect(rows(container)).toHaveLength(4))
    expect(container.querySelector('[aria-selected="true"]')?.getAttribute('data-testid')).toBe('file-option-src/app.ts')
    await press(box, 'ArrowDown')
    expect(container.querySelector('[aria-selected="true"]')?.getAttribute('data-testid')).toBe('file-option-src/sub/')
    await press(box, 'ArrowUp')
    await press(box, 'ArrowUp')
    expect(container.querySelector('[aria-selected="true"]')?.getAttribute('data-testid')).toBe('file-option-README.md')
    const option = container.querySelector<HTMLElement>('[data-testid="file-option-README.md"]')!
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    await act(async () => { option.dispatchEvent(down) })
    expect(down.defaultPrevented).toBe(true)
    await act(async () => option.click())
    expect(box.state.doc.toString()).toBe('@README.md ')
    expect(send).not.toHaveBeenCalled()
  })

  it('closes with Escape and then leaves Enter to send the message as written', async () => {
    const { container, box, send } = await setup()
    await type(box, 'see @ap')
    await until(() => expect(rows(container)).toEqual(['src/app.ts']))
    const escape = await press(box, 'Escape')
    expect(escape.defaultPrevented).toBe(true)
    expect(picker(container)).toBeNull()
    await press(box, 'Enter')
    await until(() => expect(send).toHaveBeenCalledWith('see @ap', expect.anything()))
  })

  it('replaces the whole word when the caret is in the middle of one', async () => {
    const { container, box } = await setup()
    await type(box, 'see @src/xx now', 8)
    await until(() => expect(rows(container)).toEqual(['src/app.ts', 'src/sub/']))
    await press(box, 'Enter')
    expect(box.state.doc.toString()).toBe('see @src/app.ts now')
  })

  it('shows no list, and does not fail, when the project cannot be searched', async () => {
    const { container, box, files } = await setup({ files: async () => { throw new Error('offline') } })
    await type(box, '@a')
    await until(() => expect(files).toHaveBeenCalled())
    await pause(50)
    expect(picker(container)).toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('still offers skills after a $', async () => {
    const { container, box } = await setup()
    await type(box, '$de')
    expect(container.querySelector('[data-testid="skill-picker"]')).not.toBeNull()
    expect(picker(container)).toBeNull()
  })
})

describe('marking the files a message names in the box', () => {
  it('marks a mention once the project is known to have the path, and only then', async () => {
    const { container, box, checkFiles } = await setup()
    await type(box, 'compare @src/app.ts with @src/gone.ts and @alice please')
    await until(() => expect(marked(container)).toEqual(['@src/app.ts']))
    expect(checkFiles).toHaveBeenCalledTimes(1)
    expect(checkFiles).toHaveBeenCalledWith({ folderId: 'fld_one', paths: ['src/app.ts', 'src/gone.ts', 'alice'] })
  })

  it('marks the mentions of a draft that was kept, and a folder named without its slash', async () => {
    const { container } = await setup({ initial: 'Read @README.md and @src/sub and @"my notes.txt"' })
    await until(() => expect(marked(container)).toEqual(['@README.md', '@src/sub', '@"my notes.txt"']))
  })

  it('does not ask about a path again, or about the word the caret is still in', async () => {
    const { container, box, checkFiles } = await setup()
    await type(box, 'look at @src/ap')
    await pause(450)
    expect(checkFiles).not.toHaveBeenCalled()
    await type(box, 'look at @src/app.ts', 11)
    await pause(450)
    expect(checkFiles).not.toHaveBeenCalled()
    await type(box, 'look at @src/app.ts now')
    await until(() => expect(marked(container)).toEqual(['@src/app.ts']))
    await type(box, 'look at @src/app.ts now and then')
    await pause(450)
    expect(checkFiles).toHaveBeenCalledTimes(1)
  })

  it('marks nothing when the check fails', async () => {
    const { container, box, checkFiles } = await setup()
    checkFiles.mockRejectedValue(new Error('offline'))
    await type(box, 'look at @src/app.ts now')
    await until(() => expect(checkFiles).toHaveBeenCalled())
    await pause(50)
    expect(marked(container)).toEqual([])
  })
})

describe('the files a sent message named', () => {
  async function bubble(message: Parameters<typeof UserBubble>[0]['message']) {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    dispose = () => root.unmount()
    await act(async () => root.render(createElement(UserBubble, { message })))
    return container
  }

  it('marks the words that were sent as files and no others', async () => {
    const container = await bubble({
      kind: 'user', id: 'msg_1', time: 1, text: 'Compare @src/app.ts with @alice',
      mentions: [{ text: '@src/app.ts', path: 'src/app.ts', directory: false }],
    })
    const marks = Array.from(container.querySelectorAll('[data-testid="chat-file-mention"]'))
    expect(marks.map((mark) => mark.textContent)).toEqual(['@src/app.ts'])
    expect(marks[0]?.getAttribute('title')).toBe('src/app.ts')
    expect(container.textContent).toBe('Compare @src/app.ts with @alice')
  })

  it('shows a message without mentions as plain text', async () => {
    const container = await bubble({ kind: 'user', id: 'msg_2', time: 1, text: 'Hi @src/app.ts' })
    expect(container.querySelector('[data-testid="chat-file-mention"]')).toBeNull()
    expect(container.textContent).toBe('Hi @src/app.ts')
  })

  it('marks a mention inside the text around a quote too', async () => {
    const container = await bubble({
      kind: 'user', id: 'msg_3', time: 1, text: '> quoted line\n\nAbout @README.md',
      mentions: [{ text: '@README.md', path: 'README.md', directory: false }],
    })
    expect(Array.from(container.querySelectorAll('[data-testid="chat-file-mention"]')).map((mark) => mark.textContent)).toEqual(['@README.md'])
  })
})
