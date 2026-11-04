// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ChatCreateRequest,
  ChatDraft,
  ChatDraftRequest,
  ChatDraftChoice,
  ChatDraftList,
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
import { messageInput, pressMessageKey, setMessageText } from './helpers/chat-input'

const roots: Root[] = []

const folder = (id: string, name: string): InboxFolder => ({
  id, name, directory: `/home/me/${name}`, target: { kind: 'native' }, createdAt: 1, lastActivityAt: 1, lastUsedAt: 1,
}) as InboxFolder
const app = folder('fld_app', 'app')
const docs = folder('fld_docs', 'docs')

const model = { id: 'free-1', providerId: 'opencode' }
const paid = { id: 'paid-1', providerId: 'opencode' }
const options: ChatOptions = {
  agents: [{ id: 'build', name: 'Build' }, { id: 'plan', name: 'Plan' }],
  models: [
    { id: 'free-1', providerId: 'opencode', providerName: 'OpenCode', name: 'Free' },
    { id: 'paid-1', providerId: 'opencode', providerName: 'OpenCode', name: 'Paid' },
  ],
  defaultModel: model,
  defaultAgent: 'build',
  skills: [],
}
const repo = {
  repository: true,
  branch: 'main',
  branches: [{ name: 'main', remote: false }, { name: 'feature/login', remote: false }],
}

const existing: InboxThread = {
  id: 'ses_one', title: 'Add numbers', directory: '/home/me/app', target: { kind: 'native' },
  branch: 'main', model, status: 'idle', createdAt: 1, lastActivityAt: Date.now(), readAt: Date.now(), archived: false, folderId: 'fld_app',
}
const created: InboxThread = { ...existing, id: 'ses_new', title: 'Fix the login' }

/** What the main process keeps: a draft's text and the folder it was written for. */
let kept: Map<string, { text: string; folderId?: string; choice?: ChatDraftChoice; updatedAt: number }>
let clock: number

const draft = vi.fn(async (request: ChatDraftRequest): Promise<ChatDraft> => {
  const current = kept.get(request.key)
  if (request.action === 'text') {
    clock += 1
    kept.set(request.key, { text: request.text, folderId: request.folderId ?? current?.folderId, choice: request.choice ?? current?.choice, updatedAt: clock })
  }
  if ((request.action === 'load' || request.action === 'flush') && current && request.folderId) {
    kept.set(request.key, { ...current, folderId: request.folderId, choice: request.choice ?? current.choice })
  }
  if (request.action === 'clear') kept.delete(request.key)
  return { text: kept.get(request.key)?.text ?? '', revision: 1, attachments: [] }
})
const drafts = vi.fn(async (): Promise<ChatDraftList> => ({
  drafts: [...kept.entries()]
    .filter(([key, entry]) => key.startsWith('draft:') && entry.folderId && entry.text.trim())
    .map(([key, entry]) => ({ id: key.slice('draft:'.length), folderId: entry.folderId!, preview: entry.text, attachments: 0, updatedAt: entry.updatedAt, ...(entry.choice ? { choice: entry.choice } : {}) }))
    .sort((a, b) => b.updatedAt - a.updatedAt),
  threads: [...kept.entries()].filter(([key, entry]) => key.startsWith('thread:') && entry.text.trim()).map(([key]) => key.slice('thread:'.length)),
}))
const create = vi.fn(async (request: ChatCreateRequest): Promise<InboxThread> => {
  kept.delete(`draft:${request.draftId}`)
  return created
})
const setComposer = vi.fn(async (composer: unknown) => composer)
const page: ChatMessagesPage = { messages: [], older: null, running: false, pending: [] }
let git: { repository: boolean; branch: string | null; branches: { name: string; remote: boolean }[] }

const api = () => ({
  inbox: {
    setRead: vi.fn(async () => null),
    folders: vi.fn(async () => ({ folders: [app, docs], composer: { folderId: 'fld_app' } })),
    gitInfo: vi.fn(async () => git),
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
/** Radix opens its menus on a pointer press; the keyboard route is what happy-dom supports reliably. */
const openMenu = async (trigger: Element): Promise<void> => {
  await act(async () => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
}
const chooseItem = async (label: string): Promise<void> => {
  const item = await vi.waitFor(() => {
    const found = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((entry) => entry.textContent?.includes(label))
    expect(found).toBeDefined()
    return found!
  })
  await act(async () => item.click())
}
/** Waits until the page knows its agent and model, which is when a draft is told how the thread would start. */
const pickersReady = async (): Promise<void> => {
  await vi.waitFor(() => expect(q('[data-testid="chat-model-picker"]')?.textContent).toContain('Free'))
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.stubGlobal('api', api())
  for (const mock of [draft, drafts, create, setComposer]) mock.mockClear()
  kept = new Map()
  clock = 1_000
  git = { repository: false, branch: null, branches: [] }
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
    expect(draft).toHaveBeenCalledWith(expect.objectContaining({ key: 'draft:drf_first', action: 'load', folderId: 'fld_app' }))
    // Not the old draft of the folder.
    expect(draft.mock.calls.every(([request]) => request.key === 'draft:drf_first')).toBe(true)
    await setMessageText(messageInput(document.body), 'Fix the login')
    expect(draft).toHaveBeenCalledWith(expect.objectContaining({ key: 'draft:drf_first', action: 'text', text: 'Fix the login', folderId: 'fld_app' }))
  })

  it('keeps what is typed when the folder is changed, and moves the draft to the new folder', async () => {
    await render(createElement(InboxThreadView))
    await vi.waitFor(() => expect(q('[data-testid="chat-input"] .cm-content')).not.toBeNull())
    await setMessageText(messageInput(document.body), 'Fix the login')
    draft.mockClear()
    await act(async () => useInboxChat.getState().setComposer({ folderId: 'fld_docs' }))
    await vi.waitFor(() => expect(draft).toHaveBeenCalledWith(expect.objectContaining({ key: 'draft:drf_first', action: 'flush', folderId: 'fld_docs' })))
    expect(text()).toBe('Fix the login')
    expect(kept.get('draft:drf_first')?.folderId).toBe('fld_docs')
    // The same box went on, so nothing was read again for another draft.
    expect(draft.mock.calls.filter(([request]) => request.action === 'load')).toEqual([])
    await setMessageText(messageInput(document.body), 'Fix the login page')
    expect(draft).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'draft:drf_first', action: 'text', text: 'Fix the login page', folderId: 'fld_docs' }))
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
    await vi.waitFor(() => expect(draft).toHaveBeenCalledWith(expect.objectContaining({ key: keyOf(), action: 'load', folderId: 'fld_app' })))
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
    await vi.waitFor(() => expect(draft).toHaveBeenCalledWith(expect.objectContaining({ key: 'draft:drf_old', action: 'load', folderId: 'fld_docs' })))
    await vi.waitFor(() => expect(text()).toBe('Rewrite the parser'))
    expect(useInboxChat.getState().composer.folderId).toBe('fld_docs')
    expect(q('[data-testid="inbox-folder-picker"]')?.textContent).toContain('docs')
    // More typed there goes to the same draft.
    await setMessageText(messageInput(document.body), 'Rewrite the parser in Rust')
    expect(draft).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'draft:drf_old', action: 'text', text: 'Rewrite the parser in Rust', folderId: 'fld_docs' }))
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

const withSidebar = (): ReturnType<typeof createElement> => createElement('div', null, createElement(InboxPanel), createElement(InboxThreadView))

describe('How a draft would start', () => {
  it('is told to the draft once the agent and model are known, and not before', async () => {
    await render(createElement(InboxThreadView))
    await vi.waitFor(() => expect(draft).toHaveBeenCalled())
    // The first thing asked, before OpenCode has said what there is to choose from, carries no choice.
    expect(draft.mock.calls[0]![0]).not.toHaveProperty('choice')
    await pickersReady()
    await setMessageText(messageInput(document.body), 'Fix the login')
    expect(draft).toHaveBeenLastCalledWith({ key: 'draft:drf_first', action: 'text', text: 'Fix the login', folderId: 'fld_app', choice: { agent: 'build', model } })
    expect(kept.get('draft:drf_first')?.choice).toEqual({ agent: 'build', model })
  })

  it('follows the agent and the model when they are picked, with nothing else changed', async () => {
    await render(createElement(InboxThreadView))
    await pickersReady()
    await setMessageText(messageInput(document.body), 'Fix the login')
    draft.mockClear()
    await openMenu(q('[data-testid="chat-agent-picker"]')!)
    await chooseItem('Plan')
    await vi.waitFor(() => expect(draft).toHaveBeenCalledWith(expect.objectContaining({ key: 'draft:drf_first', action: 'flush', choice: { agent: 'plan', model } })))
    expect(kept.get('draft:drf_first')).toMatchObject({ text: 'Fix the login', choice: { agent: 'plan', model } })
    await openMenu(q('[data-testid="chat-model-picker"]')!)
    await chooseItem('Paid')
    await vi.waitFor(() => expect(kept.get('draft:drf_first')?.choice).toEqual({ agent: 'plan', model: paid }))
  })

  it('brings a draft’s agent and model back when it is opened, whatever was chosen last elsewhere', async () => {
    kept.set('draft:drf_plan', { text: 'Plan the migration', folderId: 'fld_app', choice: { agent: 'plan', model: paid }, updatedAt: 900 })
    kept.set('draft:drf_build', { text: 'Fix the bug', folderId: 'fld_app', choice: { agent: 'build', model }, updatedAt: 800 })
    await render(withSidebar())
    await vi.waitFor(() => expect(q('[data-testid="inbox-draft-drf_plan"]')).not.toBeNull())
    await act(async () => q('[data-testid="inbox-draft-drf_plan"]')!.click())
    await vi.waitFor(() => expect(q('[data-testid="chat-agent-picker"]')?.textContent).toContain('Plan'))
    expect(q('[data-testid="chat-model-picker"]')?.textContent).toContain('Paid')
    await vi.waitFor(() => expect(text()).toBe('Plan the migration'))
    // The next one has its own, though the last pick elsewhere was Plan.
    useInboxChat.getState().setComposer({ agent: 'plan', model: paid })
    await act(async () => q('[data-testid="inbox-draft-drf_build"]')!.click())
    await vi.waitFor(() => expect(q('[data-testid="chat-agent-picker"]')?.textContent).toContain('Build'))
    expect(q('[data-testid="chat-model-picker"]')?.textContent).toContain('Free')
    // Typing there keeps its choice, and the first one is left as it was.
    await vi.waitFor(() => expect(text()).toBe('Fix the bug'))
    await setMessageText(messageInput(document.body), 'Fix the bug today')
    expect(kept.get('draft:drf_build')?.choice).toEqual({ agent: 'build', model })
    expect(kept.get('draft:drf_plan')?.choice).toEqual({ agent: 'plan', model: paid })
  })

  it('leaves a draft without a choice following the last one made, and a blank page too', async () => {
    kept.set('draft:drf_old', { text: 'Before choices were kept', folderId: 'fld_app', updatedAt: 900 })
    useInboxChat.setState({ composer: { folderId: 'fld_app', agent: 'plan', model: paid } })
    await render(withSidebar())
    await vi.waitFor(() => expect(q('[data-testid="inbox-draft-drf_old"]')).not.toBeNull())
    await vi.waitFor(() => expect(q('[data-testid="chat-agent-picker"]')?.textContent).toContain('Plan'))
    await act(async () => q('[data-testid="inbox-draft-drf_old"]')!.click())
    await vi.waitFor(() => expect(text()).toBe('Before choices were kept'))
    expect(q('[data-testid="chat-agent-picker"]')?.textContent).toContain('Plan')
    expect(q('[data-testid="chat-model-picker"]')?.textContent).toContain('Paid')
  })

  it('falls back to the defaults for an agent or a model that OpenCode no longer offers', async () => {
    kept.set('draft:drf_gone', { text: 'Old', folderId: 'fld_app', choice: { agent: 'retired', model: { id: 'old-model', providerId: 'opencode' } }, updatedAt: 900 })
    await render(withSidebar())
    await vi.waitFor(() => expect(q('[data-testid="inbox-draft-drf_gone"]')).not.toBeNull())
    await act(async () => q('[data-testid="inbox-draft-drf_gone"]')!.click())
    await vi.waitFor(() => expect(text()).toBe('Old'))
    expect(q('[data-testid="chat-agent-picker"]')?.textContent).toContain('Build')
    expect(q('[data-testid="chat-model-picker"]')?.textContent).toContain('Free')
    // What the draft now says is what is shown.
    await vi.waitFor(() => expect(kept.get('draft:drf_gone')?.choice).toEqual({ agent: 'build', model }))
  })

  describe('in a new worktree', () => {
    const modePicker = (): HTMLElement | null => q('[data-testid="worktree-mode-picker"]')
    const branchPicker = (): HTMLElement | null => q('[data-testid="worktree-branch-picker"]')
    const branchName = (): HTMLInputElement => q('[data-testid="worktree-branch-name"]') as HTMLInputElement

    it('is remembered with the draft once chosen, with the branch it is cut from and the name typed', async () => {
      git = repo
      await render(createElement(InboxThreadView))
      await vi.waitFor(() => expect(modePicker()).not.toBeNull())
      await pickersReady()
      await setMessageText(messageInput(document.body), 'Fix the login')
      expect(kept.get('draft:drf_first')?.choice).toEqual({ agent: 'build', model })
      await openMenu(modePicker()!)
      await chooseItem('New worktree')
      await vi.waitFor(() => expect(kept.get('draft:drf_first')?.choice).toEqual({ agent: 'build', model, worktree: { base: 'main' } }))
      await openMenu(branchPicker()!)
      await chooseItem('feature/login')
      await vi.waitFor(() => expect(kept.get('draft:drf_first')?.choice?.worktree).toEqual({ base: 'feature/login' }))
      // A name that is not a branch name yet is kept as typed, and saving the text goes on.
      const input = branchName()
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'topic/')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await vi.waitFor(() => expect(kept.get('draft:drf_first')?.choice?.worktree).toEqual({ base: 'feature/login', branch: 'topic/' }))
      // Back in the folder itself, the draft says so.
      await openMenu(modePicker()!)
      await chooseItem('Current directory')
      await vi.waitFor(() => expect(kept.get('draft:drf_first')?.choice).toEqual({ agent: 'build', model }))
    })

    it('comes back when the draft is opened, and the page that follows starts in the folder', async () => {
      git = repo
      kept.set('draft:drf_tree', { text: 'Try it on a branch', folderId: 'fld_app', choice: { agent: 'build', model, worktree: { base: 'feature/login', branch: 'topic/x' } }, updatedAt: 900 })
      await render(withSidebar())
      await vi.waitFor(() => expect(q('[data-testid="inbox-draft-worktree-drf_tree"]')).not.toBeNull())
      expect(q('[data-testid="inbox-draft-worktree-drf_tree"]')?.getAttribute('title')).toContain('feature/login')
      await vi.waitFor(() => expect(modePicker()?.textContent).toBe('Current directory'))
      await act(async () => q('[data-testid="inbox-draft-drf_tree"]')!.click())
      await vi.waitFor(() => expect(modePicker()?.textContent).toBe('New worktree'))
      expect(branchPicker()?.textContent).toBe('From feature/login')
      expect(branchName().value).toBe('topic/x')
      await vi.waitFor(() => expect(text()).toBe('Try it on a branch'))
      // Sending starts the thread there.
      await pickersReady()
      await vi.waitFor(() => expect((q('[aria-label="Send"]') as HTMLButtonElement).disabled).toBe(false))
      await act(async () => q('[aria-label="Send"]')!.click())
      await vi.waitFor(() => expect(create).toHaveBeenCalled())
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ draftId: 'drf_tree', worktree: { base: 'feature/login', branch: 'topic/x' } }))
    })

    it('starts a blank page in the folder itself, however the last one was set up', async () => {
      git = repo
      kept.set('draft:drf_tree', { text: 'Try it on a branch', folderId: 'fld_app', choice: { agent: 'build', model, worktree: { base: 'main' } }, updatedAt: 900 })
      await render(withSidebar())
      await vi.waitFor(() => expect(q('[data-testid="inbox-draft-drf_tree"]')).not.toBeNull())
      await act(async () => q('[data-testid="inbox-draft-drf_tree"]')!.click())
      await vi.waitFor(() => expect(modePicker()?.textContent).toBe('New worktree'))
      await act(async () => q('[data-testid="inbox-new-thread-button"]')!.click())
      await vi.waitFor(() => expect(modePicker()?.textContent).toBe('Current directory'))
      expect(kept.get('draft:drf_tree')?.choice?.worktree).toEqual({ base: 'main' })
    })

    it('uses Git’s default when the branch it was cut from is gone, and keeps the draft’s word until changed', async () => {
      git = repo
      kept.set('draft:drf_tree', { text: 'Try it', folderId: 'fld_app', choice: { agent: 'build', model, worktree: { base: 'deleted-branch' } }, updatedAt: 900 })
      await render(withSidebar())
      await vi.waitFor(() => expect(q('[data-testid="inbox-draft-drf_tree"]')).not.toBeNull())
      await act(async () => q('[data-testid="inbox-draft-drf_tree"]')!.click())
      await vi.waitFor(() => expect(branchPicker()?.textContent).toBe('From main'))
    })

    it('is dropped when the page is given another folder, whose branches are others', async () => {
      git = repo
      kept.set('draft:drf_tree', { text: 'Try it', folderId: 'fld_app', choice: { agent: 'build', model, worktree: { base: 'feature/login' } }, updatedAt: 900 })
      await render(withSidebar())
      await vi.waitFor(() => expect(q('[data-testid="inbox-draft-drf_tree"]')).not.toBeNull())
      await act(async () => q('[data-testid="inbox-draft-drf_tree"]')!.click())
      await vi.waitFor(() => expect(modePicker()?.textContent).toBe('New worktree'))
      await pickersReady()
      await act(async () => useInboxChat.getState().setComposer({ folderId: 'fld_docs' }))
      await vi.waitFor(() => expect(modePicker()?.textContent).toBe('Current directory'))
      await vi.waitFor(() => expect(kept.get('draft:drf_tree')).toMatchObject({ folderId: 'fld_docs', choice: { agent: 'build', model } }))
      expect(kept.get('draft:drf_tree')?.choice).not.toHaveProperty('worktree')
    })

    it('is not remembered for a folder that is itself a worktree', async () => {
      git = repo
      const tree = { ...app, id: 'fld_tree', name: 'app · mde/1', worktree: { repository: '/home/me/app', root: '/home/me/app', branch: 'mde/1', base: 'main' } } as InboxFolder
      useInboxChat.setState({ folders: [app, docs, tree], composer: { folderId: 'fld_tree' } })
      kept.set('draft:drf_x', { text: 'Try it', folderId: 'fld_tree', choice: { agent: 'build', model, worktree: { base: 'main' } }, updatedAt: 900 })
      await render(withSidebar())
      await vi.waitFor(() => expect(q('[data-testid="inbox-draft-drf_x"]')).not.toBeNull())
      await act(async () => q('[data-testid="inbox-draft-drf_x"]')!.click())
      await vi.waitFor(() => expect(q('[data-testid="worktree-fixed"]')).not.toBeNull())
      await pickersReady()
      await vi.waitFor(() => expect(kept.get('draft:drf_x')?.choice).toEqual({ agent: 'build', model }))
    })
  })
})

describe('Save as draft', () => {
  const button = (): HTMLButtonElement => q('[data-testid="chat-save-draft"]') as HTMLButtonElement
  const saved = (): HTMLElement | null => q('[data-testid="inbox-draft-saved"]')

  it('is offered with the composer, off until there is something to keep, and says which keys do it', async () => {
    await render(createElement(InboxThreadView))
    await vi.waitFor(() => expect(button()).not.toBeNull())
    expect(button().getAttribute('aria-label')).toBe('Save as draft')
    expect(button().title).toBe('Save as draft (Cmd+S)')
    expect(button().disabled).toBe(true)
    await setMessageText(messageInput(document.body), '   ')
    expect(button().disabled).toBe(true)
    await setMessageText(messageInput(document.body), 'Fix the login')
    await vi.waitFor(() => expect(button().disabled).toBe(false))
  })

  it('says Ctrl where that is the key', async () => {
    useWorkspace.setState({ platform: { platform: 'win32', isWindows: true }, wslAvailable: true })
    await render(createElement(InboxThreadView))
    await vi.waitFor(() => expect(button().title).toBe('Save as draft (Ctrl+S)'))
  })

  it('sets what is typed aside, starts a blank page, and says where it went', async () => {
    await render(withSidebar())
    await pickersReady()
    await setMessageText(messageInput(document.body), 'Fix the login')
    const first = page_().id
    await act(async () => button().click())
    await vi.waitFor(() => expect(page_().id).not.toBe(first))
    await vi.waitFor(() => expect(text()).toBe(''))
    expect(kept.get(`draft:${first}`)?.text).toBe('Fix the login')
    await vi.waitFor(() => expect(q(`[data-testid="inbox-draft-${first}"]`)).not.toBeNull())
    expect(saved()?.getAttribute('role')).toBe('status')
    expect(saved()?.textContent).toContain('Saved as a draft')
    // The blank page is ready to write in, and has nothing to save yet.
    expect(button().disabled).toBe(true)
  })

  it('does the same from the keyboard, with Ctrl or Cmd and S', async () => {
    await render(withSidebar())
    await pickersReady()
    await setMessageText(messageInput(document.body), 'Fix the login')
    const first = page_().id
    const event = await pressMessageKey(messageInput(document.body), 's', { metaKey: true })
    expect(event.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(page_().id).not.toBe(first))
    await vi.waitFor(() => expect(q(`[data-testid="inbox-draft-${first}"]`)).not.toBeNull())
    await setMessageText(messageInput(document.body), 'Second idea')
    const second = page_().id
    await pressMessageKey(messageInput(document.body), 'S', { ctrlKey: true })
    await vi.waitFor(() => expect(page_().id).not.toBe(second))
    await vi.waitFor(() => expect(q(`[data-testid="inbox-draft-${second}"]`)).not.toBeNull())
  })

  it('leaves other combinations with S alone, and does nothing on an empty box', async () => {
    await render(withSidebar())
    await pickersReady()
    const first = page_().id
    const empty = await pressMessageKey(messageInput(document.body), 's', { ctrlKey: true })
    expect(empty.defaultPrevented).toBe(true)
    await setMessageText(messageInput(document.body), 'Fix the login')
    for (const init of [{ ctrlKey: true, shiftKey: true }, { ctrlKey: true, altKey: true }, {}]) {
      const event = await pressMessageKey(messageInput(document.body), 's', init)
      expect(event.defaultPrevented).toBe(false)
    }
    await settle()
    expect(page_().id).toBe(first)
    expect(saved()).toBeNull()
    expect(text()).toBe('Fix the login')
  })

  it('goes away by itself after a few seconds', async () => {
    await render(withSidebar())
    await pickersReady()
    await setMessageText(messageInput(document.body), 'Fix the login')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await act(async () => button().click())
      await vi.waitFor(() => expect(saved()).not.toBeNull())
      await act(async () => { vi.advanceTimersByTime(3900) })
      expect(saved()).not.toBeNull()
      await act(async () => { vi.advanceTimersByTime(200) })
      expect(saved()).toBeNull()
    } finally { vi.useRealTimers() }
  })

  it('takes an opened draft away from the page too, and the draft stays in the list', async () => {
    kept.set('draft:drf_old', { text: 'Rewrite the parser', folderId: 'fld_app', updatedAt: 900 })
    await render(withSidebar())
    await vi.waitFor(() => expect(q('[data-testid="inbox-draft-drf_old"]')).not.toBeNull())
    await act(async () => q('[data-testid="inbox-draft-drf_old"]')!.click())
    await vi.waitFor(() => expect(text()).toBe('Rewrite the parser'))
    await vi.waitFor(() => expect(button().disabled).toBe(false))
    await act(async () => button().click())
    await vi.waitFor(() => expect(text()).toBe(''))
    expect(page_().id).not.toBe('drf_old')
    expect(kept.get('draft:drf_old')?.text).toBe('Rewrite the parser')
    expect(q('[data-testid="inbox-draft-drf_old"]')?.getAttribute('aria-current')).toBeNull()
  })

  it('is not in the box of an existing thread, whose text is kept as it is typed', async () => {
    useWorkspace.setState({ selectedInboxThreadId: 'ses_one' })
    await render(createElement(InboxThreadView))
    await vi.waitFor(() => expect(q('[data-testid="chat-input"]')).not.toBeNull())
    expect(button()).toBeNull()
    // Cmd+S is nothing there.
    const event = await pressMessageKey(messageInput(document.body), 's', { metaKey: true })
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('A thread with an unsent message', () => {
  it('is marked in the sidebar once the thread is left, and not while it is open', async () => {
    useWorkspace.setState({ selectedInboxThreadId: 'ses_one' })
    await render(withSidebar())
    await vi.waitFor(() => expect(q('[data-testid="chat-input"] .cm-content')).not.toBeNull())
    await setMessageText(messageInput(document.body), 'And then add a test')
    // Its box is in front of you, so the row has nothing to add.
    expect(q('[data-testid="inbox-thread-draft-ses_one"]')).toBeNull()
    expect(kept.get('thread:ses_one')?.text).toBe('And then add a test')
    await select(null)
    await vi.waitFor(() => expect(q('[data-testid="inbox-thread-draft-ses_one"]')).not.toBeNull())
    expect(q('[data-testid="inbox-thread-draft-ses_one"]')?.textContent).toBe('Draft')
    // Opening it again shows its text, and takes the marker away.
    await select('ses_one')
    await vi.waitFor(() => expect(text()).toBe('And then add a test'))
    expect(q('[data-testid="inbox-thread-draft-ses_one"]')).toBeNull()
  })

  it('loses the mark when the message is sent or the box is emptied', async () => {
    kept.set('thread:ses_one', { text: 'Unsent', updatedAt: 1 })
    await render(withSidebar())
    await vi.waitFor(() => expect(q('[data-testid="inbox-thread-ses_one"]')).not.toBeNull())
    await vi.waitFor(() => expect(q('[data-testid="inbox-thread-draft-ses_one"]')).not.toBeNull())
    await select('ses_one')
    await vi.waitFor(() => expect(text()).toBe('Unsent'))
    await setMessageText(messageInput(document.body), '')
    await select(null)
    await vi.waitFor(() => expect(useInboxDrafts.getState().threadDrafts).toEqual([]))
    expect(q('[data-testid="inbox-thread-draft-ses_one"]')).toBeNull()
  })
})
