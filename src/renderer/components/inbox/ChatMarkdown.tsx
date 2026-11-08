import { memo, useEffect, useRef, type MouseEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { externalLinkUrl } from '@/lib/file-viewer'
import { markdownPreviewExtensions } from '@/lib/markdown-extensions'
import { cn } from '@/lib/utils'

/** Streaming text is re-parsed at most this often. */
const MARKDOWN_UPDATE_MS = 120

/** Read-only Markdown for assistant replies and reasoning; the main process checks external links. */
export const ChatMarkdown = memo(function ChatMarkdown({
  text,
  variant = 'message',
  label,
}: {
  text: string
  variant?: 'message' | 'reasoning'
  /** The accessible name of the text, for Markdown that is neither a message nor reasoning. */
  label?: string
}): JSX.Element {
  const editor = useEditor(
    {
      extensions: markdownPreviewExtensions,
      content: text,
      contentType: 'markdown',
      editable: false,
      injectCSS: false,
      editorProps: {
        attributes: {
          class: 'markdown-prose chat-markdown',
          'aria-label': label ?? (variant === 'reasoning' ? 'Assistant reasoning' : 'Assistant message'),
        },
      },
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
    },
    [],
  )
  const latest = useRef(text)
  latest.current = text

  // The editor starts with the text it is given, so only a change to it needs the editor to be filled again. Redrawing
  // what is already drawn would replace its nodes under a selection or a search match for nothing.
  const drawn = useRef(text)
  useEffect(() => {
    if (drawn.current === text) return undefined
    const timer = window.setTimeout(() => {
      drawn.current = latest.current
      editor.commands.setContent(latest.current, { contentType: 'markdown', emitUpdate: false })
    }, MARKDOWN_UPDATE_MS)
    return () => window.clearTimeout(timer)
  }, [text, editor])

  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    const anchor = (event.target as HTMLElement).closest('a')
    if (!anchor) return
    event.preventDefault()
    const href = anchor.getAttribute('href')
    if (!href) return
    const external = externalLinkUrl(href)
    if (external) window.open(external, '_blank', 'noopener,noreferrer')
  }

  return (
    <div
      className={cn(
        'min-w-0 break-words leading-relaxed',
        // Reasoning is shown on the rail of its row, which is its left edge.
        variant === 'reasoning' ? 'text-[12.5px] text-fg-muted' : 'text-[14px] text-fg',
      )}
      onClick={onClick}
      // The agent's replies are searched; its reasoning is not.
      data-chat-searchable={variant === 'message' ? '' : undefined}
    >
      <EditorContent editor={editor} />
    </div>
  )
})
