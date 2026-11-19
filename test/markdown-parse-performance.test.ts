// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { marked } from 'marked'
import { Editor } from '@tiptap/core'
import { markdownExtensions, markdownPreviewExtensions, orderedListRegion } from '../src/renderer/lib/markdown-extensions'
import { reasoningPreview, reasoningTitle, textHeadline } from '../src/renderer/lib/chat-tools'
import { ChatMarkdown } from '../src/renderer/components/inbox/ChatMarkdown'

describe('Markdown parsing in long-running sessions', () => {
  it('gives each editor its own parser, so editors made earlier never slow a parse down', () => {
    const editors = Array.from({ length: 5 }, (_, index) =>
      new Editor({ extensions: index % 2 ? markdownExtensions() : markdownPreviewExtensions(), editable: false }))
    // The global parser is left as it was: no tokenizers pile up on it.
    expect(marked.defaults.extensions).toBeNull()
    const own = (editors[0]!.markdown as unknown as { markedInstance: { defaults: { extensions: { startBlock?: unknown[] } } } })
      .markedInstance.defaults.extensions
    expect(own.startBlock).toHaveLength(4)
    editors.forEach((editor) => editor.destroy())
  })

  it('reads lists, tables and math as before', () => {
    const editor = new Editor({ extensions: markdownPreviewExtensions(), editable: false })
    const text = '1. one\n2. two\n   more\n\nafter\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n$$\nx\n$$\n\ntext'
    const types = editor.markdown!.parse(text).content!.map((node) => node.type)
    expect(types).toEqual(['orderedList', 'paragraph', 'table', 'taskList', 'mathBlock', 'paragraph'])
    editor.destroy()
  })
})

describe('the text an ordered list can take', () => {
  it('ends before a line after a blank one that is neither blank, indented nor an item', () => {
    expect(orderedListRegion('1. a\n2. b\n\nafter\n3. c')).toBe('1. a\n2. b\n')
    expect(orderedListRegion('1. a\nlazy\n\n   indented\n\n2. b\n\nend')).toBe('1. a\nlazy\n\n   indented\n\n2. b\n')
    expect(orderedListRegion('1. a\n2. b')).toBe('1. a\n2. b')
  })
})

describe('the lines of a streamed thought', () => {
  it('are found however the text begins or breaks', () => {
    expect(reasoningPreview('\n\nFirst done. Second')).toBe('First done.')
    expect(reasoningPreview('\nLine one.\n\n')).toBe('Line one.')
    expect(reasoningPreview('\n')).toBeNull()
    // Only "\n" ends a line: "\r" does not start a heading.
    expect(reasoningPreview('word\r**Not a heading**\nNext.\n')).toBe('Next.')
    expect(reasoningPreview('**Planning**\nSome text.\n')).toBe('Planning')
    expect(reasoningTitle('\n  \n**Opening**\nrest')).toBe('Opening')
    expect(textHeadline('\n\n- **First** line\nsecond')).toBe('First line')
  })
})

describe('a streamed reply', () => {
  let dispose: (() => void) | undefined
  afterEach(async () => {
    await act(async () => dispose?.())
    dispose = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('is redrawn while text keeps coming, not only once it pauses', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    dispose = () => root.unmount()
    let text = 'Start'
    await act(async () => root.render(createElement(ChatMarkdown, { text })))
    // A token every 40 ms for 600 ms: a redraw that waited for a pause would still show "Start".
    for (let token = 0; token < 15; token += 1) {
      text += ` w${token}`
      await act(async () => {
        root.render(createElement(ChatMarkdown, { text }))
        vi.advanceTimersByTime(40)
      })
    }
    expect(container.textContent).toContain('w1')
    expect(container.textContent).not.toBe('Start')
    await act(async () => vi.advanceTimersByTime(1000))
    expect(container.textContent).toBe(text)
  })
})
