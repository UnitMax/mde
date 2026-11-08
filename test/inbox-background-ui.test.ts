// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBackgroundState, ChatEvent } from '../src/shared/types'
import { ChatBackgroundTasks } from '../src/renderer/components/inbox/ChatBackgroundTasks'
import { BACKGROUND_REFRESH_MS } from '../src/renderer/components/inbox/use-background-tasks'

const task = { id: 'job_server', kind: 'shell' as const, title: 'Web server', command: 'python3 server.py' }
let listed: ChatBackgroundState
let root: Root
let container: HTMLElement
let listener: ((event: ChatEvent) => void) | undefined
const unsubscribe = vi.fn()
const backgroundTasks = vi.fn(async (_req: { threadId: string }): Promise<ChatBackgroundState> => listed)

const render = (id = 'ses_one') => act(async () => root.render(createElement(ChatBackgroundTasks, { key: id, threadId: id })))
const buttons = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
const toggle = () => buttons().find((item) => item.hasAttribute('aria-expanded'))!
const click = (button: HTMLButtonElement) => act(async () => button.click())

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  listed = { supported: true, tasks: [task, { id: 'job_child', kind: 'subagent', title: 'Review code' }] }
  backgroundTasks.mockReset().mockImplementation(async () => listed)
  unsubscribe.mockReset()
  vi.stubGlobal('api', { chat: { backgroundTasks, onEvent: (callback: typeof listener) => { listener = callback; return unsubscribe } } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('background tasks above the composer', () => {
  it('shows the running count, expands the list, and has no stop actions', async () => {
    await render()
    expect(toggle().textContent).toContain('2 background tasks running')
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('ul')).toBeNull()
    await click(toggle())
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.textContent).toContain('python3 server.py')
    expect(container.textContent).toContain('Review code')
    expect(buttons().filter((button) => button.getAttribute('aria-label')?.startsWith('Stop '))).toHaveLength(0)
    expect(container.querySelector('script')).toBeNull()
  })

  it('says which tasks are running when closed, and how long each has been going when open', async () => {
    listed = { supported: true, tasks: [{ ...task, startedAt: Date.now() - 125_000 }, { id: 'job_child', kind: 'subagent', title: 'Review code' }] }
    await render()
    expect(toggle().textContent).toContain('2 background tasks running')
    expect(toggle().textContent).toContain('Web server, Review code')
    await click(toggle())
    // Open, the list says it, so the line does not.
    expect(toggle().textContent).not.toContain('Web server')
    const rows = Array.from(container.querySelectorAll('li'))
    expect(rows[0]!.querySelector('[role="timer"]')?.textContent).toBe('2m 5s')
    expect(rows[0]!.getAttribute('title')).toMatch(/^Shell process, started /)
    // A task with no start time has no clock, and the kind is for a screen reader.
    expect(rows[1]!.querySelector('[role="timer"]')).toBeNull()
    expect(rows[1]!.querySelector('.sr-only')?.textContent).toBe('Subagent: ')
    // The explanation is a tooltip, not a line of its own.
    expect(container.textContent).not.toContain('Tasks reported by OpenCode')
    expect(toggle().getAttribute('title')).toContain('reported by OpenCode')
  })

  it('is a row for the tray above the box, and leaves the tray empty when there is nothing to say', async () => {
    const { ComposerDock } = await import('../src/renderer/components/inbox/ComposerDock')
    listed = { supported: true, tasks: [] }
    await act(async () => root.render(createElement(ComposerDock, null, createElement(ChatBackgroundTasks, { threadId: 'ses_one' }))))
    const dock = container.querySelector('[data-testid="composer-dock"]')!
    expect(dock.childNodes.length).toBe(0)
    listed = { supported: true, tasks: [task] }
    await act(async () => listener?.({ type: 'background', threadId: 'ses_one' }))
    expect(dock.querySelector('[data-testid="chat-background-tasks"]')).not.toBeNull()
  })

  it('keeps an open list visible when the last task finishes', async () => {
    await render()
    await click(toggle())
    listed = { supported: true, tasks: [] }
    await act(async () => listener?.({ type: 'background', threadId: 'ses_one' }))
    expect(container.textContent).toContain('No background tasks running.')
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    await click(toggle())
    expect(container.querySelector('[data-testid="chat-background-tasks"]')).toBeNull()
  })

  it('refreshes while the agent is idle, on reconnect and focus; removes timers and listeners on unmount', async () => {
    await render()
    listed = { supported: true, tasks: [task] }
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKGROUND_REFRESH_MS) })
    expect(toggle().textContent).toContain('1 background task running')
    await act(async () => listener?.({ type: 'reconnected', threadId: 'ses_one' }))
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(backgroundTasks).toHaveBeenCalledTimes(4)
    await act(async () => root.unmount())
    root = createRoot(container)
    const count = backgroundTasks.mock.calls.length
    await vi.advanceTimersByTimeAsync(BACKGROUND_REFRESH_MS * 2)
    window.dispatchEvent(new Event('focus'))
    expect(backgroundTasks).toHaveBeenCalledTimes(count)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('keeps the last list on a failed refresh and clearly marks its status as unknown', async () => {
    await render()
    await click(toggle())
    backgroundTasks.mockRejectedValue(new Error('Service offline'))
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKGROUND_REFRESH_MS) })
    expect(toggle().textContent).toContain('status unavailable')
    expect(toggle().textContent).toContain('2 last seen')
    expect(container.textContent).toContain('current status is unknown')
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  it('distinguishes unsupported tracking from an empty task list', async () => {
    listed = { supported: false, tasks: [] }
    await render()
    expect(toggle().textContent).toContain('status unavailable')
    await click(toggle())
    expect(container.textContent).toContain('Update OpenCode')
    expect(container.textContent).not.toContain('0 background tasks running')
    const count = backgroundTasks.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKGROUND_REFRESH_MS * 2) })
    expect(backgroundTasks).toHaveBeenCalledTimes(count)
  })

  it('ignores late answers after switching threads', async () => {
    let resolve!: (value: ChatBackgroundState) => void
    backgroundTasks.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    await render()
    listed = { supported: true, tasks: [] }
    await render('ses_two')
    await act(async () => resolve({ supported: true, tasks: [task] }))
    expect(container.querySelector('[data-testid="chat-background-tasks"]')).toBeNull()
    expect(backgroundTasks).toHaveBeenLastCalledWith({ threadId: 'ses_two' })
  })

  it('remembers dismissing the unavailable message across threads and remounts', async () => {
    listed = { supported: false, tasks: [] }
    await render()
    const hide = buttons().find((button) => button.getAttribute('aria-label') === 'Hide unavailable background task message')!
    await click(hide)
    expect(container.querySelector('[data-testid="chat-background-tasks"]')).toBeNull()
    await render('ses_two')
    expect(container.querySelector('[data-testid="chat-background-tasks"]')).toBeNull()
  })

  it('still shows tasks when tracking becomes available after dismissing the message', async () => {
    listed = { supported: false, tasks: [] }
    await render()
    await click(buttons().find((button) => button.getAttribute('aria-label') === 'Hide unavailable background task message')!)
    listed = { supported: true, tasks: [task] }
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(toggle().textContent).toContain('1 background task running')
    await click(toggle())
    backgroundTasks.mockRejectedValue(new Error('Service offline'))
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKGROUND_REFRESH_MS) })
    expect(container.textContent).toContain('1 last seen')
    expect(container.textContent).toContain('current status is unknown')
  })

})
