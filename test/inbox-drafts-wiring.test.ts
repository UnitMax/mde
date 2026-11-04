// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ChatCreateRequest,
  ChatDraft,
  ChatDraftRequest,
  ChatDraftSummary,
  ChatMessagesPage,
  ChatOptions,
  InboxFolder,
  InboxThread,
} from '../src/shared/types'
import { InboxPanel } from '../src/renderer/components/InboxPanel'
import { InboxThreadView } from '../src/renderer/components/InboxThreadView'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useInboxDrafts } from '../src/renderer/store/inbox-drafts'
import { useInboxMcp } from '../src/renderer/store/inbox-mcp'
import { useWorkspace } from '../src/renderer/store/workspace'
import { messageInput, setMessageText } from './helpers/chat-input'

const roots: Root[] = []

const folder = (id: string, name: string): InboxFolder => ({
  id, name, directory: `/home/me/${name}`, target: { kind: 'native' }, createdAt: 1, lastActivityAt: 1, lastUsedAt: 1,
}) as InboxFolder
const app = folder('fld_app', 'app')
const docs = folder('fld_docs', 'docs')

const model = { id: 'free-1', providerId: 'opencode' }
const options: ChatOptions = {
  agents: [{ id: 'build', name: 'build' }],
  models: [{ id: 'free-1', providerId: 'opencode', providerName: 'OpenCode', name: 'Free' }],
  defaultModel: model,
  defaultAgent: 'build',
  skills: [],
}

const existing: InboxThread = {
  id: 'ses_one', title: 'Add numbers', directory: '/home/me/app', target: { kind: 'native' },
  branch: 'main', model, status: 'idle', createdAt: 1, lastActivityAt: Date.now(), readAt: Date.now(), archived: false, folderId: 'fld_app',
}
const created: InboxThread = { ...existing, id: 'ses_new', title: 'Fix the login' }

/** What the main process keeps: a draft's text and the folder it was written for. */
let kept: Map<string, { text: string; folderId?: string; updatedAt: number }>
let clock: number

const draft = vi.fn(async (request: ChatDraftRequest): Promise<ChatDraft> => {
  const current = kept.get(request.key)
  if (request.action === 'text') {
    clock += 1
    kept.set(request.key, { text: request.text, folderId: request.folderId ?? current?.folderId, updatedAt: clock })
  }
  if ((request.action === 'load' || request.action === 'flush') && current && request.folderId) kept.set(request.key, { ...current, folderId: request.folderId })
  if (request.action === 'clear') kept.delete(request.key)
  return { text: kept.get(request.key)?.text ?? '', revision: 1, attachments: [] }
})
const drafts = vi.fn(async (): Promise<ChatDraftSummary[]> =>
  [...kept.entries()]
    .filter(([key, entry]) => key.startsWith('draft:') && entry.folderId && entry.text.trim())
    .map(([key, entry]) => ({ id: key.slice('draft:'.length), folderId: entry.folderId!, preview: entry.text, attachments: 0, updatedAt: entry.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt))
const create = vi.fn(async (request: ChatCreateRequest): Promise<InboxThread> => {
  kept.delete(`draft:${request.draftId}`)
  return created
})
const setComposer = vi.fn(async (composer: unknown) => composer)
const page: ChatMessagesPage = { messages: [], older: null, running: false, pending: [] }

const api = () => ({
  inbox: {
    setRead: vi.fn(async () => null),
    folders: vi.fn(async () => ({ folders: [app, docs], composer: { folderId: 'fld_app' } })),
    gitInfo: vi.fn(async () => ({ repository: false, branch: null, branches: [] })),
    setComposer,
    changes: vi.fn(),
    setArchived: vi.fn(async () => null),
    remove: vi.fn(),
  },
  clipboard: { writeText: vi.fn(async () => undefined), paste: vi.fn(async () => undefined) },
  chat: {
    draft,
    drafts,
    create,
    options: vi.fn(async () => options),
    messages: vi.fn(async () => page),
    requests: vi.fn(async () => ({ permissions: [], forms: [] })),
    subscribe: vi.fn(async () => undefined),
    unsubscribe: vi.fn(async () => undefined),
  },
})

async function render(element: Parameters<Root['render']>[0]): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(element))
  return container
}

const q = (selector: string): HTMLElement | null => document.body.querySelector<HTMLElement>(selector)
const page_ = (): { id: string; opened: boolean } => useInboxDrafts.getState().page
const keyOf = (): `draft:${string}` => `draft:${page_().id}`
const text = (): string => messageInput(document.body).state.doc.toString()
const select = async (id: string | null): Promise<void> => { await act(async () => useWorkspace.getState().selectInboxThread(id)) }
const settle = async (): Promise<void> => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }) }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.stubGlobal('api', api())
  for (const mock of [draft, drafts, create, setComposer]) mock.mockClear()
  kept = new Map()
  clock = 1_000
  useInboxMcp.setState({ entries: {} })
  useWorkspace.setState({
    platform: { platform: 'darwin', isWindows: false },
    inboxThreads: [existing],
    selectedInboxThreadId: null,
    activeWorkspaceView: 'inbox',
    inboxMarkedUnread: {},
    inboxCues: {},
  })
  useInboxChat.setState({
    folders: [app, docs], composer: { folderId: 'fld_app' }, foldersLoaded: true,
    options: {}, threads: {}, recent: [], titleRegenerations: {},
  })
  useInboxDrafts.setState({ drafts: [], page: { id: 'drf_first', opened: false } })
})
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('The new-thread page and its draft', () => {
  it('writes into a draft of its own, and says which folder it is for', async () => {
    await render(createElement(InboxThreadView))
    await vi.waitFor(() => expect(draft).toHaveBeenCalled())
    expect(draft).toHaveBeenCalledWith({ key: 'draft:drf_first', action: 'load', folderId: 'fld_app' })
    // Not the old draft of the folder.
    expect(draft.mock.calls.every(([request]) => request.key === 'draft:drf_first')).toBe(true)
    await setMessageText(messageInput(document.body), 'Fix the login')
    expect(draft).toHaveBeenCalledWith({ key: 'draft:drf_first', action: 'text', text: 'Fix the login', folderId: 'fld_app' })
  })

  it('keeps what is typed when the folder is changed, and moves the draft to the new folder', async () => {
    await render(createElement(InboxThreadView))
    await vi.waitFor(() => expect(q('[data-testid="chat-input"] .cm-content')).not.toBeNull())
    await setMessageText(messageInput(document.body), 'Fix the login')
    draft.mockClear()
    await act(async () => useInboxChat.getState().setComposer({ folderId: 'fld_docs' }))
    await vi.waitFor(() => expect(draft).toHaveBeenCalledWith({ key: 'draft:drf_first', action: 'flush', folderId: 'fld_docs' }))
    expect(text()).toBe('Fix the login')
    expect(kept.get('draft:drf_first')?.folderId).toBe('fld_docs')
    // The same box went on, so nothing was read again for another draft.
    expect(draft.mock.calls.filter(([request]) => request.action === 'load')).toEqual([])
    await setMessageText(messageInput(document.body), 'Fix the login page')
    expect(draft).toHaveBeenLastCalledWith({ key: 'draft:drf_first', action: 'text', text: 'Fix the login page', folderId: 'fld_docs' })
  })

  it('makes what was typed a draft of the sidebar’s when the page is left, and starts the next visit blank', async () => {
    await render(createElement(InboxThreadView))
    await vi.waitFor(() => expect(q('[data-testid="chat-input"] .cm-content')).not.toBeNull())
    await setMessageText(messageInput(document.body), 'Fix the login')
    expect(useInboxDrafts.getState().drafts).toEqual([])
    await select('ses_one')
    expect(page_()).not.toEqual({ id: 'drf_first', opened: false })
    expect(page_().opened).toBe(false)
    await vi.waitFor(() => expect(useInboxDrafts.getState().drafts.map((entry) => entry.id)).toEqual(['drf_first']))
    expect(useInboxDrafts.getState().drafts[0]).toMatchObject({ folderId: 'fld_app', preview: 'Fix the login' })
    // Back on the page: a blank box, for another draft.
    await select(null)
    await vi.waitFor(() => expect(q('[data-testid="chat-input"] .cm-content')).not.toBeNull())
    await vi.waitFor(() => expect(draft).toHaveBeenCalledWith({ key: keyOf(), action: 'load', folderId: 'fld_app' }))
    expect(keyOf()).not.toBe('draft:drf_first')
    expect(text()).toBe('')
  })

  it('leaves a page where nothing was typed out of the list', async () => {
    await render(createElement(InboxThreadView))
    await vi.waitFor(() => expect(draft).toHaveBeenCalled())
    await select('ses_one')
    await settle()
    expect(useInboxDrafts.getState().drafts).toEqual([])
  })

  it('shows a draft taken from the list, in its folder, to carry on with', async () => {
    kept.set('draft:drf_old', { text: 'Rewrite the parser', folderId: 'fld_docs', updatedAt: 500 })
    await render(createElement('div', null, createElement(InboxPanel), createElement(InboxThreadView)))
    await vi.waitFor(() => expect(q('[data-testid="inbox-draft-drf_old"]')).not.toBeNull())
    await act(async () => q('[data-testid="inbox-draft-drf_old"]')!.click())
    await vi.waitFor(() => expect(draft).toHaveBeenCalledWith({ key: 'draft:drf_old', action: 'load', folderId: 'fld_docs' }))
    await vi.waitFor(() => expect(text()).toBe('Rewrite the parser'))
    expect(useInboxChat.getState().composer.folderId).toBe('fld_docs')
    expect(q('[data-testid="inbox-folder-picker"]')?.textContent).toContain('docs')
    // More typed there goes to the same draft.
    await setMessageText(messageInput(document.body), 'Rewrite the parser in Rust')
    expect(draft).toHaveBeenLastCalledWith({ key: 'draft:drf_old', action: 'text', text: 'Rewrite the parser in Rust', folderId: 'fld_docs' })
    expect(q('[data-testid="inbox-draft-drf_old"]')?.getAttribute('aria-current')).toBe('true')
  })

  it('has New thread set aside what is typed and show a blank page, with the first kept in the list', async () => {
    await render(createElement('div', null, createElement(InboxPanel), createElement(InboxThreadView)))
    await vi.waitFor(() => expect(q('[data-testid="chat-input"] .cm-content')).not.toBeNull())
    await setMessageText(messageInput(document.body), 'Fix the login')
    expect(q('[data-testid="inbox-drafts-section"]')).toBeNull()
    await act(async () => q('[data-testid="inbox-new-thread-button"]')!.click())
    await vi.waitFor(() => expect(q('[data-testid="inbox-draft-drf_first"]')).not.toBeNull())
    await vi.waitFor(() => expect(text()).toBe(''))
    expect(page_().id).not.toBe('drf_first')
    // The old one is a click away, and the blank page does not disturb it.
    await setMessageText(messageInput(document.body), 'Second idea')
    expect(kept.get('draft:drf_first')?.text).toBe('Fix the login')
    expect(kept.get(keyOf())?.text).toBe('Second idea')
    await act(async () => q('[data-testid="inbox-new-thread-button"]')!.click())
    await vi.waitFor(() => expect(Array.from(document.body.querySelectorAll('[data-testid^="inbox-draft-drf_"]')).filter((row) => !/-delete-/.test(row.getAttribute('data-testid')!))).toHaveLength(2))
    await act(async () => q('[data-testid="inbox-draft-drf_first"]')!.click())
    await vi.waitFor(() => expect(text()).toBe('Fix the login'))
  })

  it('starts the thread from the draft, which is then gone from the list', async () => {
    await render(createElement('div', null, createElement(InboxPanel), createElement(InboxThreadView)))
    await vi.waitFor(() => expect(q('[data-testid="chat-input"] .cm-content')).not.toBeNull())
    await vi.waitFor(() => expect(q('[aria-label="Send"]')).not.toBeNull())
    await setMessageText(messageInput(document.body), 'Fix the login')
    // A draft taken from the list is spent the same way.
    const id = page_().id
    await vi.waitFor(() => expect((q('[aria-label="Send"]') as HTMLButtonElement).disabled).toBe(false))
    await act(async () => q('[aria-label="Send"]')!.click())
    await vi.waitFor(() => expect(create).toHaveBeenCalled())
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'fld_app', text: 'Fix the login', draftId: id }))
    await vi.waitFor(() => expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_new'))
    await vi.waitFor(() => expect(page_().id).not.toBe(id))
    await settle()
    expect(useInboxDrafts.getState().drafts).toEqual([])
    expect(q('[data-testid="inbox-drafts-section"]')).toBeNull()
  })
})
