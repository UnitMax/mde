// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChatMessageView } from '../src/renderer/components/inbox/ChatMessageView'
import { TurnDuration } from '../src/renderer/components/inbox/ChatTurnTime'
import type { ChatMessage, ChatPart } from '../src/shared/types'

const MODEL = { id: 'free-1', providerId: 'opencode' }
const text = (value: string): ChatPart => ({ kind: 'text', text: value }) as ChatPart
const thought = (value: string): ChatPart => ({ kind: 'reasoning', text: value }) as ChatPart
const shell = (id: string, command: string): ChatPart =>
  ({ kind: 'tool', id, name: 'bash', status: 'completed', input: JSON.stringify({ command }), output: 'ok' }) as ChatPart
const step = (id: string, parts: ChatPart[]): ChatMessage =>
  ({ kind: 'assistant', id, time: 2, agent: 'build', model: MODEL, parts, completed: true }) as ChatMessage

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
})

function draw(element: ReturnType<typeof createElement>): void {
  act(() => root.render(element))
}

const flow = (element: Element | null | undefined): [string | null, string | null, boolean] =>
  [element?.getAttribute('data-flow-start') ?? null, element?.getAttribute('data-flow-end') ?? null, element?.hasAttribute('data-flow-row') ?? false]

describe('the spacing flow of the conversation', () => {
  it('says what a step of the agent starts and ends with, whatever OpenCode split it into', () => {
    draw(createElement(ChatMessageView, { message: step('a1', [thought('Plan.'), text('Running it now.'), shell('c1', 'echo 1')]), directory: '/home/me/app', working: false }))
    const message = host.querySelector('[data-chat-message="a1"]')
    expect(flow(message)).toEqual(['step', 'step', false])
    expect(Array.from(message!.children).map(flow)).toEqual([
      ['step', 'step', true],
      ['text', 'text', false],
      ['step', 'step', true],
    ])
  })

  it('draws every step as a row of its own, however many come in one message', () => {
    const parts = [thought('Plan.'), shell('c1', 'echo 1'), shell('c2', 'pwd'), shell('c3', 'ls'), text('Done.')]
    draw(createElement(ChatMessageView, { message: step('a3', parts), directory: '/home/me/app', working: false }))
    expect(host.querySelector('[data-testid="chat-activity"]')).toBeNull()
    expect(host.querySelectorAll('[data-testid="chat-reasoning"]')).toHaveLength(1)
    expect(host.querySelector('[data-chat-message="a3"]')!.children).toHaveLength(5)
  })

  it('leaves out words with nothing in them, so they take no room', () => {
    draw(createElement(ChatMessageView, { message: step('a2', [text('Done.'), text('  \n'), thought('')]), directory: '/home/me/app', working: false }))
    const message = host.querySelector('[data-chat-message="a2"]')
    expect(message!.children).toHaveLength(1)
    expect(flow(message)).toEqual(['text', 'text', false])
  })

  it('places the person’s message and the line under a turn', () => {
    draw(createElement('div', null,
      createElement(ChatMessageView, { message: { kind: 'user', id: 'u1', time: 1, text: 'Hi' } as ChatMessage, directory: '/home/me/app' }),
      createElement(TurnDuration, { ms: 5000 }),
    ))
    expect(flow(host.querySelector('[data-chat-message="u1"]')?.parentElement)).toEqual(['user', 'user', false])
    expect(flow(host.querySelector('[data-testid="chat-turn-duration"]'))).toEqual(['footer', 'footer', true])
  })
})
