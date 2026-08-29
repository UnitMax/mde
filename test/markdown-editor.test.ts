// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { TableKit } from '@tiptap/extension-table'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'

function createExtensions() {
  return [
    StarterKit.configure({
      link: {
        openOnClick: false,
      },
    }),
    TableKit,
    Markdown.configure({
      markedOptions: {
        gfm: true,
      },
    }),
  ]
}

const editors: Editor[] = []

function createEditor(content = ''): Editor {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    extensions: createExtensions(),
    content,
    contentType: 'markdown',
  })
  editors.push(editor)
  return editor
}

function collectNodeTypes(value: unknown, result: string[] = []): string[] {
  if (!value || typeof value !== 'object') return result
  const record = value as Record<string, unknown>
  if (typeof record.type === 'string') result.push(record.type)
  if (Array.isArray(record.content)) {
    for (const child of record.content) collectNodeTypes(child, result)
  }
  return result
}

function collectAttrs(value: unknown, result: Record<string, unknown>[] = []) {
  if (!value || typeof value !== 'object') return result
  const record = value as Record<string, unknown>
  if (record.attrs && typeof record.attrs === 'object' && !Array.isArray(record.attrs)) {
    result.push(record.attrs as Record<string, unknown>)
  }
  if (Array.isArray(record.content)) {
    for (const child of record.content) collectAttrs(child, result)
  }
  if (Array.isArray(record.marks)) {
    for (const mark of record.marks) collectAttrs(mark, result)
  }
  return result
}

describe('MarkdownEditor configuration', () => {
  afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy()
    document.body.replaceChildren()
  })

  it('does not create nodes or attributes outside the registered schema for raw HTML', () => {
    const editor = createEditor()
    const parsed = editor.markdown?.parse(
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>',
    )

    expect(parsed).toBeDefined()
    expect(collectNodeTypes(parsed)).not.toContain('script')
    expect(collectNodeTypes(parsed)).not.toContain('img')
    expect(collectNodeTypes(parsed).every((type) => editor.schema.nodes[type])).toBe(true)
    expect(
      collectAttrs(parsed).some((attrs) => Object.keys(attrs).some((name) => /^on/i.test(name))),
    ).toBe(false)
  })

  it('parses GFM tables and serializes the document back to Markdown', () => {
    const editor = createEditor()
    editor.commands.setContent(
      '| Column A | Column B |\n| --- | --- |\n| One | Two |',
      { contentType: 'markdown' },
    )

    expect(editor.getJSON().content?.some((node) => node.type === 'table')).toBe(true)
    expect(editor.getMarkdown()).toContain('| Column A | Column B |')
  })

  it('loads existing Markdown bullet lines as a bullet list', () => {
    const editor = createEditor('Notes\n\n- first item\n- second item')

    expect(editor.getJSON().content?.some((node) => node.type === 'bulletList')).toBe(true)
    expect(editor.getMarkdown()).toContain('- first item')
  })

  it('rejects javascript links when formatted HTML is pasted', () => {
    const editor = createEditor()
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        types: ['text/html', 'text/plain'],
        getData: (type: string) =>
          type === 'text/html'
            ? '<p><a href="javascript:alert(1)">unsafe</a> <a href="https://example.com">safe</a></p>'
            : type === 'text/plain'
              ? 'unsafe safe'
              : '',
      },
    })

    editor.view.dom.dispatchEvent(event)

    const json = editor.getJSON()
    const attrs = collectAttrs(json)
    expect(JSON.stringify(json)).not.toContain('javascript:')
    expect(attrs.some((entry) => entry.href === 'https://example.com')).toBe(true)
  })
})
