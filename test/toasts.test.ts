// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from '../src/renderer/components/Toaster'
import { getAlertSettings, resetAlertSettingsCache, saveAlertSettings } from '../src/renderer/lib/alert-settings'
import { startToasts } from '../src/renderer/lib/toast-controller'
import { backgroundThreadToast, notify, spawnedThreadToast, threadToast } from '../src/renderer/lib/toasts'
import { useInboxChat } from '../src/renderer/store/inbox-chat'
import { TOAST_LEAVE_MS, TOAST_LIMIT, useToasts, type ToastInput } from '../src/renderer/store/toasts'
import { useWorkspace } from '../src/renderer/store/workspace'
import type { InboxThread } from '../src/shared/types'

function thread(overrides: Partial<InboxThread> = {}): InboxThread {
  return {
    id: 'ses_one', title: 'Fix login', directory: '/home/me/app', target: { kind: 'native' }, branch: 'main', folderId: 'fld_app',
    createdAt: Date.now(), lastActivityAt: Date.now(), readAt: Date.now(), archived: false, status: 'working',
    ...overrides,
  }
}

const news = (overrides: Partial<ToastInput> = {}): ToastInput => ({ tone: 'ok', icon: 'done', label: 'Done', title: 'Fix login', ...overrides })

beforeEach(() => {
  localStorage.clear()
  resetAlertSettingsCache()
  useToasts.setState({ toasts: [] })
  useWorkspace.setState({ windowMode: 'normal', ready: true, inboxThreads: [], selectedInboxThreadId: null, activeWorkspaceView: 'sessions' })
  useInboxChat.setState({ folders: [{ id: 'fld_app', name: 'app' } as never] })
  vi.stubGlobal('api', { inbox: { setRead: vi.fn(async () => null) } })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the toast store', () => {
  it(`keeps at most ${TOAST_LIMIT} on screen, dropping the oldest`, () => {
    for (let index = 0; index < TOAST_LIMIT + 2; index += 1) useToasts.getState().show(news({ title: `Thread ${index}` }))
    expect(useToasts.getState().toasts.map((toast) => toast.title)).toEqual(['Thread 2', 'Thread 3', 'Thread 4', 'Thread 5'])
  })

  it('replaces the toast with the same key rather than stacking another', () => {
    useToasts.getState().show(news({ key: 'thread:a', label: 'Needs input' }))
    useToasts.getState().show(news({ key: 'thread:b' }))
    useToasts.getState().show(news({ key: 'thread:a', label: 'Done' }))
    expect(useToasts.getState().toasts.map((toast) => [toast.key, toast.label])).toEqual([['thread:b', 'Done'], ['thread:a', 'Done']])
  })

  it('lets a dismissed toast play its way out, then forgets it', () => {
    vi.useFakeTimers()
    const id = useToasts.getState().show(news())
    useToasts.getState().dismiss(id)
    expect(useToasts.getState().toasts[0]).toMatchObject({ id, leaving: true })
    vi.advanceTimersByTime(TOAST_LEAVE_MS)
    expect(useToasts.getState().toasts).toEqual([])
  })
})

describe('which thread changes are news', () => {
  it('tells of done, failed, a question, a permission and a thread back from a snooze', () => {
    const working = thread()
    expect(threadToast(working, thread({ status: 'completed' }), { project: 'app' })).toMatchObject({ tone: 'ok', label: 'Done', title: 'Fix login', detail: 'app' })
    expect(threadToast(working, thread({ status: 'error' }))).toMatchObject({ tone: 'danger', label: 'Failed' })
    expect(threadToast(working, thread({ status: 'attention', attentionReason: 'question' }))).toMatchObject({ tone: 'accent', icon: 'input', label: 'Needs input' })
    expect(threadToast(working, thread({ status: 'attention', attentionReason: 'permission' }))).toMatchObject({ icon: 'permission', label: 'Needs permission' })
    const done = thread({ status: 'completed' })
    expect(threadToast(done, { ...done, woke: true })).toMatchObject({ icon: 'woke', label: 'Woke up' })
  })

  it('is quiet about threads seen for the first time and changes that are not news', () => {
    expect(threadToast(undefined, thread({ status: 'completed' }))).toBeNull()
    expect(threadToast(thread(), thread({ title: 'Renamed' }))).toBeNull()
    const done = thread({ status: 'completed' })
    expect(threadToast(done, { ...done, readAt: Date.now() + 1 })).toBeNull()
  })

  it('uses the title the person gave the thread', () => {
    expect(threadToast(thread(), thread({ status: 'completed', customTitle: 'Login bug' }))?.title).toBe('Login bug')
  })

  it('tells of a thread an agent just started, but not one it started long ago', () => {
    const now = Date.now()
    const spawned = thread({ id: 'ses_child', spawnedBy: { threadId: 'ses_one' }, createdAt: now - 1000 })
    expect(spawnedThreadToast(spawned, now, { parentTitle: 'Fix login', project: 'app' })).toMatchObject({
      icon: 'agent-thread', label: 'Agent started a thread', detail: 'From Fix login · app',
    })
    expect(spawnedThreadToast({ ...spawned, spawnedBy: {} }, now)?.detail).toBe('From an agent')
    expect(spawnedThreadToast({ ...spawned, createdAt: now - 10 * 60 * 1000 }, now)).toBeNull()
    expect(spawnedThreadToast(thread(), now)).toBeNull()
  })

  it('opens the thread from its toast', () => {
    useWorkspace.setState({ inboxThreads: [thread({ status: 'completed', lastActivityAt: 5, readAt: 1 })] })
    backgroundThreadToast(thread()).onOpen!()
    expect(useWorkspace.getState()).toMatchObject({ selectedInboxThreadId: 'ses_one', activeWorkspaceView: 'inbox' })
  })
})

describe('notify', () => {
  it('shows nothing when toasts are turned off or MDE is in the mini window', () => {
    saveAlertSettings({ ...getAlertSettings(), toasts: false })
    notify(news())
    expect(useToasts.getState().toasts).toEqual([])
    saveAlertSettings({ ...getAlertSettings(), toasts: true })
    useWorkspace.setState({ windowMode: 'mini' })
    notify(news())
    expect(useToasts.getState().toasts).toEqual([])
    useWorkspace.setState({ windowMode: 'normal' })
    notify(news())
    expect(useToasts.getState().toasts).toHaveLength(1)
  })

  it('is on by default', () => {
    expect(getAlertSettings().toasts).toBe(true)
  })
})

describe('the toast controller', () => {
  let stop: () => void
  beforeEach(() => { stop = startToasts() })
  afterEach(() => stop())

  it('ignores the threads loaded at startup, then tells of changes and of threads agents start', () => {
    useWorkspace.setState({ ready: false })
    useWorkspace.setState({ ready: true, inboxThreads: [thread({ status: 'completed' })] })
    expect(useToasts.getState().toasts).toEqual([])

    useWorkspace.setState({ inboxThreads: [thread({ status: 'attention', attentionReason: 'question' })] })
    expect(useToasts.getState().toasts.map((toast) => [toast.label, toast.detail])).toEqual([['Needs input', 'app']])

    const child = thread({ id: 'ses_child', title: 'Write tests', spawnedBy: { threadId: 'ses_one' } })
    useWorkspace.setState({ inboxThreads: [...useWorkspace.getState().inboxThreads, child] })
    expect(useToasts.getState().toasts.at(-1)).toMatchObject({ label: 'Agent started a thread', title: 'Write tests', detail: 'From Fix login · app' })

    // A thread the person started is not news.
    useWorkspace.setState({ inboxThreads: [...useWorkspace.getState().inboxThreads, thread({ id: 'ses_mine' })] })
    expect(useToasts.getState().toasts).toHaveLength(2)
  })

  it('still tells of the thread that is open', () => {
    useWorkspace.setState({ inboxThreads: [thread()], selectedInboxThreadId: 'ses_one', activeWorkspaceView: 'inbox' })
    useWorkspace.setState({ inboxThreads: [thread({ status: 'completed' })] })
    expect(useToasts.getState().toasts.map((toast) => toast.label)).toEqual(['Done'])
  })

  it('takes the toasts away when they are turned off or MDE goes to the mini window', () => {
    notify(news())
    saveAlertSettings({ ...getAlertSettings(), toasts: false })
    expect(useToasts.getState().toasts).toEqual([])
    saveAlertSettings({ ...getAlertSettings(), toasts: true })
    notify(news())
    useWorkspace.setState({ windowMode: 'mini' })
    expect(useToasts.getState().toasts).toEqual([])
  })
})

describe('a chat started in the background', () => {
  it('shows a toast that opens it, and stays where the person is', async () => {
    const created = thread({ id: 'ses_bg', title: 'Refactor the parser' })
    vi.stubGlobal('api', { chat: { create: vi.fn(async () => created) }, inbox: { setRead: vi.fn(async () => null) } })
    await useInboxChat.getState().createThread({ folderId: 'fld_app', text: 'Refactor the parser', agent: 'build', model: { providerId: 'p', id: 'm' } }, { background: true })
    expect(useWorkspace.getState().selectedInboxThreadId).toBeNull()
    expect(useToasts.getState().toasts).toEqual([expect.objectContaining({ label: 'Started in the background', title: 'Refactor the parser', detail: 'app' })])
    useToasts.getState().toasts[0]!.onOpen!()
    expect(useWorkspace.getState().selectedInboxThreadId).toBe('ses_bg')
  })

  it('shows none when the chat is opened at once', async () => {
    vi.stubGlobal('api', { chat: { create: vi.fn(async () => thread({ id: 'ses_fg' })) }, inbox: { setRead: vi.fn(async () => null) } })
    await useInboxChat.getState().createThread({ folderId: 'fld_app', text: 'Hi', agent: 'build', model: { providerId: 'p', id: 'm' } })
    expect(useToasts.getState().toasts).toEqual([])
  })
})

describe('the toaster', () => {
  let root: Root
  let container: HTMLDivElement
  const q = (testId: string): HTMLElement[] => Array.from(container.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`))

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('draws nothing without toasts, and a card for each with its label, title and detail', async () => {
    await act(async () => root.render(createElement(Toaster)))
    expect(q('toaster')).toHaveLength(0)
    await act(async () => {
      notify(news({ detail: 'app' }))
      notify(news({ tone: 'danger', icon: 'failed', label: 'Failed', title: 'Deploy' }))
    })
    const cards = q('toast')
    expect(cards.map((card) => card.getAttribute('data-tone'))).toEqual(['ok', 'danger'])
    expect(cards[0]!.textContent).toContain('Done')
    expect(q('toast-title').map((title) => title.textContent)).toEqual(['Fix login', 'Deploy'])
    expect(q('toast-detail').map((detail) => detail.textContent)).toEqual(['app'])
  })

  it('runs the toast\'s action on a click and lets it go', async () => {
    const onOpen = vi.fn()
    await act(async () => root.render(createElement(Toaster)))
    await act(async () => { notify(news({ onOpen })) })
    await act(async () => q('toast-open')[0]!.click())
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(useToasts.getState().toasts[0]?.leaving).toBe(true)
  })

  it('goes when its time runs out, when dismissed, or on Escape', async () => {
    await act(async () => root.render(createElement(Toaster)))
    await act(async () => {
      notify(news({ title: 'A' }))
      notify(news({ title: 'B' }))
      notify(news({ title: 'C' }))
    })
    const onOpen = vi.fn()
    await act(async () => { q('toast-countdown')[0]!.dispatchEvent(new Event('animationend', { bubbles: true })) })
    await act(async () => q('toast-dismiss')[1]!.click())
    await act(async () => { q('toast')[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(useToasts.getState().toasts.map((toast) => toast.leaving)).toEqual([true, true, true])
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('keeps time from running while MDE is in the background', async () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    await act(async () => root.render(createElement(Toaster)))
    await act(async () => { notify(news()) })
    expect(q('toaster')[0]!.hasAttribute('data-paused')).toBe(true)
    hasFocus.mockReturnValue(true)
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(q('toaster')[0]!.hasAttribute('data-paused')).toBe(false)
    hasFocus.mockRestore()
  })
})
