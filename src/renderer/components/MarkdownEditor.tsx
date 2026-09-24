import { forwardRef, useImperativeHandle } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { markdownExtensions } from '@/lib/markdown-extensions'

export interface MarkdownEditorHandle {
  getMarkdown: () => string
}

interface MarkdownEditorProps {
  defaultValue: string
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ defaultValue }, ref): JSX.Element {
    // Keep the editor instance in this child so modal state updates do not recreate it.
    const editor = useEditor(
      {
        extensions: markdownExtensions,
        content: defaultValue,
        contentType: 'markdown',
        injectCSS: false,
        editorProps: {
          attributes: {
            id: 'todo-task-description',
            'aria-label': 'Description',
            class: 'markdown-prose',
          },
        },
        immediatelyRender: true,
        shouldRerenderOnTransaction: false,
      },
      [],
    )

    useImperativeHandle(
      ref,
      () => ({
        getMarkdown: () => editor.getMarkdown(),
      }),
      [editor],
    )

    return (
      <div className="todo-task-description-editor">
        <EditorContent editor={editor} className="todo-task-description-editor-content" />
      </div>
    )
  },
)
