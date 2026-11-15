// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatMarkdown } from '../src/renderer/components/inbox/ChatMarkdown'
import { menuTarget } from '../src/renderer/lib/chat-menu'
import { useToasts } from '../src/renderer/store/toasts'

const writeText = vi.fn(async (_text: string) => undefined)
const renderMermaidSvg = vi.hoisted(() => vi.fn(async () => {
  const fragment = document.createDocumentFragment()
  fragment.append(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
  return fragment
}))
vi.mock('../src/renderer/lib/mermaid-preview', () => ({ renderMermaidSvg }))

let root: Root
let container: HTMLDivElement

async function render(text: string, variant: 'message' | 'reasoning' = 'message'): Promise<void> {
  await act(async () => root.render(createElement(ChatMarkdown, { text, variant })))
}

function buttons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'))
}

function button(index = 0): HTMLButtonElement {
  return buttons()[index]!
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('api', { clipboard: { writeText } })
  writeText.mockReset().mockResolvedValue(undefined)
  renderMermaidSvg.mockClear()
  useToasts.setState({ toasts: [] })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('Inbox code block copy buttons', () => {
  it('copies only the chosen block, preserving indentation, blank lines and special characters', async () => {
    const code = '  const text = "<tag>&"\n\n\treturn text  '
    await render(`Example:\n\n\`\`\`ts\n${code}\n\`\`\`\n\n\`\`\`\nsecond block\n\`\`\``)
    expect(buttons()).toHaveLength(2)
    expect(button().getAttribute('aria-label')).toBe('Copy code')
    expect(container.querySelector('pre code.language-ts')?.textContent).toBe(code)
    expect(container.querySelector('[aria-label="Assistant message"]')?.getAttribute('contenteditable')).toBe('false')

    await act(async () => button().click())
    expect(writeText).toHaveBeenLastCalledWith(code)
    expect(button().getAttribute('aria-label')).toBe('Copied')
    expect(button(1).getAttribute('aria-label')).toBe('Copy code')
    expect(menuTarget(container.querySelector('pre code')!, container).code).toBe(code)

    await act(async () => button(1).click())
    expect(writeText).toHaveBeenLastCalledWith('second block')
    expect(container.querySelectorAll('pre')).toHaveLength(2)
  })

  it('returns to the copy icon after confirming success', async () => {
    await render('```\nhello\n```')
    vi.useFakeTimers()
    try {
      await act(async () => button().click())
      expect(button().getAttribute('aria-label')).toBe('Copied')
      await act(async () => vi.advanceTimersByTime(1500))
      expect(button().getAttribute('aria-label')).toBe('Copy code')
    } finally {
      vi.useRealTimers()
    }
  })

  it('copies the current contents after a streaming update, including an unfinished fence', async () => {
    await render('```sh\necho first')
    await render('```sh\necho first\necho second')
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 150)))
    await act(async () => button().click())
    expect(writeText).toHaveBeenLastCalledWith('echo first\necho second')
  })

  it('provides the same copy control in reasoning and leaves inline code alone', async () => {
    await render('Inspect `inline` and:\n\n```py\n    check()\n```', 'reasoning')
    expect(buttons()).toHaveLength(1)
    await act(async () => button().click())
    expect(writeText).toHaveBeenLastCalledWith('    check()')
  })

  it('reports clipboard failures without showing a success checkmark, and allows a retry', async () => {
    writeText.mockRejectedValueOnce(new Error('Clipboard unavailable'))
    await render('```\nhello\n```')
    await act(async () => button().click())
    expect(button().getAttribute('aria-label')).toBe('Copy code')
    expect(useToasts.getState().toasts).toEqual([
      expect.objectContaining({ tone: 'danger', label: 'Not copied', title: 'Clipboard unavailable' }),
    ])
    await act(async () => button().click())
    expect(button().getAttribute('aria-label')).toBe('Copied')
  })

  it('keeps rendering Mermaid as a diagram', async () => {
    await render('```mermaid\nflowchart TD\nA-->B\n```')
    expect(renderMermaidSvg).toHaveBeenCalledWith('flowchart TD\nA-->B', expect.any(String))
    expect(container.querySelector('[aria-label="Mermaid diagram"] .mermaid-svg')).not.toBeNull()
    expect(buttons()).toHaveLength(0)
  })

  it('switches between code and a diagram when a streaming fence language changes', async () => {
    await render('```\nflowchart TD\nA-->B\n```')
    expect(buttons()).toHaveLength(1)
    await render('```mermaid\nflowchart TD\nA-->B\n```')
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 150)))
    expect(container.querySelector('[aria-label="Mermaid diagram"]')).not.toBeNull()
    expect(buttons()).toHaveLength(0)
    await render('```text\nflowchart TD\nA-->B\n```')
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 150)))
    await act(async () => button().click())
    expect(writeText).toHaveBeenLastCalledWith('flowchart TD\nA-->B')
  })
})
