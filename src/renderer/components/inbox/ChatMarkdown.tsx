import { memo, useEffect, useRef, type MouseEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { externalLinkUrl } from '@/lib/file-viewer'
import { markdownPreviewExtensions } from '@/lib/markdown-extensions'

/** Streaming text is re-parsed at most this often. */
const MARKDOWN_UPDATE_MS = 120

/** Read-only Markdown for assistant text; links open in the browser after the main process checks them. */
export const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }): JSX.Element {
  const editor = useEditor(
    {
      extensions: markdownPreviewExtensions,
      content: text,
      contentType: 'markdown',
      editable: false,
      injectCSS: false,
      editorProps: { attributes: { class: 'markdown-prose chat-markdown', 'aria-label': 'Assistant message' } },
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
    },
    [],
  )
  const latest = useRef(text)
  latest.current = text

  useEffect(() => {
    const timer = window.setTimeout(() => {
      editor.commands.setContent(latest.current, { contentType: 'markdown', emitUpdate: false })
    }, MARKDOWN_UPDATE_MS)
    return () => window.clearTimeout(timer)
  }, [text, editor])

  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    const href = (event.target as HTMLElement).closest('a')?.getAttribute('href')
    if (!href) return
    event.preventDefault()
    const external = externalLinkUrl(href)
    if (external) window.open(external, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="min-w-0 text-[14px] leading-relaxed text-fg" onClick={onClick}>
      <EditorContent editor={editor} />
    </div>
  )
})
