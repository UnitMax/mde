import { Fragment, useRef, useState, type MouseEvent, type ReactElement, type ReactNode, type RefObject } from 'react'
import { Code, Copy, ExternalLink, FileText, Link, MessagesSquare, Quote, TextSelect } from 'lucide-react'
import type { ChatMessage } from '@shared/types'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { clickedSelection, conversationMarkdown, menuTarget, messageMarkdown, type MenuTarget } from '@/lib/chat-menu'
import { quoteBlock } from '@/lib/chat-quote'
import { ipcErrorMessage } from '@/lib/ipc-error'

/** What the right-click landed on, taken when it happened so that a streaming update cannot change it. */
interface Snapshot extends MenuTarget {
  /** The selected text, when the click landed on it. */
  selection: string
  /** The Markdown of the message under the cursor. */
  markdown: string | null
}

const NOTHING: Snapshot = { selection: '', code: null, link: null, messageId: null, markdown: null }

const ICON = 'h-3.5 w-3.5'

function MenuItems({
  snapshot,
  messages,
  complete,
  transcriptRef,
  onCopy,
  onQuote,
}: {
  snapshot: Snapshot
  messages: readonly ChatMessage[]
  complete: boolean
  transcriptRef: RefObject<HTMLElement | null>
  onCopy: (text: string) => void
  onQuote: (text: string) => void
}): JSX.Element {
  // Only worked out while the menu is open: it is the whole conversation.
  const conversation = conversationMarkdown(messages)
  const { selection, code, link, markdown } = snapshot
  const sections: ReactElement[][] = [
    [
      ...(selection
        ? [
            <ContextMenuItem key="copy" data-testid="chat-menu-copy" onSelect={() => onCopy(selection)}>
              <Copy aria-hidden className={ICON} />
              Copy
            </ContextMenuItem>,
            // Only text with something in it to quote: a selection of blank space has no quote.
            ...(quoteBlock(selection) !== null
              ? [
                  <ContextMenuItem key="quote" data-testid="chat-menu-quote" onSelect={() => onQuote(selection)}>
                    <Quote aria-hidden className={ICON} />
                    Quote
                  </ContextMenuItem>,
                ]
              : []),
          ]
        : []),
      ...(code
        ? [
            <ContextMenuItem key="code" data-testid="chat-menu-copy-code" onSelect={() => onCopy(code)}>
              <Code aria-hidden className={ICON} />
              Copy code
            </ContextMenuItem>,
          ]
        : []),
      ...(link
        ? [
            <ContextMenuItem key="link" data-testid="chat-menu-copy-link" onSelect={() => onCopy(link.external ?? link.href)}>
              <Link aria-hidden className={ICON} />
              Copy link address
            </ContextMenuItem>,
            ...(link.external
              ? [
                  <ContextMenuItem
                    key="open"
                    data-testid="chat-menu-open-link"
                    onSelect={() => window.open(link.external!, '_blank', 'noopener,noreferrer')}
                  >
                    <ExternalLink aria-hidden className={ICON} />
                    Open link
                  </ContextMenuItem>,
                ]
              : []),
          ]
        : []),
    ],
    markdown
      ? [
          <ContextMenuItem key="message" data-testid="chat-menu-copy-message" onSelect={() => onCopy(markdown)}>
            <FileText aria-hidden className={ICON} />
            Copy message as Markdown
          </ContextMenuItem>,
        ]
      : [],
    [
      <ContextMenuItem
        key="select-all"
        data-testid="chat-menu-select-all"
        disabled={messages.length === 0}
        onSelect={() => {
          const transcript = transcriptRef.current
          if (transcript) window.getSelection()?.selectAllChildren(transcript)
        }}
      >
        <TextSelect aria-hidden className={ICON} />
        Select all
      </ContextMenuItem>,
      <ContextMenuItem
        key="conversation"
        data-testid="chat-menu-copy-conversation"
        disabled={!conversation}
        onSelect={() => onCopy(conversation)}
      >
        <MessagesSquare aria-hidden className={ICON} />
        {complete ? 'Copy conversation as Markdown' : 'Copy loaded messages as Markdown'}
      </ContextMenuItem>,
    ],
  ].filter((section) => section.length > 0)

  return (
    <>
      {sections.map((section, index) => (
        <Fragment key={index}>
          {index > 0 && <ContextMenuSeparator />}
          {section}
        </Fragment>
      ))}
    </>
  )
}

/**
 * The right-click menu of a conversation. It wraps the scrolling transcript, so one menu serves every
 * message and a selection that runs across several of them can be copied. What it offers depends on what
 * is under the cursor: a code block, a link, a message.
 */
export function ChatTranscriptMenu({
  messages,
  complete,
  transcriptRef,
  onCopyError,
  onQuote,
  children,
}: {
  messages: readonly ChatMessage[]
  /** Whether every message of the thread is loaded, which the wording of "Copy conversation" tells. */
  complete: boolean
  transcriptRef: RefObject<HTMLElement | null>
  /** Told how a copy went: the reason it failed, or null once one worked. */
  onCopyError: (message: string | null) => void
  /** Quotes the selected text in the message box. */
  onQuote: (text: string) => void
  children: ReactNode
}): JSX.Element {
  const [snapshot, setSnapshot] = useState<Snapshot>(NOTHING)
  // The quote is added once the menu has closed: the message box has to be free to take the focus.
  const quoteAfterClose = useRef<string | null>(null)

  const take = (event: MouseEvent<HTMLElement>): void => {
    const transcript = transcriptRef.current
    if (!transcript || !(event.target instanceof Element)) return
    const found = menuTarget(event.target, transcript)
    const message = found.messageId ? messages.find((item) => item.id === found.messageId) : undefined
    setSnapshot({
      ...found,
      selection: clickedSelection(window.getSelection(), transcript, event.target, event.clientX, event.clientY),
      markdown: message ? messageMarkdown(message) : null,
    })
  }

  const copy = (text: string): void => {
    // The page may not read or write the clipboard itself; the main process does it.
    window.api.clipboard.writeText(text).then(
      () => onCopyError(null),
      (error: unknown) => onCopyError(ipcErrorMessage(error, 'Could not copy.')),
    )
  }

  return (
    <ContextMenu>
      {/* Taken in the capture phase, so it is in place before the menu opens from the same event. */}
      <ContextMenuTrigger asChild onContextMenuCapture={take}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        data-testid="chat-menu"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const quote = quoteAfterClose.current
          quoteAfterClose.current = null
          if (quote) onQuote(quote)
        }}
      >
        <MenuItems
          snapshot={snapshot}
          messages={messages}
          complete={complete}
          transcriptRef={transcriptRef}
          onCopy={copy}
          onQuote={(text) => { quoteAfterClose.current = text }}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}
