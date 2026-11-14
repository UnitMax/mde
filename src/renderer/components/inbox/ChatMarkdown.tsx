import { memo, useContext, useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { ChatFileSourceContext } from '@/components/inbox/mcp-context'
import { ChatFileLinks, type ChatFileSource } from '@/lib/chat-file-links'
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
  // Read when the editor looks names up and when one is clicked, so a new source needs no new editor.
  const files = useContext(ChatFileSourceContext)
  const filesRef = useRef<ChatFileSource | null>(files)
  filesRef.current = files
  const editor = useEditor(
    {
      extensions: [...markdownPreviewExtensions, ChatFileLinks.configure({ source: filesRef })],
      content: text,
      contentType: 'markdown',
      editable: false,
      injectCSS: false,
      editorProps: {
        attributes: {
          class: variant === 'reasoning' ? 'markdown-prose chat-markdown' : 'markdown-prose chat-markdown chat-reply',
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

  /** A file of the thread's folder that the reply names, clicked or chosen with the keyboard: it opens in the viewer. */
  const openFile = (target: HTMLElement): boolean => {
    const chip = target.closest<HTMLElement>('[data-file-path]') ?? target.closest('a')?.querySelector<HTMLElement>('[data-file-path]')
    const path = chip?.dataset.filePath
    if (!path || !filesRef.current) return false
    const line = Number(chip.dataset.fileLine)
    filesRef.current.open(line > 0 ? { path, line } : { path })
    return true
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' || !(event.target as HTMLElement).matches('[data-file-path]')) return
    event.preventDefault()
    openFile(event.target as HTMLElement)
  }

  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (openFile(event.target as HTMLElement)) {
      event.preventDefault()
      return
    }
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
        'min-w-0 break-words',
        // Reasoning is shown on the rail of its row, which is its left edge. The line height comes after the size:
        // cn treats a text size as also setting the line height, so it would drop a leading class placed before it.
        variant === 'reasoning' ? 'text-[13px] text-fg-muted' : 'text-[14px] leading-[1.65] text-[var(--chat-text)]',
      )}
      onClick={onClick}
      onKeyDown={onKeyDown}
      // The agent's replies are searched; its reasoning is not.
      data-chat-searchable={variant === 'message' ? '' : undefined}
    >
      <EditorContent editor={editor} />
    </div>
  )
})
