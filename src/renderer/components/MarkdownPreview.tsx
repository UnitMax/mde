import { useEffect, type MouseEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { markdownPreviewExtensions } from '@/lib/markdown-extensions'
import { externalLinkUrl, resolveRelativeLink } from '@/lib/file-viewer'

interface MarkdownPreviewProps {
  /** File path relative to the session root, used to resolve relative links. */
  path: string
  content: string
  onOpenFile: (path: string) => void
}

export function MarkdownPreview({ path, content, onOpenFile }: MarkdownPreviewProps): JSX.Element {
  const editor = useEditor(
    {
      extensions: markdownPreviewExtensions,
      content,
      contentType: 'markdown',
      editable: false,
      injectCSS: false,
      editorProps: {
        attributes: {
          class: 'markdown-prose',
          'aria-label': 'Markdown preview',
        },
      },
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
    },
    [],
  )

  useEffect(() => {
    editor.commands.setContent(content, { contentType: 'markdown', emitUpdate: false })
  }, [content, editor])

  // The Link extension never navigates on its own (openOnClick is off), so a
  // click is routed here: web links go through window.open, whose target the
  // main process validates, and relative links open in this viewer.
  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    const anchor = (event.target as HTMLElement).closest('a')
    const href = anchor?.getAttribute('href')
    if (!href) return
    event.preventDefault()

    const external = externalLinkUrl(href)
    if (external) {
      window.open(external, '_blank', 'noopener,noreferrer')
      return
    }
    const target = resolveRelativeLink(path, href)
    if (target) onOpenFile(target)
  }

  return (
    <div className="markdown-preview h-full min-h-0 overflow-y-auto" onClick={onClick}>
      <EditorContent editor={editor} />
    </div>
  )
}
