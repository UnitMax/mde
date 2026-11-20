// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatMessageView } from '../src/renderer/components/inbox/ChatMessageView'
import type { ChatMessage } from '../src/shared/types'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
  delete (window as { api?: unknown }).api
})

const user = (time: number): ChatMessage => ({ kind: 'user', id: 'u1', time, text: '> quoted\nNotify this thread when Neon is available' })

describe('the line under a user message', () => {
  it('shows when the message was sent and copies its text', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 20, 10, 0))
    const writeText = vi.fn(async () => undefined)
    ;(window as { api?: unknown }).api = { clipboard: { writeText } }
    const sent = new Date(2026, 10, 19, 20, 9).getTime()
    act(() => root.render(createElement(ChatMessageView, { message: user(sent), directory: '/home/me/app' })))

    const time = host.querySelector('[data-testid="chat-sent-time-u1"]')
    expect(time?.textContent).toBe('yesterday at 20:09')
    expect(time?.getAttribute('datetime')).toBe(new Date(sent).toISOString())

    // Hovering later reads the clock again, so a thread left open overnight does not keep saying "today".
    vi.setSystemTime(new Date(2026, 10, 21, 9, 0))
    const row = host.querySelector('[data-testid="chat-message-u1"]')!
    act(() => { row.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })) })
    expect(host.querySelector('[data-testid="chat-sent-time-u1"]')?.textContent).toBe('Thu 19 Nov at 20:09')

    const copy = host.querySelector<HTMLButtonElement>('[data-testid="chat-sent-footer-u1"] button[aria-label="Copy message"]')!
    await act(async () => { copy.click() })
    expect(writeText).toHaveBeenCalledWith('> quoted\nNotify this thread when Neon is available')
    expect(copy.getAttribute('aria-label')).toBe('Copied')
  })

  it('leaves the time out when the service gave none, but still offers the copy', () => {
    act(() => root.render(createElement(ChatMessageView, { message: user(0), directory: '/home/me/app' })))
    expect(host.querySelector('[data-testid="chat-sent-time-u1"]')).toBeNull()
    expect(host.querySelector('[data-testid="chat-sent-footer-u1"] button[aria-label="Copy message"]')).not.toBeNull()
  })
})
