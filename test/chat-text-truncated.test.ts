// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatMarkdown } from '../src/renderer/components/inbox/ChatMarkdown'

describe('a reply cut at the text limit', () => {
  let container: HTMLDivElement
  let root: Root
  const note = (): string | null => container.querySelector('[data-testid="chat-text-truncated"]')?.textContent ?? null

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('has a note under it naming the exact limit and what it usually means', async () => {
    await act(async () => root.render(createElement(ChatMarkdown, { text: 'Looping…', truncated: true })))
    expect(note()).toContain('This reply is longer than 1,048,576 characters (1 MiB)')
    expect(note()).toContain('usually means something went wrong')
  })

  it('says reasoning for cut reasoning', async () => {
    await act(async () => root.render(createElement(ChatMarkdown, { text: 'Hmm', variant: 'reasoning', truncated: true })))
    expect(note()).toContain('This reasoning is longer')
  })

  it('has no note when the reply is whole', async () => {
    await act(async () => root.render(createElement(ChatMarkdown, { text: 'Short reply.' })))
    expect(note()).toBeNull()
  })
})
