// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatComposer } from '../src/renderer/components/inbox/ChatComposer'
import { UserBubble } from '../src/renderer/components/inbox/ChatMessageView'
import { useInboxTerminal } from '../src/renderer/store/inbox-terminal'
import { useWorkspace } from '../src/renderer/store/workspace'
import type { InboxThread } from '../src/shared/types'
import {
  dropTerminalReference,
  endTerminalReferenceDrag,
  moveTerminalReference,
  TERMINAL_DROP_ATTRIBUTE,
  TERMINAL_DROP_EVENT,
  TERMINAL_DROP_OVER_ATTRIBUTE,
} from '../src/renderer/terminal/reference-drag'
import type { ChatDraft, ChatDraftRequest, ChatMessage } from '../src/shared/types'
import { messageInput, setMessageText } from './helpers/chat-input'

const PANE = 'inbox-terminal:tab:default:pane:pane-2'
const REF = 'k3m9x2qavw'

let dispose: (() => void) | undefined
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => {
  await act(async () => dispose?.())
  dispose = undefined
  endTerminalReferenceDrag()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

async function render(element: ReturnType<typeof createElement>): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  dispose = () => root.unmount()
  await act(async () => root.render(element))
  return container
}

async function composer(api: Record<string, unknown>, fileScope?: { threadId: string }) {
  let draft: ChatDraft = { text: '', revision: 0, attachments: [] }
  const request = vi.fn(async (input: ChatDraftRequest) => {
    if (input.action === 'text') draft = { ...draft, text: input.text, revision: draft.revision + 1 }
    return draft
  })
  Object.defineProperty(window, 'api', { configurable: true, value: { chat: { draft: request }, ...api } })
  const container = await render(createElement(ChatComposer, {
    draftKey: 'draft:drf_one', agent: 'build', model: { id: 'm', providerId: 'p' },
    options: { status: 'ready', value: { agents: [], models: [], defaultModel: null, defaultAgent: null, skills: [] } },
    onAgentChange: () => {}, onModelChange: () => {}, onSend: async () => {}, ...(fileScope ? { fileScope } : {}),
  }))
  return { container, box: messageInput(container) }
}

function drop(target: Element, detail = { terminalId: PANE, title: 'Dev server', clientX: 0, clientY: 0 }): void {
  target.dispatchEvent(new CustomEvent(TERMINAL_DROP_EVENT, { detail }))
}

describe('dropping a terminal into the message box', () => {
  it('writes the pane\'s reference into the text, shown as a chip', async () => {
    const create = vi.fn(async () => ({ ref: REF, text: `[terminal:${REF} "Dev server"]` }))
    const { container, box } = await composer({ terminalReferences: { create } })
    await setMessageText(box, 'why does fail?', 'why does'.length)
    const target = container.querySelector(`[${TERMINAL_DROP_ATTRIBUTE}]`)!
    expect(target.getAttribute('data-testid')).toBe('chat-composer')

    // In the page the reference goes where it was dropped; happy-dom lays nothing out, so the point is the start.
    await act(async () => { drop(target) })
    await vi.waitFor(() => expect(box.state.doc.toString()).toBe(`[terminal:${REF} "Dev server"] why does fail?`))
    expect(create).toHaveBeenCalledWith({ terminalId: PANE, title: 'Dev server' })
    const chip = container.querySelector('[data-testid="chat-input-terminal"]')!
    expect(chip.textContent).toBe('Dev server')

    // Dropped where there is no text (the toolbar), it goes in at the caret, a space on either side.
    await setMessageText(box, 'see then', 'see'.length)
    vi.spyOn(box, 'posAtCoords').mockReturnValue(null)
    await act(async () => { drop(target) })
    await vi.waitFor(() => expect(box.state.doc.toString()).toBe(`see [terminal:${REF} "Dev server"] then`))
  })

  it('shows why when MDE could not make a reference', async () => {
    const create = vi.fn(async () => { throw new Error('That terminal is not running.') })
    const { container, box } = await composer({ terminalReferences: { create } })
    await act(async () => { drop(container.querySelector(`[${TERMINAL_DROP_ATTRIBUTE}]`)!) })
    await vi.waitFor(() => expect(container.textContent).toContain('That terminal is not running.'))
    expect(box.state.doc.toString()).toBe('')
  })
})

describe('the MDE MCP notice after a drop', () => {
  const create = vi.fn(async () => ({ ref: REF, text: `[terminal:${REF} "Dev server"]` }))
  const thread = { id: 'ses_one', target: { kind: 'wsl', distro: 'Ubuntu' } } as InboxThread

  it('says the agent cannot read the terminal without the MDE MCP, links to Settings, and goes with the chip', async () => {
    useWorkspace.setState({ inboxThreads: [thread] })
    const openSettings = vi.fn()
    useWorkspace.setState({ openSettings })
    const status = vi.fn(async () => ({ state: 'missing', file: '~/.config/opencode/opencode.jsonc', parseError: null }))
    const { container, box } = await composer({ terminalReferences: { create }, mdeMcp: { status } }, { threadId: 'ses_one' })
    await act(async () => { drop(container.querySelector(`[${TERMINAL_DROP_ATTRIBUTE}]`)!) })
    await vi.waitFor(() => expect(container.querySelector('[data-testid="chat-terminal-mcp-notice"]')?.textContent).toContain('not installed'))
    expect(status).toHaveBeenCalledWith({ kind: 'wsl', distro: 'Ubuntu' })
    await act(async () => { (container.querySelector('[data-testid="chat-terminal-mcp-settings"]') as HTMLButtonElement).click() })
    expect(openSettings).toHaveBeenCalledWith('opencode')

    await setMessageText(box, 'no terminal any more')
    expect(container.querySelector('[data-testid="chat-terminal-mcp-notice"]')).toBeNull()
  })

  it('says nothing when it is installed', async () => {
    useWorkspace.setState({ inboxThreads: [thread] })
    const status = vi.fn(async () => ({ state: 'installed', file: '~/x', parseError: null }))
    const { container, box } = await composer({ terminalReferences: { create }, mdeMcp: { status } }, { threadId: 'ses_one' })
    await act(async () => { drop(container.querySelector(`[${TERMINAL_DROP_ATTRIBUTE}]`)!) })
    await vi.waitFor(() => expect(status).toHaveBeenCalled())
    expect(box.state.doc.toString()).toContain(REF)
    expect(container.querySelector('[data-testid="chat-terminal-mcp-notice"]')).toBeNull()
  })
})

describe('a terminal in a sent message', () => {
  const message = (text: string): Extract<ChatMessage, { kind: 'user' }> => ({ kind: 'user', id: 'msg_1', text } as Extract<ChatMessage, { kind: 'user' }>)

  it('is a chip with the title, and the words as written stay in the page', async () => {
    const container = await render(createElement(UserBubble, { message: message(`look at [terminal:${REF} "Dev server"] please`) }))
    const chip = container.querySelector('[data-testid="chat-terminal-reference"]')!
    expect(chip.getAttribute('aria-label')).toBe('Terminal Dev server')
    expect(container.textContent).toBe(`look at Dev server[terminal:${REF} "Dev server"] please`)
  })

  it('brings the pane into view on a click, or says it was closed', async () => {
    const resolve = vi.fn(async () => ({ terminalId: useInboxTerminal.getState().layout.panes[0]!.terminalId }))
    vi.stubGlobal('api', { terminalReferences: { resolve } })
    const reveal = vi.fn()
    useInboxTerminal.setState({ reveal })
    const container = await render(createElement(UserBubble, { message: message(`[terminal:${REF} "Dev server"]`) }))
    await act(async () => { (container.querySelector('[data-testid="chat-terminal-reference"]') as HTMLButtonElement).click() })
    await vi.waitFor(() => expect(reveal).toHaveBeenCalledWith(useInboxTerminal.getState().layout.panes[0]!.terminalId))
    expect(resolve).toHaveBeenCalledWith({ ref: REF })
  })
})

describe('carrying a pane out of the terminal', () => {
  it('shows a chip by the pointer and lights the box under it, and hands the pane to that box', () => {
    const box = document.createElement('div')
    box.setAttribute(TERMINAL_DROP_ATTRIBUTE, '')
    const inner = document.createElement('span')
    box.append(inner)
    document.body.append(box)
    const received: unknown[] = []
    box.addEventListener(TERMINAL_DROP_EVENT, (event) => received.push((event as CustomEvent).detail))
    const at = vi.fn((x: number) => (x > 100 ? inner : document.body))
    document.elementFromPoint = at as typeof document.elementFromPoint

    moveTerminalReference('Dev server', 50, 50, false)
    const chip = document.querySelector('[data-testid="terminal-drag-chip"]')!
    expect(chip.textContent).toBe('Dev server')
    expect(box.hasAttribute(TERMINAL_DROP_OVER_ATTRIBUTE)).toBe(false)
    moveTerminalReference('Dev server', 150, 50, false)
    expect(box.hasAttribute(TERMINAL_DROP_OVER_ATTRIBUTE)).toBe(true)
    // Back over the terminal it is a swap again.
    moveTerminalReference('Dev server', 150, 50, true)
    expect(document.querySelector('[data-testid="terminal-drag-chip"]')).toBeNull()
    expect(box.hasAttribute(TERMINAL_DROP_OVER_ATTRIBUTE)).toBe(false)

    expect(dropTerminalReference({ terminalId: PANE, title: 'Dev server', clientX: 50, clientY: 50 })).toBe(false)
    expect(dropTerminalReference({ terminalId: PANE, title: 'Dev server', clientX: 150, clientY: 50 })).toBe(true)
    expect(received).toEqual([{ terminalId: PANE, title: 'Dev server', clientX: 150, clientY: 50 }])
  })
})
