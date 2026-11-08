// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatSearchResponse, InboxFolder, InboxThread } from '../src/shared/types'
import { InboxSearchDialog } from '../src/renderer/components/inbox/InboxSearchDialog'
import { isInboxSearchShortcut, searchRows } from '../src/renderer/lib/inbox-search'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useInboxFind } from '../src/renderer/store/inbox-find'
import { useWorkspace } from '../src/renderer/store/workspace'

const thread = (id: string, title: string, overrides: Partial<InboxThread> = {}): InboxThread => ({
  id, title, directory: '/home/me/app', target: { kind: 'native' }, branch: null, status: 'idle', createdAt: 1,
  lastActivityAt: Date.now() - 3_600_000, readAt: Date.now(), archived: false, folderId: 'fld_app', ...overrides,
})
const folder: InboxFolder = { id: 'fld_app', name: 'app', directory: '/home/me/app', target: { kind: 'native' }, createdAt: 1, lastUsedAt: 1 }

const answer = (overrides: Partial<ChatSearchResponse> = {}): ChatSearchResponse => ({
  results: [
    { threadId: 'ses_a', hitCount: 3, hits: [
      { messageId: 'msg_2', role: 'assistant', before: 'The ', match: 'needle', after: ' is fixed.' },
      { messageId: 'msg_1', role: 'user', before: 'Find the ', match: 'needle', after: '' },
    ] },
    { threadId: 'ses_b', hitCount: 1, hits: [{ messageId: 'msg_9', role: 'user', before: 'a ', match: 'needle', after: ' in b' }] },
  ],
  indexed: 2, total: 2, truncated: false,
  ...overrides,
})

describe('isInboxSearchShortcut', () => {
  const input = { key: 'F', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true }
  it('is Ctrl+Shift+F and Cmd+Shift+F', () => {
    expect(isInboxSearchShortcut(input)).toBe(true)
    expect(isInboxSearchShortcut({ ...input, key: 'f', ctrlKey: false, metaKey: true })).toBe(true)
  })
  it('is not plain Ctrl+F, other letters, or with Alt held', () => {
    expect(isInboxSearchShortcut({ ...input, shiftKey: false })).toBe(false)
    expect(isInboxSearchShortcut({ ...input, key: 'g' })).toBe(false)
    expect(isInboxSearchShortcut({ ...input, altKey: true })).toBe(false)
    expect(isInboxSearchShortcut({ ...input, ctrlKey: false })).toBe(false)
  })
})

describe('searchRows', () => {
  it('makes a row of each message, marks the first of a thread and says what is not listed', () => {
    const rows = searchRows(answer(), [thread('ses_a', 'A'), thread('ses_b', 'B')], [folder])
    expect(rows.map((row) => [row.thread.id, row.hit.messageId, row.first, row.more])).toEqual([
      ['ses_a', 'msg_2', true, 0],
      ['ses_a', 'msg_1', false, 1],
      ['ses_b', 'msg_9', true, 0],
    ])
    expect(rows[0]?.folder?.name).toBe('app')
  })

  it('leaves out a thread that is no longer in the workspace', () => {
    expect(searchRows(answer(), [thread('ses_b', 'B')], []).map((row) => row.thread.id)).toEqual(['ses_b'])
    expect(searchRows(null, [], [])).toEqual([])
  })
})

describe('the search over all threads', () => {
  let root: Root
  let container: HTMLDivElement
  const search = vi.fn(async (_request: { query: string }): Promise<ChatSearchResponse> => answer())
  const onOpenChange = vi.fn()
  const q = (selector: string): HTMLElement | null => document.querySelector<HTMLElement>(selector)
  const rows = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="inbox-search-result"]'))
  const render = (open = true): Promise<void> => act(async () => root.render(createElement(InboxSearchDialog, { open, onOpenChange })))
  const type = (value: string): Promise<void> =>
    act(async () => {
      const field = q('[data-testid="inbox-search-input"]') as HTMLInputElement
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  const key = (name: string): Promise<void> =>
    act(async () => { q('[data-testid="inbox-search-input"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })) })

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('api', { chat: { search } })
    search.mockReset()
    search.mockImplementation(async () => answer())
    onOpenChange.mockReset()
    useInboxChat.setState({ folders: [folder] })
    useInboxFind.setState({ request: null })
    useWorkspace.setState({ inboxThreads: [thread('ses_a', 'Fix login'), thread('ses_b', 'Plan', { customTitle: 'Release plan', archived: true })], selectedInboxThreadId: null })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('starts the threads being read as it opens, and lists nothing until something is typed', async () => {
    await render()
    await vi.waitFor(() => expect(search).toHaveBeenCalledWith({ query: '' }))
    expect(rows()).toHaveLength(0)
    expect(document.body.textContent).toContain('Type to search')
  })

  it('does nothing while closed', async () => {
    await render(false)
    expect(search).not.toHaveBeenCalled()
  })

  it('lists the messages found under the heading of their thread, with the match marked', async () => {
    await render()
    await type('needle')
    await vi.waitFor(() => expect(rows()).toHaveLength(3))
    expect(search).toHaveBeenLastCalledWith({ query: 'needle' })
    const text = document.body.textContent ?? ''
    expect(text).toContain('Fix login')
    expect(text).toContain('Release plan')
    expect(text).toContain('Archived')
    expect(text).toContain('and 1 more message in this thread')
    expect(rows()[0]?.querySelector('mark')?.textContent).toBe('needle')
    expect(rows()[0]?.textContent).toContain('Agent')
    expect(rows()[1]?.textContent).toContain('You')
    expect(q('[data-testid="inbox-search-status"]')?.textContent).toBe('2 threads')
  })

  it('moves with the arrow keys, around the ends, and opens the thread at the message with Enter', async () => {
    await render()
    await type('needle')
    await vi.waitFor(() => expect(rows()).toHaveLength(3))
    expect(rows()[0]?.getAttribute('aria-selected')).toBe('true')
    await key('ArrowUp')
    expect(rows()[2]?.getAttribute('aria-selected')).toBe('true')
    await key('ArrowDown')
    await key('ArrowDown')
    expect(rows()[1]?.getAttribute('aria-selected')).toBe('true')
    await key('Enter')
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_a')
    expect(useInboxFind.getState().request).toEqual({ threadId: 'ses_a', query: 'needle', messageId: 'msg_1' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('opens a thread by clicking its message', async () => {
    await render()
    await type('needle')
    await vi.waitFor(() => expect(rows()).toHaveLength(3))
    await act(async () => rows()[2]!.click())
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_b')
    expect(useInboxFind.getState().request?.messageId).toBe('msg_9')
  })

  it('only opens a terminal thread, which has no conversation to search', async () => {
    useWorkspace.setState({ inboxThreads: [thread('ses_a', 'Fix login', { mode: 'terminal' }), thread('ses_b', 'Plan')] })
    await render()
    await type('needle')
    await vi.waitFor(() => expect(rows()).toHaveLength(3))
    await key('Enter')
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_a')
    expect(useInboxFind.getState().request).toBeNull()
  })

  it('asks again while the threads are still being read, and says how far it is', async () => {
    search.mockImplementation(async () => (search.mock.calls.length < 3 ? answer({ results: [], indexed: 1, total: 4 }) : answer({ indexed: 4, total: 4 })))
    await render()
    await type('needle')
    await vi.waitFor(() => expect(q('[data-testid="inbox-search-status"]')?.textContent).toContain('Searching 1 of 4 threads'))
    await vi.waitFor(() => expect(rows()).toHaveLength(3), { timeout: 3000 })
    expect(q('[data-testid="inbox-search-status"]')?.textContent).toBe('2 threads')
  })

  it('says when no thread has the text', async () => {
    search.mockImplementation(async () => answer({ results: [] }))
    await render()
    await type('zzz')
    await vi.waitFor(() => expect(q('[data-testid="inbox-search-empty"]')?.textContent).toBe('No thread has that text.'))
  })

  it('says when the search failed', async () => {
    search.mockImplementation(async () => { throw new Error('boom') })
    await render()
    await type('needle')
    await vi.waitFor(() => expect(q('[role="alert"]')).not.toBeNull())
  })

  it('closes with Escape', async () => {
    await render()
    await key('Escape')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
