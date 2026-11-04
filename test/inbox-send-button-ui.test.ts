// @vitest-environment happy-dom
import { act, createElement } from 'react'
import type { EditorView } from '@codemirror/view'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatComposer, type ChatComposerProps } from '../src/renderer/components/inbox/ChatComposer'
import { useWorkspace } from '../src/renderer/store/workspace'
import type { ChatDraft, ChatDraftRequest } from '../src/shared/types'
import { messageInput, pressMessageKey, setMessageText } from './helpers/chat-input'

let root: Root
let container: HTMLElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

async function setup(props: Partial<ChatComposerProps> = {}) {
  let draft: ChatDraft = { text: '', revision: 0, attachments: [] }
  const request = vi.fn(async (input: ChatDraftRequest) => {
    if (input.action === 'text') draft = { ...draft, text: input.text, revision: draft.revision + 1 }
    return draft
  })
  vi.stubGlobal('api', { chat: { draft: request } })
  const onSend = vi.fn(async (_text: string, _options?: unknown) => {})
  const onStop = vi.fn()
  const render = async (next: Partial<ChatComposerProps> = {}): Promise<void> => {
    await act(async () => root.render(createElement(ChatComposer, {
      draftKey: 'thread:ses_one', agent: 'build', model: { id: 'm', providerId: 'p' },
      options: { status: 'ready', value: { agents: [], models: [], defaultModel: null, defaultAgent: null, skills: [] } },
      onAgentChange: () => {}, onModelChange: () => {}, onSend, onStop,
      ...props, ...next,
    })))
  }
  await render()
  return { box: messageInput(container), onSend, onStop, render }
}

const send = (): HTMLButtonElement | null => container.querySelector('[data-testid="chat-send"]')
const pill = (): HTMLElement | null => container.querySelector('[data-testid="chat-send-pill"]')
const chevron = (): HTMLButtonElement => container.querySelector<HTMLButtonElement>('[data-testid="chat-send-menu"]')!
const mode = (id: 'steer' | 'queue'): HTMLElement | null => document.body.querySelector(`[data-testid="chat-send-mode-${id}"]`)

async function openMenu(): Promise<void> {
  await act(async () => { chevron().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
}
async function choose(id: 'steer' | 'queue'): Promise<void> {
  await openMenu()
  await act(async () => mode(id)!.click())
}
async function click(button: HTMLElement | null): Promise<void> {
  await act(async () => button!.click())
}

describe('the send button', () => {
  it.each([
    ['win32', 'Ctrl+Enter'],
    ['darwin', 'Cmd+Enter'],
  ] as const)('shows the background shortcut on the new-thread page on %s', async (platform, shortcut) => {
    useWorkspace.setState({ platform: { platform, isWindows: platform === 'win32' } })
    const { box, onSend } = await setup({ allowBackgroundSend: true })
    expect(send()?.title).toContain(`Start in background and keep creating threads (${shortcut})`)
    await setMessageText(box, 'Start this thread')
    await pressMessageKey(box, 'Enter', { ctrlKey: true })
    expect(onSend).toHaveBeenCalledWith('Start this thread', expect.objectContaining({ background: true }))
  })

  it('keeps Ctrl+Enter as a normal send in an existing thread', async () => {
    const { box, onSend } = await setup()
    expect(send()?.title).toBe('Send (Enter)')
    await setMessageText(box, 'A follow-up')
    await pressMessageKey(box, 'Enter', { ctrlKey: true })
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend.mock.calls[0]![1]).not.toHaveProperty('background')
  })

  it('does not start a background thread with an empty, blocked or composing input', async () => {
    const { box, onSend, render } = await setup({ allowBackgroundSend: true })
    await pressMessageKey(box, 'Enter', { ctrlKey: true })
    await setMessageText(box, 'Keep this')
    await pressMessageKey(box, 'Enter', { ctrlKey: true, isComposing: true })
    await render({ sendBlocked: true })
    await pressMessageKey(box, 'Enter', { ctrlKey: true })
    expect(onSend).not.toHaveBeenCalled()
    expect((box as EditorView).state.doc.toString()).toBe('Keep this')
  })

  it('is the plain round button while the agent is idle', async () => {
    const { box, onSend } = await setup()
    await setMessageText(box, 'Hello')
    expect(pill()).toBeNull()
    expect(send()?.getAttribute('aria-label')).toBe('Send')
    expect(send()?.textContent).toBe('')
    await click(send())
    expect(onSend).toHaveBeenCalledTimes(1)
    // To an idle agent the two ways are the same, so the choice is not part of the request.
    expect(onSend.mock.calls[0]![1]).not.toHaveProperty('delivery')
  })

  it('stays a Stop button while the agent works and the box is empty', async () => {
    const { onStop } = await setup({ running: true })
    expect(pill()).toBeNull()
    await click(container.querySelector('[aria-label="Stop"]'))
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('grows into Steer once there is a message to send to a working agent', async () => {
    const { box, onSend } = await setup({ running: true })
    await setMessageText(box, 'Also run the linter')
    expect(pill()).not.toBeNull()
    expect(container.querySelector('[aria-label="Stop"]')).toBeNull()
    expect(send()?.textContent).toBe('Steer')
    expect(send()?.title).toBe('Steer (Enter): the agent reads it at its next step')
    expect(chevron().getAttribute('aria-label')).toBe('How to send')
    await click(send())
    expect(onSend).toHaveBeenCalledWith('Also run the linter', expect.objectContaining({ delivery: 'steer' }))
  })

  it('offers steering and queueing in a menu that marks the current choice', async () => {
    const { box } = await setup({ running: true })
    await setMessageText(box, 'Later')
    await openMenu()
    expect(mode('steer')?.textContent).toContain('The agent reads it at its next step')
    expect(mode('queue')?.textContent).toContain('Sent when the agent is done')
    expect(mode('steer')?.querySelector('svg.lucide-check')).not.toBeNull()
    expect(mode('queue')?.querySelector('svg.lucide-check')).toBeNull()
  })

  it('queues what is sent after Queue was chosen, with the button saying so', async () => {
    const { box, onSend } = await setup({ running: true })
    await setMessageText(box, 'When you are done, run the linter')
    await choose('queue')
    expect(send()?.textContent).toBe('Queue')
    expect(send()?.getAttribute('data-delivery')).toBe('queue')
    expect(send()?.title).toBe('Queue (Enter): sent when the agent is done')
    // Choosing does not send: that is the button's, or Enter's, job.
    expect(onSend).not.toHaveBeenCalled()
    await click(send())
    expect(onSend).toHaveBeenCalledWith('When you are done, run the linter', expect.objectContaining({ delivery: 'queue' }))
  })

  it('sends with Enter the way the button says', async () => {
    const { box, onSend } = await setup({ running: true })
    await setMessageText(box, 'Queued by Enter')
    await choose('queue')
    await pressMessageKey(box, 'Enter')
    expect(onSend).toHaveBeenCalledWith('Queued by Enter', expect.objectContaining({ delivery: 'queue' }))
  })

  it('puts the caret back in the text when the menu closes', async () => {
    const { box } = await setup({ running: true })
    await setMessageText(box, 'Keep typing')
    await choose('queue')
    await vi.waitFor(() => expect(document.activeElement).toBe((box as EditorView).contentDOM))
  })

  it('keeps the choice for the rest of the run and starts at steering again with the next', async () => {
    const { box, onSend, render } = await setup({ running: true })
    await setMessageText(box, 'First')
    await choose('queue')
    await click(send())
    await setMessageText(box, 'Second')
    expect(send()?.textContent).toBe('Queue')
    await click(send())
    expect(onSend.mock.calls.map((call) => (call[1] as { delivery?: string }).delivery)).toEqual(['queue', 'queue'])

    // The agent finishes; the box is the plain round button again, and the next run starts over.
    await render({ running: false })
    expect(pill()).toBeNull()
    await render({ running: true })
    await setMessageText(box, 'Third')
    expect(send()?.textContent).toBe('Steer')
  })

  it('cannot be used while nothing can be sent', async () => {
    const { box, onSend } = await setup({ running: true, sendBlocked: true })
    await setMessageText(box, 'Blocked')
    expect(send()?.disabled).toBe(true)
    expect(chevron().disabled).toBe(true)
    await click(send())
    expect(onSend).not.toHaveBeenCalled()
  })
})
