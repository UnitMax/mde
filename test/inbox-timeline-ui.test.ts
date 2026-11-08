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
    branch: 'main', model, status: 'idle',
    createdAt: 1, lastActivityAt: Date.now(), readAt: Date.now(), archived: false, folderId: 'fld_app',
  }
}

const prompt = (id: string, text: string, time: number): ChatMessage => ({ kind: 'user', id, time, text })
const answer = (id: string, time: number): ChatMessage =>
  ({ kind: 'assistant', id, time, agent: 'build', model, completed: true, parts: [{ kind: 'text', text: `Answer ${id}` }] })

const conversation: ChatMessage[] = [
  prompt('msg_1', 'Fix the login', 1),
  answer('msg_2', 2),
  prompt('msg_3', 'Now the logout\nand the redirect', 3),
  answer('msg_4', 4),
  prompt('msg_5', 'Add a test', 5),
  answer('msg_6', 6),
]

let page: ChatMessagesPage
const api = {
  inbox: {
    setRead: vi.fn(async () => null),
    folders: vi.fn(async () => ({ folders: [folder], composer: {} })),
    gitInfo: vi.fn(async () => ({ repository: false, branch: null, branches: [] })),
  },
  clipboard: { writeText: vi.fn(async () => undefined), paste: vi.fn(async () => undefined) },
  chat: {
    draft: vi.fn(async (req: { text?: string }) => ({ text: req.text ?? '', revision: 1, attachments: [] })),
    options: vi.fn(() => new Promise(() => {})),
    messages: vi.fn(async (): Promise<ChatMessagesPage> => page),
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

const byId = (id: string): HTMLElement | null => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const transcript = (): HTMLElement => byId('chat-transcript')!

/** happy-dom does no layout: these are the numbers the component reads, put in by hand. */
function layout(scroller: HTMLElement, metrics: { scrollHeight: number; clientHeight: number; scrollTop: number }, tops: Record<string, number>): { scrollTo: ReturnType<typeof vi.fn> } {
  const scrollTo = vi.fn()
  Object.assign(scroller, { scrollTo })
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => metrics.scrollHeight })
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => metrics.clientHeight })
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => metrics.scrollTop, set: (value: number) => { metrics.scrollTop = value } })
  scroller.getBoundingClientRect = () => ({ top: 0, bottom: metrics.clientHeight, left: 0, right: 600, width: 600, height: metrics.clientHeight, x: 0, y: 0, toJSON: () => ({}) })
  scroller.querySelectorAll<HTMLElement>('[data-chat-message]').forEach((element) => {
    const top = (tops[element.dataset.chatMessage!] ?? 0) - metrics.scrollTop
    element.getBoundingClientRect = () => ({ top, bottom: top + 60, left: 0, right: 600, width: 600, height: 60, x: 0, y: top, toJSON: () => ({}) })
  })
  return { scrollTo }
}

async function scrolled(scroller: HTMLElement): Promise<void> {
  await act(async () => {
    scroller.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
  })
}

const key = (target: Element, name: string): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('api', api)
  page = { messages: conversation, older: null, running: false, pending: [] }
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
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('prompt timeline', () => {
  it('has one mark for each of the user\'s prompts', async () => {
    await render()
    expect(byId('chat-timeline')).not.toBeNull()
    const marks = Array.from(document.body.querySelectorAll('[data-testid^="chat-timeline-mark-"]')).map((mark) => mark.getAttribute('data-testid'))
    expect(marks).toEqual(['chat-timeline-mark-msg_1', 'chat-timeline-mark-msg_3', 'chat-timeline-mark-msg_5'])
  })

  it('is left out while the conversation has a single prompt', async () => {
    page = { ...page, messages: conversation.slice(0, 2) }
    await render()
    expect(byId('chat-timeline')).toBeNull()
  })

  it('grows into a list of the prompts when the pointer is over it, and shrinks back when it leaves', async () => {
    await render()
    expect(byId('chat-timeline-card')).toBeNull()
    const rail = byId('chat-timeline-trigger')!.parentElement!
    await act(async () => { rail.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
    const card = byId('chat-timeline-card')!
    expect(card).not.toBeNull()
    expect(Array.from(card.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent)).toEqual(['Fix the login', 'Now the logout', 'Add a test'])
    await act(async () => { rail.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })) })
    expect(byId('chat-timeline-card')).toBeNull()
  })

  it('jumps to a prompt, leaving a margin above it', async () => {
    await render()
    const { scrollTo } = layout(transcript(), { scrollHeight: 3000, clientHeight: 600, scrollTop: 2400 }, { msg_1: 0, msg_3: 900, msg_5: 1800 })
    await act(async () => { byId('chat-timeline-trigger')!.parentElement!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
    await act(async () => { byId('chat-timeline-item-msg_3')!.click() })
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: 900 - 16, behavior: 'smooth' })
  })

  it('does not scroll past the end for a prompt that is near it', async () => {
    await render()
    const { scrollTo } = layout(transcript(), { scrollHeight: 2000, clientHeight: 600, scrollTop: 0 }, { msg_1: 0, msg_3: 900, msg_5: 1700 })
    await act(async () => { byId('chat-timeline-trigger')!.parentElement!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
    await act(async () => { byId('chat-timeline-item-msg_5')!.click() })
    expect(scrollTo).toHaveBeenCalledWith({ top: 1400, behavior: 'smooth' })
  })

  it('is operated from the keyboard: Down opens it on the turn being read, arrows move, Enter jumps, Escape closes', async () => {
    await render()
    const trigger = byId('chat-timeline-trigger')!
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    const { scrollTo } = layout(transcript(), { scrollHeight: 3000, clientHeight: 600, scrollTop: 2400 }, { msg_1: 0, msg_3: 900, msg_5: 1800 })
    await scrolled(transcript())
    trigger.focus()
    await act(async () => key(trigger, 'ArrowDown'))
    expect(byId('chat-timeline-card')).not.toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    // At the end of the conversation the reader is in the last turn.
    expect(document.activeElement).toBe(byId('chat-timeline-item-msg_5'))
    expect(byId('chat-timeline-item-msg_5')!.getAttribute('aria-current')).toBe('location')

    await act(async () => key(document.activeElement!, 'ArrowUp'))
    expect(document.activeElement).toBe(byId('chat-timeline-item-msg_3'))
    await act(async () => key(document.activeElement!, 'Home'))
    expect(document.activeElement).toBe(byId('chat-timeline-item-msg_1'))
    await act(async () => key(document.activeElement!, 'End'))
    expect(document.activeElement).toBe(byId('chat-timeline-item-msg_5'))
    await act(async () => key(document.activeElement!, 'ArrowUp'))
    await act(async () => byId('chat-timeline-item-msg_3')!.click())
    expect(scrollTo).toHaveBeenCalledWith({ top: 884, behavior: 'smooth' })

    await act(async () => key(document.activeElement!, 'Escape'))
    expect(byId('chat-timeline-card')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('follows the reader through the conversation', async () => {
    await render()
    const metrics = { scrollHeight: 3000, clientHeight: 600, scrollTop: 0 }
    layout(transcript(), metrics, { msg_1: 20, msg_3: 900, msg_5: 1800 })
    await scrolled(transcript())
    const state = (id: string): string | null => byId(`chat-timeline-mark-${id}`)!.getAttribute('data-state')
    expect(state('msg_1')).toBe('current')
    expect(state('msg_3')).toBe('idle')

    // Scrolled so that the second prompt has reached the reading line (35% of the view) and the first is gone.
    metrics.scrollTop = 800
    layout(transcript(), metrics, { msg_1: 20, msg_3: 900, msg_5: 1800 })
    await scrolled(transcript())
    expect(state('msg_1')).toBe('idle')
    expect(state('msg_3')).toBe('current')
    expect(state('msg_5')).toBe('idle')

    // The first prompt of the two on screen is still lit while the reader is in the next turn.
    metrics.scrollTop = 1400
    layout(transcript(), metrics, { msg_1: 20, msg_3: 1500, msg_5: 1800 })
    await scrolled(transcript())
    expect(state('msg_3')).toBe('current')
    expect(state('msg_5')).toBe('visible')
  })
})

describe('scroll to bottom', () => {
  it('is offered only while the conversation is scrolled up, and takes the reader to the end', async () => {
    await render()
    expect(byId('chat-scroll-to-bottom')).toBeNull()

    const metrics = { scrollHeight: 3000, clientHeight: 600, scrollTop: 1000 }
    const { scrollTo } = layout(transcript(), metrics, {})
    await scrolled(transcript())
    const button = byId('chat-scroll-to-bottom')!
    expect(button).not.toBeNull()
    expect(button.textContent).toBe('Scroll to bottom')

    await act(async () => button.click())
    expect(scrollTo).toHaveBeenCalledWith({ top: 3000, behavior: 'smooth' })

    // Arriving at the end takes it away again.
    metrics.scrollTop = 2400
    await scrolled(transcript())
    expect(byId('chat-scroll-to-bottom')).toBeNull()
  })

  it('stays out of the way near the end', async () => {
    await render()
    layout(transcript(), { scrollHeight: 3000, clientHeight: 600, scrollTop: 2350 }, {})
    await scrolled(transcript())
    expect(byId('chat-scroll-to-bottom')).toBeNull()
  })
})
