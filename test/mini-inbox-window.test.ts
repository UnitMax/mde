// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxFolder, InboxThread } from '../src/shared/types'
import { MiniInboxWindow } from '../src/renderer/components/MiniInboxWindow'

const folder: InboxFolder = {
  id: 'fld_app', name: 'Application', directory: '/workspace/app', target: { kind: 'native' }, createdAt: 1, lastUsedAt: 1,
}
function thread(id: string, overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id, title: id, folderId: folder.id, directory: folder.directory, target: folder.target,
    branch: 'main', status: 'completed', createdAt: 1, lastActivityAt: 10, readAt: 0, archived: false,
    ...overrides,
  }
}
const threads = [
  thread('ses_gui', { title: 'Fix login', status: 'working', pinned: true }),
  thread('ses_terminal', { title: 'Review tests', mode: 'terminal', status: 'attention', attentionReason: 'permission' }),
  thread('ses_error', { title: 'Investigate failure', status: 'error' }),
]
let root: Root
let container: HTMLDivElement
const onOpenThread = vi.fn()
const onRestore = vi.fn()

async function render(items: InboxThread[] = threads): Promise<void> {
  await act(async () => root.render(createElement(MiniInboxWindow, { threads: items, folders: [folder], onOpenThread, onRestore })))
}
const rows = (): HTMLButtonElement[] => Array.from(container.querySelectorAll('[data-testid="mini-inbox-row"]'))

describe('MiniInboxWindow', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    onOpenThread.mockClear()
    onRestore.mockClear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  it('shows Inbox titles and projects for both chat modes using thread metadata', async () => {
    await render()
    expect(Array.from(container.querySelectorAll('[data-testid="mini-inbox-project"]')).map((item) => item.textContent)).toEqual(['Application', 'Application', 'Application'])
    expect(rows().map((row) => row.dataset.status)).toEqual(['working', 'attention', 'error'])
    expect(rows()[0]?.textContent).toContain('Fix login')
    expect(rows()[1]?.textContent).toContain('Review tests')
    expect(rows()[1]?.textContent).toContain('Needs permission')
    expect(rows()[0]?.dataset.unread).toBe('true')
    expect(container.querySelector('[data-testid="mini-inbox-count"]')?.textContent).toBe('3')
  })

  it('is one list in the Inbox’s order, pinned first and then the latest activity, not grouped by project', async () => {
    const other: InboxFolder = { id: 'fld_web', name: 'Website', directory: '/workspace/web', target: { kind: 'native' }, createdAt: 1, lastUsedAt: 1 }
    const items = [
      thread('ses_old_app', { lastActivityAt: 100 }),
      thread('ses_new_web', { folderId: other.id, directory: other.directory, lastActivityAt: 300 }),
      thread('ses_mid_app', { lastActivityAt: 200 }),
      thread('ses_pinned_old', { lastActivityAt: 50, pinned: true }),
    ]
    await act(async () => root.render(createElement(MiniInboxWindow, { threads: items, folders: [folder, other], onOpenThread, onRestore })))
    expect(rows().map((row) => row.parentElement && row.querySelector('[data-testid="mini-inbox-project"]')?.textContent)).toEqual(['Application', 'Website', 'Application', 'Application'])
    expect(container.querySelectorAll('[data-testid="mini-inbox-list"] > li')).toHaveLength(4)
    expect(container.querySelector('[data-testid="mini-inbox-group"]')).toBeNull()
    expect(container.querySelector('h2')).toBeNull()
    expect(rows().map((row) => row.getAttribute('title')?.split(' · ')[0])).toEqual(['ses_pinned_old', 'ses_new_web', 'ses_mid_app', 'ses_old_app'])
    expect(rows()[0]!.querySelector('[aria-label="Pinned thread"]')).not.toBeNull()
    expect(rows()[1]!.querySelector('[aria-label="Pinned thread"]')).toBeNull()
  })

  it('says how long ago each thread was active, as the sidebar does, with the date as its tooltip', async () => {
    const now = Date.now()
    await render([thread('ses_recent', { lastActivityAt: now - 5 * 60_000 }), thread('ses_older', { lastActivityAt: now - 3 * 3_600_000 })])
    const ages = Array.from(container.querySelectorAll('[data-testid="mini-inbox-age"]'))
    expect(ages.map((item) => item.textContent)).toEqual(['5m ago', '3h ago'])
    expect(ages[0]!.getAttribute('title')).toMatch(/\d{4}/)
  })

  it('draws each thread’s project icon before its project name, the plain folder when the project has none', async () => {
    const icons = (): (string | null | undefined)[] =>
      rows().map((row) => row.querySelector('[data-testid="project-icon"]')?.getAttribute('data-icon'))
    await render()
    expect(icons()).toEqual(['folder', 'folder', 'folder'])
    await act(async () => root.render(createElement(MiniInboxWindow, {
      threads, folders: [{ ...folder, icon: { kind: 'symbol', id: 'rocket', color: 'blue' } }], onOpenThread, onRestore,
    })))
    expect(icons()).toEqual(['rocket', 'rocket', 'rocket'])
    await act(async () => root.render(createElement(MiniInboxWindow, {
      threads, folders: [{ ...folder, icon: { kind: 'emoji', emoji: '🚀' } }], onOpenThread, onRestore,
    })))
    expect(rows()[0]!.querySelector('[data-testid="project-icon"]')?.textContent).toBe('🚀')
  })

  it('excludes parked threads from rows, counts and summary chips', async () => {
    await render([thread('ses_done'), thread('ses_parked', { archived: true, status: 'working', folderId: 'fld_other' })])
    expect(rows()).toHaveLength(1)
    expect(container.querySelector('[data-testid="mini-inbox-count"]')?.textContent).toBe('1')
    expect(container.querySelector('[data-testid="mini-inbox-chip-working"]')).toBeNull()
    expect(container.querySelector('[data-testid="mini-inbox-chip-completed"]')?.textContent).toBe('1 done')
  })

  it('updates titles, unread markers, request reasons and summaries from new thread metadata', async () => {
    await render([thread('ses_one', { status: 'working' })])
    await render([thread('ses_one', { title: 'Updated title', status: 'attention', attentionReason: 'question', readAt: 10 })])
    expect(rows()[0]?.textContent).toContain('Updated title')
    expect(rows()[0]?.textContent).toContain('Needs input')
    expect(rows()[0]?.dataset.unread).toBeUndefined()
    expect(container.querySelector('[data-testid="mini-inbox-chip-attention"]')?.textContent).toBe('1 needs input')
    expect(container.querySelector('[data-testid="mini-inbox-chip-working"]')).toBeNull()
  })

  it('shows an Inbox empty state with no summary when there are no unparked threads', async () => {
    await render([thread('ses_parked', { archived: true })])
    expect(container.querySelector('[data-testid="mini-inbox-empty"]')?.textContent).toContain('Start a conversation in the Inbox')
    expect(rows()).toEqual([])
    expect(container.querySelector('[data-testid="mini-inbox-summary"]')).toBeNull()
    expect(container.querySelector('[data-testid="mini-inbox-count"]')?.textContent).toBe('0')
  })

  it('opens the clicked Inbox thread by its session ID', async () => {
    await render()
    await act(async () => rows()[1]?.click())
    expect(onOpenThread).toHaveBeenCalledExactlyOnceWith('ses_terminal')
  })

  it('shares the Inbox title, count and restore control in one title bar', async () => {
    await render()
    const bar = container.querySelector('[data-testid="title-bar"]')
    expect(container.querySelectorAll('[data-testid="title-bar"]')).toHaveLength(1)
    expect(bar?.textContent).toContain('Inbox')
    expect(bar?.querySelector('[data-testid="mini-inbox-count"]')?.textContent).toBe('3')
    const restore = bar?.querySelector<HTMLButtonElement>('[data-testid="mini-inbox-restore"]')
    expect(restore?.getAttribute('title')).toContain('F12')
    expect(restore?.className).toContain('app-no-drag')
    await act(async () => restore?.click())
    expect(onRestore).toHaveBeenCalledOnce()
  })
})
