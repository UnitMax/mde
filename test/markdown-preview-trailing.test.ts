// @vitest-environment happy-dom

import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { markdownPreviewExtensions } from '../src/renderer/lib/markdown-extensions'

const editors: Editor[] = []

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

afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()))

describe('Markdown preview is not changed by clicking it', () => {
  it.each([
    ['a list', '- a = 7\n- b = 5'],
    ['a code block', '```ts\nconst a = 1\n```'],
    ['a table', '| a | b |\n| - | - |\n| 1 | 2 |'],
  ])('adds no empty paragraph after %s when the selection moves', (_name, markdown) => {
    const editor = preview(markdown)
    const before = editor.state.doc.childCount
    const html = editor.view.dom.innerHTML
    // What a click in the text does: a transaction that only moves the selection.
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atStart(editor.state.doc)))
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)))
    expect(editor.state.doc.childCount).toBe(before)
    expect(editor.view.dom.innerHTML).toBe(html)
  })
})
