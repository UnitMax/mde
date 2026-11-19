import { memo, useContext, useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { ChatCodeBlock } from '@/components/inbox/ChatCodeBlock'
import { ChatFileSourceContext } from '@/components/inbox/mcp-context'
import { ChatFileLinks, type ChatFileSource } from '@/lib/chat-file-links'
import { externalLinkUrl } from '@/lib/file-viewer'
import { markdownPreviewExtensions } from '@/lib/markdown-extensions'
import { cn } from '@/lib/utils'

/** Streaming text is re-parsed at most this often. */
const MARKDOWN_UPDATE_MS = 120
/** A streamed redraw waits at least this many times as long as the last one took. */
const REDRAW_COST_FACTOR = 4

/**
 * The Markdown a reply is drawn from. The parser keeps blank lines at either end as empty paragraphs, which drew a
 * line's worth of room under a text that ended in "\n\n" (as text before a tool call often does), so they are cut.
 * Only whole blank lines go at the start, so an indented first line keeps its indent.
 */
export function chatMarkdownSource(text: string): string {
  return text.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd()
}

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
      extensions: [
        ...markdownPreviewExtensions().filter((extension) => extension.name !== 'codeBlock'),
        ChatCodeBlock,
        ChatFileLinks.configure({ source: filesRef }),
      ],
      content: chatMarkdownSource(text),
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
  // While text streams in, it is redrawn on a steady beat rather than once the stream pauses, and the beat slows as the
  // text grows: each redraw parses all of it, so the wait is a few times what the last one took, which keeps a long
  // reply from taking up the renderer.
  const drawn = useRef(text)
  const redrawCost = useRef(0)
  const timer = useRef<number | null>(null)
  useEffect(() => {
    if (drawn.current === text || timer.current !== null) return
    timer.current = window.setTimeout(() => {
      timer.current = null
      if (drawn.current === latest.current) return
      const started = performance.now()
      drawn.current = latest.current
      editor.commands.setContent(chatMarkdownSource(latest.current), { contentType: 'markdown', emitUpdate: false })
      redrawCost.current = performance.now() - started
    }, Math.max(MARKDOWN_UPDATE_MS, redrawCost.current * REDRAW_COST_FACTOR))
  }, [text, editor])
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

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
