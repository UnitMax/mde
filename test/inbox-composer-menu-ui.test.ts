// @vitest-environment happy-dom
import { act, createElement } from 'react'
import type { EditorView } from '@codemirror/view'
import { messageInput, setMessageText } from './helpers/chat-input'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatComposer } from '../src/renderer/components/inbox/ChatComposer'
import type { ChatDraft, ChatDraftRequest } from '../src/shared/types'

let dispose: (() => void) | undefined
const writeText = vi.fn(async (_text: string): Promise<void> => undefined)
/** Whether the editor had the focus at the moment the clipboard was pasted. */
const pastedWhileFocused: boolean[] = []
let editor: EditorView | undefined
const paste = vi.fn(async (): Promise<void> => {
  pastedWhileFocused.push(document.activeElement === editor?.contentDOM)
})

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
  paste.mockClear()
  pastedWhileFocused.length = 0
})
afterEach(async () => { await act(async () => dispose?.()); vi.unstubAllGlobals(); document.body.innerHTML = '' })

async function setup({ initial = '', disabled = false }: { initial?: string; disabled?: boolean } = {}) {
  let draft: ChatDraft = { text: initial, revision: 0, attachments: [] }
  const request = vi.fn(async (input: ChatDraftRequest) => {
    if (input.action === 'text') draft = { ...draft, text: input.text, revision: draft.revision + 1 }
    return draft
  })
  Object.defineProperty(window, 'api', { configurable: true, value: { chat: { draft: request }, clipboard: { writeText, paste } } })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  dispose = () => root.unmount()
  await act(async () => root.render(createElement(ChatComposer, {
    draftKey: 'thread:ses_one', agent: 'build', model: { id: 'm', providerId: 'p' }, disabled,
    options: { status: 'ready', value: { agents: [], models: [], defaultModel: null, defaultAgent: null, skills: [] } },
    onAgentChange: () => {}, onModelChange: () => {}, onSend: async () => {},
  })))
  const box = messageInput(container)
  editor = box
  return { container, box, request }
}

const items = (): HTMLElement[] => Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'))
const item = (label: string): HTMLElement => {
  const found = items().find((candidate) => candidate.textContent?.trim() === label)
  if (!found) throw new Error(`No menu item ${label}`)
  return found
}
const disabled = (label: string): boolean => item(label).hasAttribute('data-disabled')

async function rightClick(box: EditorView): Promise<void> {
  await act(async () => {
    box.contentDOM.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20, button: 2 }))
  })
}
async function choose(label: string): Promise<void> {
  await act(async () => item(label).click())
}
async function selectText(box: EditorView, from: number, to: number): Promise<void> {
  await act(async () => box.dispatch({ selection: { anchor: from, head: to } }))
}

describe('the right-click menu of the message box', () => {
  it('offers Cut, Copy, Paste and Select all, and only what can be used', async () => {
    const { box } = await setup()
    await setMessageText(box, 'hello world')
    await rightClick(box)
    expect(items().map((entry) => entry.textContent?.trim())).toEqual(['Cut', 'Copy', 'Paste', 'Select all'])
    // Nothing is selected, so there is nothing to cut or copy.
    expect([disabled('Cut'), disabled('Copy'), disabled('Paste'), disabled('Select all')]).toEqual([true, true, false, false])
  })

  it('copies the selection and leaves the text alone', async () => {
    const { box } = await setup()
    await setMessageText(box, 'hello world')
    await selectText(box, 6, 11)
    await rightClick(box)
    expect(disabled('Copy')).toBe(false)
    await choose('Copy')
    expect(writeText).toHaveBeenCalledExactlyOnceWith('world')
    expect(box.state.doc.toString()).toBe('hello world')
  })

  it('cuts the selection: it goes to the clipboard and out of the box, and the draft follows', async () => {
    const { box, request } = await setup()
    await setMessageText(box, 'hello world')
    await selectText(box, 5, 11)
    await rightClick(box)
    await choose('Cut')
    expect(writeText).toHaveBeenCalledExactlyOnceWith(' world')
    await vi.waitFor(() => expect(box.state.doc.toString()).toBe('hello'))
    expect(request).toHaveBeenLastCalledWith({ key: 'thread:ses_one', action: 'text', text: 'hello' })
  })

  it('keeps the text when the clipboard could not be written, instead of losing it', async () => {
    writeText.mockRejectedValue(new Error('no clipboard'))
    const { box } = await setup()
    await setMessageText(box, 'hello world')
    await selectText(box, 0, 5)
    await rightClick(box)
    await choose('Cut')
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    await act(async () => { await Promise.resolve() })
    expect(box.state.doc.toString()).toBe('hello world')
  })

  it('selects all of the text and gives the box the focus', async () => {
    const { box } = await setup()
    await setMessageText(box, 'hello world')
    await selectText(box, 3, 3)
    await rightClick(box)
    await choose('Select all')
    expect(box.state.selection.main.from).toBe(0)
    expect(box.state.selection.main.to).toBe(11)
    await vi.waitFor(() => expect(document.activeElement).toBe(box.contentDOM))
  })

  it('pastes only once the menu is closed and the box has the focus, so the text lands in it', async () => {
    const { box } = await setup()
    await setMessageText(box, 'hello')
    await rightClick(box)
    await choose('Paste')
    await vi.waitFor(() => expect(paste).toHaveBeenCalledOnce())
    expect(pastedWhileFocused).toEqual([true])
    expect(document.body.querySelector('[role="menu"]')).toBeNull()
  })

  it('does not paste when another item is chosen or the menu is dismissed', async () => {
    const { box } = await setup()
    await setMessageText(box, 'hello')
    await rightClick(box)
    await choose('Select all')
    await rightClick(box)
    await act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(paste).not.toHaveBeenCalled()
  })

  it('cannot cut or paste while the box is disabled, but can still copy', async () => {
    const { box } = await setup({ initial: 'locked text', disabled: true })
    await act(async () => { box.dispatch({ selection: { anchor: 0, head: 6 } }) })
    await rightClick(box)
    expect([disabled('Cut'), disabled('Copy'), disabled('Paste'), disabled('Select all')]).toEqual([true, false, true, false])
    await choose('Copy')
    expect(writeText).toHaveBeenCalledExactlyOnceWith('locked')
  })
})
