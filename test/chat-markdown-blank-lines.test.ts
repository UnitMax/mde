// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatMarkdown, chatMarkdownSource } from '../src/renderer/components/inbox/ChatMarkdown'

describe('blank lines at the ends of a reply', () => {
  it('are cut from the Markdown, keeping an indented first line', () => {
    expect(chatMarkdownSource('Let me check:\n\n')).toBe('Let me check:')
    expect(chatMarkdownSource('\n\r\n  \nLet me check:\n \n\n')).toBe('Let me check:')
    expect(chatMarkdownSource('\n    indented code\n')).toBe('    indented code')
    expect(chatMarkdownSource('A\n\n\n\nB')).toBe('A\n\n\n\nB')
  })

  describe('drawn', () => {
    let dispose: (() => void) | undefined
    beforeEach(() => {
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    })
    afterEach(async () => {
      await act(async () => dispose?.())
      dispose = undefined
      vi.unstubAllGlobals()
      document.body.innerHTML = ''
    })

    async function paragraphs(text: string): Promise<string[]> {
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)
      dispose = () => root.unmount()
      await act(async () => root.render(createElement(ChatMarkdown, { text })))
      return Array.from(container.querySelectorAll('.chat-markdown > p'), (p) => p.textContent ?? '')
    }

    it('leave no empty paragraph before the steps that follow', async () => {
      expect(await paragraphs('Let me check the file:\n\n')).toEqual(['Let me check the file:'])
      expect(await paragraphs('\n\nFirst.\n\nSecond.\n\n\n\n')).toEqual(['First.', 'Second.'])
    })
  })
})
