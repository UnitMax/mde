// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxThread } from '../src/shared/types'
import { inboxThreadTerminalId } from '../src/shared/inbox-thread-terminal'
import { TerminalThreadView } from '../src/renderer/components/inbox/TerminalThreadView'
import { sendTextToThread } from '../src/renderer/lib/inbox-thread-input'
import { useInboxChat } from '../src/renderer/store/inbox-chat'

const term = vi.hoisted(() => ({ paste: vi.fn(), focus: vi.fn() }))
vi.mock('../src/renderer/components/TerminalView', () => ({
  // The real one draws xterm.js, which needs a real browser.
  TerminalSurface: () => createElement('div'),
}))
vi.mock('../src/renderer/terminal/sessions', () => ({
  getSession: (id: string) => ({ terminalId: id, term }),
  fitSession: () => ({ cols: 80, rows: 24 }),
}))

const thread: InboxThread = {
  id: 'ses_term', title: 'Terminal thread', directory: '/home/me/app', target: { kind: 'native' }, branch: 'main', mode: 'terminal',
  status: 'completed', createdAt: 1, lastActivityAt: 1, readAt: 1, archived: false, folderId: 'fld_app',
}
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('api', { chat: { draft: vi.fn(async () => ({ text: '', revision: 1, attachments: [] })) } })
  useInboxChat.setState({ openThread: () => () => {} } as never)
  term.paste.mockClear()
  term.focus.mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('text sent to a terminal thread', () => {
  it('is pasted into its terminal, which takes the keyboard, and is not sent', async () => {
    await act(async () => root.render(createElement(TerminalThreadView, { thread })))
    expect(inboxThreadTerminalId(thread.id)).toBeTruthy()
    expect(sendTextToThread(thread.id, 'Error: boom')).toBe(true)
    expect(term.paste).toHaveBeenCalledExactlyOnceWith('Error: boom')
    expect(term.focus).toHaveBeenCalled()
  })

  it('goes nowhere once the thread is closed', async () => {
    await act(async () => root.render(createElement(TerminalThreadView, { thread })))
    await act(async () => root.render(createElement('div')))
    expect(sendTextToThread(thread.id, 'Error: boom')).toBe(false)
    expect(term.paste).not.toHaveBeenCalled()
  })
})
