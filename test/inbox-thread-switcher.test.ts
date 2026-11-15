// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxFolder, InboxThread } from '../src/shared/types'
import { InboxThreadSwitcher } from '../src/renderer/components/inbox/InboxThreadSwitcher'
import { searchInboxThreads } from '../src/renderer/lib/inbox-thread-switcher'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { useWorkspace } from '../src/renderer/store/workspace'

const target = { kind: 'wsl' as const, distro: 'Ubuntu' }
const folders: InboxFolder[] = [
  { id: 'fld_app', name: 'app', directory: '/home/me/app', target, createdAt: 1, lastUsedAt: 1 },
  { id: 'fld_docs', name: 'website', directory: '/home/me/website', target, createdAt: 1, lastUsedAt: 1 },
]
const thread = (id: string, title: string, extra: Partial<InboxThread> = {}): InboxThread => ({
  id, title, directory: '/home/me/app', target, branch: 'main', status: 'idle',
  createdAt: 1, lastActivityAt: 10, readAt: 100, archived: false, folderId: 'fld_app', ...extra,
})
const threads = [
  thread('ses_a', 'Fix the login bug', { lastActivityAt: 30 }),
  thread('ses_b', 'Write release notes', { lastActivityAt: 20, folderId: 'fld_docs', directory: '/home/me/website', branch: 'docs-update' }),
  thread('ses_c', 'Old idea', { lastActivityAt: 50, archived: true }),
  thread('ses_d', 'Pinned plan', { lastActivityAt: 5, pinned: true }),
]

describe('searching the threads to switch to', () => {
  it('lists the sidebar threads in its order with nothing typed', () => {
    expect(searchInboxThreads(threads, folders, '').map((row) => row.thread.id)).toEqual(['ses_d', 'ses_a', 'ses_b'])
  })

  it('searches titles, projects and branches, archived threads too', () => {
    expect(searchInboxThreads(threads, folders, 'login').map((row) => row.thread.id)).toEqual(['ses_a'])
    expect(searchInboxThreads(threads, folders, 'website').map((row) => row.thread.id)).toEqual(['ses_b'])
    expect(searchInboxThreads(threads, folders, 'docs-up').map((row) => row.thread.id)).toEqual(['ses_b'])
    const old = searchInboxThreads(threads, folders, 'old idea')
    expect(old.map((row) => row.thread.id)).toEqual(['ses_c'])
    expect(old[0]!.matches.title).toEqual([0, 1, 2, 4, 5, 6, 7])
    expect(searchInboxThreads(threads, folders, 'zzz')).toEqual([])
  })

  it('puts a listed thread before a parked one that matches as well', () => {
    const twins = [thread('ses_x', 'Same title', { archived: true, lastActivityAt: 99 }), thread('ses_y', 'Same title')]
    expect(searchInboxThreads(twins, folders, 'same').map((row) => row.thread.id)).toEqual(['ses_y', 'ses_x'])
  })
})

describe('the thread switcher', () => {
  const roots: Root[] = []
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    useWorkspace.setState({ inboxThreads: threads, selectedInboxThreadId: 'ses_a', activeWorkspaceView: 'inbox' })
    useInboxChat.setState({ folders })
  })
  afterEach(async () => {
    for (const root of roots.splice(0)) await act(async () => root.unmount())
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  async function render(onOpenChange = vi.fn()) {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => root.render(createElement(InboxThreadSwitcher, { open: true, onOpenChange })))
    const input = document.body.querySelector<HTMLInputElement>('[data-testid="thread-switcher-input"]')!
    return { input, onOpenChange }
  }
  const results = () => Array.from(document.body.querySelectorAll<HTMLElement>('[data-testid="thread-switcher-result"]'))
  const key = (input: HTMLElement, name: string) => act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
  })
  const type = (input: HTMLInputElement, value: string) => act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

  it('starts on the open thread, and ↓ Enter opens the next one down', async () => {
    const { input, onOpenChange } = await render()
    expect(results().map((row) => row.textContent)).toEqual([
      expect.stringContaining('Pinned plan'), expect.stringContaining('Fix the login bug'), expect.stringContaining('Write release notes'),
    ])
    expect(results()[1]!.getAttribute('aria-selected')).toBe('true')
    await key(input, 'ArrowDown')
    await key(input, 'Enter')
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_b')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('opens the best match for what is typed', async () => {
    const { input } = await render()
    await type(input, 'old')
    expect(results()).toHaveLength(1)
    expect(results()[0]!.textContent).toContain('Archived')
    await key(input, 'Enter')
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_c')
  })

  it('says when nothing matches', async () => {
    const { input } = await render()
    await type(input, 'zzz')
    expect(document.body.querySelector('[data-testid="thread-switcher-empty"]')?.textContent).toBe('No matching threads.')
  })
})
