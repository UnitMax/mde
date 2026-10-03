// @vitest-environment happy-dom

import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { markdownPreviewExtensions } from '../src/renderer/lib/markdown-extensions'
import { getTerminalSettings, saveTerminalSettings } from '../src/renderer/terminal/terminal-settings'

const { renderMermaidSvg } = vi.hoisted(() => ({ renderMermaidSvg: vi.fn() }))
vi.mock('../src/renderer/lib/mermaid-preview', () => ({ renderMermaidSvg }))

const editors: Editor[] = []

function fragment(label: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  text.textContent = label
  svg.append(text)
  fragment.append(svg)
  return fragment
}

function label(editor: Editor): string | null | undefined {
  return editor.view.dom.querySelector('.mermaid-svg')?.shadowRoot?.querySelector('text')?.textContent
}

function preview(content: string): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: markdownPreviewExtensions,
    content,
    contentType: 'markdown',
    editable: false,
  })
  editors.push(editor)
  return editor
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
  renderMermaidSvg.mockReset()
  localStorage.clear()
})

describe('Mermaid code block preview', () => {
  it('renders Mermaid fences as selectable SVG and preserves ordinary code and Markdown source', async () => {
    renderMermaidSvg.mockImplementation(async () => fragment('A to B'))
    const editor = preview('```mermaid\nflowchart TD\nA-->B\n```\n\n```ts\nconst a = 1\n```')
    await vi.waitFor(() => expect(label(editor)).toBe('A to B'))
    expect(renderMermaidSvg).toHaveBeenCalledWith('flowchart TD\nA-->B', 'slate')
    expect(editor.view.dom.querySelector('pre code.language-ts')?.textContent).toBe('const a = 1')
    expect(editor.view.dom.querySelector('svg')).toBeNull()
    expect(editor.getMarkdown()).toContain('```mermaid\nflowchart TD\nA-->B\n```')
  })

  it('shows failed diagrams as escaped source without displaying parser errors as HTML', async () => {
    renderMermaidSvg.mockRejectedValue(new Error('<img src=x onerror=alert(1)>'))
    const editor = preview('```mermaid\n<script>alert(1)</script>\n```')
    await vi.waitFor(() => expect(editor.view.dom.textContent).toContain('Cannot preview'))
    expect(editor.view.dom.querySelector('pre code')?.textContent).toBe('<script>alert(1)</script>')
    expect(editor.view.dom.querySelector('script, img')).toBeNull()
  })

  it('ignores outdated results after the source changes', async () => {
    let resolveOld!: (svg: DocumentFragment) => void
    renderMermaidSvg.mockReturnValueOnce(new Promise<DocumentFragment>((resolve) => { resolveOld = resolve }))
    renderMermaidSvg.mockResolvedValueOnce(fragment('new'))
    const editor = preview('```mermaid\nflowchart TD\nA-->B\n```')
    editor.commands.setContent('```mermaid\nflowchart TD\nC-->D\n```', { contentType: 'markdown' })
    await vi.waitFor(() => expect(label(editor)).toBe('new'))
    resolveOld(fragment('old'))
    await Promise.resolve()
    expect(label(editor)).toBe('new')
  })

  it('rerenders on theme changes and unsubscribes when the preview closes', async () => {
    renderMermaidSvg.mockImplementation(async (_source, theme: string) => fragment(theme))
    const editor = preview('```mermaid\nflowchart TD\nA-->B\n```')
    await vi.waitFor(() => expect(label(editor)).toBe('slate'))
    saveTerminalSettings({ ...getTerminalSettings(), theme: 'frost' })
    await vi.waitFor(() => expect(label(editor)).toBe('frost'))
    editor.destroy()
    const calls = renderMermaidSvg.mock.calls.length
    saveTerminalSettings({ ...getTerminalSettings(), theme: 'ember' })
    expect(renderMermaidSvg).toHaveBeenCalledTimes(calls)
  })

  it('does not mount a pending result after the preview closes', async () => {
    let complete!: (svg: DocumentFragment) => void
    renderMermaidSvg.mockReturnValueOnce(new Promise<DocumentFragment>((resolve) => { complete = resolve }))
    const editor = preview('```mermaid\nflowchart TD\nA-->B\n```')
    const dom = editor.view.dom
    editor.destroy()
    complete(fragment('Late result'))
    await Promise.resolve()
    expect(dom.querySelector('.mermaid-svg')).toBeNull()
  })
})
