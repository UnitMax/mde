// @vitest-environment happy-dom

import { Editor, Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatCodeHighlighting } from '../src/renderer/lib/chat-code-highlight'
import { languageForFence } from '../src/renderer/lib/code-languages'
import * as languages from '../src/renderer/lib/code-languages'
import { markdownPreviewExtensions } from '../src/renderer/lib/markdown-extensions'

const editors: Editor[] = []
const colors = Extension.create({ name: 'chatCodeColors', addProseMirrorPlugins: () => [chatCodeHighlighting()] })

function preview(code: string, label = 'cpp'): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [...markdownPreviewExtensions, colors],
    content: `\`\`\`${label}\n${code}\n\`\`\``,
    contentType: 'markdown',
    editable: false,
  })
  editors.push(editor)
  return editor
}

function tokens(editor: Editor): HTMLElement[] {
  return Array.from(editor.view.dom.querySelectorAll<HTMLElement>('pre code span[style]'))
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
  vi.restoreAllMocks()
})

describe('chat code block syntax highlighting with installed language packs', () => {
  it.each([
    ['cpp', 'int main() { return 42; }'],
    ['c++', 'int main() { return 42; }'],
    ['c', 'int main() { return 42; }'],
    ['javascript', 'const value = "hello"'],
    ['typescript', 'const value: string = "hello"'],
    ['jsx', 'const view = <div>Hello</div>'],
    ['tsx', 'const view: JSX.Element = <div>Hello</div>'],
    ['python', 'def greet():\n    return "hello"'],
    ['rust', 'fn main() { let value = 42; }'],
    ['java', 'class Main { int value = 42; }'],
    ['go', 'package main\nfunc main() { return }'],
    ['json', '{ "value": 42 }'],
    ['html', '<div class="hello">World</div>'],
    ['css', '.hello { color: red; }'],
    ['xml', '<hello value="42"/>'],
    ['yaml', 'value: 42'],
    ['sql', 'SELECT * FROM users WHERE id = 42'],
    ['bash', 'echo "hello"'],
    ['shell', 'echo "hello"'],
    ['powershell', '$value = "hello"'],
    ['toml', 'value = "hello"'],
    ['dockerfile', 'FROM alpine:latest'],
    ['markdown', '# Hello\n\n**world**'],
  ])('highlights %s and preserves the exact source', async (label, code) => {
    const editor = preview(code, label)
    const document = editor.getJSON()
    await vi.waitFor(() => expect(tokens(editor).length).toBeGreaterThan(0))
    expect(editor.view.dom.querySelector('pre code')?.textContent).toBe(code)
    expect(editor.getJSON()).toEqual(document)
    expect(editor.getMarkdown()).toContain(code)
    expect(editor.getHTML()).not.toContain('style=')
  })

  it('colors C++ keywords, types, numbers, strings and multiline comments with the shared theme variables', async () => {
    const editor = preview('/* first\nsecond */\nint main() { const char* text = "hello"; return 42; }')
    await vi.waitFor(() => expect(tokens(editor).length).toBeGreaterThan(0))
    const color = (text: string): string | undefined => tokens(editor).find((span) => span.textContent === text)?.style.color
    expect(color('return')).toBe('var(--color-syntax-keyword)')
    expect(color('int')).toBe('var(--color-syntax-type)')
    expect(color('42')).toBe('var(--color-syntax-number)')
    expect(color('"hello"')).toBe('var(--color-syntax-string)')
    expect(tokens(editor).find((span) => span.textContent === '/* first\nsecond */')?.style.fontStyle).toBe('italic')
  })

  it('updates colors for incomplete streamed code and removes old colors when the language changes', async () => {
    const editor = preview('int main() { return 1; }')
    await vi.waitFor(() => expect(tokens(editor).length).toBeGreaterThan(0))
    editor.commands.setContent('```cpp\nint main() { return "partial', { contentType: 'markdown' })
    expect(editor.view.dom.querySelector('pre code')?.textContent).toBe('int main() { return "partial')
    expect(tokens(editor).some((span) => span.style.color === 'var(--color-syntax-string)')).toBe(true)
    editor.commands.setContent('```unknown\nint main() { return 1; }\n```', { contentType: 'markdown' })
    expect(tokens(editor)).toHaveLength(0)
  })

  it('leaves unlabelled, unsupported and oversized blocks plain and does not interpret code as HTML', async () => {
    for (const label of ['', 'unknown', 'text', 'constructor', '__proto__']) {
      const code = '<script>alert(1)</script>'
      const editor = preview(code, label)
      expect(tokens(editor)).toHaveLength(0)
      expect(editor.view.dom.querySelector('script')).toBeNull()
      expect(editor.view.dom.querySelector('pre code')?.textContent).toBe(code)
    }
    expect(tokens(preview('x'.repeat(200_001)))).toHaveLength(0)
  })

  it('keeps document positions and text selection intact after asynchronous highlighting', async () => {
    const editor = preview('int main() { return 42; }')
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 4)))
    await vi.waitFor(() => expect(tokens(editor).length).toBeGreaterThan(0))
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe('int')
  })

  it('normalizes fence labels and loads the same parser for aliases', () => {
    expect(languageForFence(' C++ title="example" ')?.load).toBe(languageForFence('cpp')?.load)
    expect(languageForFence('TS')?.load).toBe(languageForFence('typescript')?.load)
    expect(languageForFence('dockerfile')?.name).toBe('Dockerfile')
    expect(languageForFence('csharp')).toBeNull()
  })

  it('leaves the code visible when its language pack fails to load', async () => {
    const load = vi.fn(async () => { throw new Error('Language unavailable') })
    vi.spyOn(languages, 'languageForFence').mockReturnValue({ name: 'Unavailable', load })
    const editor = preview('int main() { return 42; }')
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(tokens(editor)).toHaveLength(0)
    expect(editor.view.dom.querySelector('pre code')?.textContent).toBe('int main() { return 42; }')
  })

  it('does not apply stale colors when a language load finishes after the document changes', async () => {
    const cpp = languageForFence('cpp')!
    let release!: (extension: Awaited<ReturnType<typeof cpp.load>>) => void
    const load = () => new Promise<Awaited<ReturnType<typeof cpp.load>>>((resolve) => { release = resolve })
    const original = languageForFence
    vi.spyOn(languages, 'languageForFence').mockImplementation((label) => label === 'cpp' ? { name: cpp.name, load } : original(label))
    const editor = preview('int main() { return 42; }')
    editor.commands.setContent('```text\nplain text\n```', { contentType: 'markdown' })
    release(await cpp.load())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(tokens(editor)).toHaveLength(0)
    expect(editor.view.dom.querySelector('pre code')?.textContent).toBe('plain text')
  })
})
