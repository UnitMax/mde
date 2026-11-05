import type { ChatMessage } from '@shared/types'
import { externalLinkUrl } from '@/lib/file-viewer'

/** Drops blank lines before the text and any whitespace after it, but keeps the first line's indentation. */
function tidy(text: string): string {
  return text.replace(/^(?:[ \t]*\n)+/, '').trimEnd()
}

/**
 * What "Copy message as Markdown" puts on the clipboard, or null when the message has nothing to copy.
 * A reply gives the Markdown source of its text, so code fences and lists survive; its reasoning and
 * tool calls are left out. A note gives its text and details.
 */
export function messageMarkdown(message: ChatMessage): string | null {
  switch (message.kind) {
    case 'user':
      return message.text.trim() ? tidy(message.text) : null
    case 'assistant': {
      const text = message.parts.flatMap((part) => (part.kind === 'text' && part.text.trim() ? [tidy(part.text)] : []))
      return text.length > 0 ? text.join('\n\n') : null
    }
    case 'note': {
      const text = [message.text, message.detail ?? ''].map(tidy).filter(Boolean)
      return text.length > 0 ? text.join('\n\n') : null
    }
  }
}

/**
 * The conversation as Markdown: what you wrote under "You" and what the agent answered under
 * "Assistant". The agent's steps in a row share one heading. Notes, reasoning and tool calls are left out.
 */
export function conversationMarkdown(messages: readonly ChatMessage[]): string {
  const sections: Array<{ who: 'You' | 'Assistant'; parts: string[] }> = []
  for (const message of messages) {
    if (message.kind === 'note') continue
    const text = messageMarkdown(message)
    if (text === null) continue
    const who = message.kind === 'user' ? 'You' : 'Assistant'
    const last = sections[sections.length - 1]
    if (last && last.who === who) last.parts.push(text)
    else sections.push({ who, parts: [text] })
  }
  return sections.map((section) => `## ${section.who}\n\n${section.parts.join('\n\n')}`).join('\n\n')
}

/** The selected text, when the selection lies inside `transcript` (from where it starts to where it ends). */
export function selectedTextIn(selection: Selection | null, transcript: Element): string {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return ''
  const { anchorNode, focusNode } = selection
  if (!anchorNode || !focusNode || !transcript.contains(anchorNode) || !transcript.contains(focusNode)) return ''
  return selection.toString()
}

/**
 * The selected text, when it lies inside `transcript` and a right-click at (`x`, `y`) landed on it.
 * Right-clicking somewhere else must not offer to copy text the person is no longer pointing at.
 */
export function clickedSelection(
  selection: Selection | null,
  transcript: Element,
  target: Node,
  x: number,
  y: number,
): string {
  const text = selectedTextIn(selection, transcript)
  if (!selection || !text) return ''
  const caret = typeof document.caretRangeFromPoint === 'function' ? document.caretRangeFromPoint(x, y) : null
  try {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index)
      // The exact spot clicked when the page can say what it is; else the element that was clicked.
      if (caret ? range.isPointInRange(caret.startContainer, caret.startOffset) : range.intersectsNode(target)) return text
    }
  } catch {
    // A point in another document or a detached node is not inside the selection.
  }
  return ''
}

export interface MenuTarget {
  /** The text of the code block under the cursor. */
  code: string | null
  /** The link under the cursor; `external` is its target when it is a web link the app may open. */
  link: { href: string; external: string | null } | null
  /** The message under the cursor. */
  messageId: string | null
}

/** What is under a right-click in the transcript, read from the page. */
export function menuTarget(element: Element | null, transcript: Element): MenuTarget {
  if (!element || !transcript.contains(element)) return { code: null, link: null, messageId: null }
  const code = element.closest('pre')?.textContent?.replace(/\n+$/, '') ?? ''
  const href = element.closest('a[href]')?.getAttribute('href') ?? null
  return {
    code: code || null,
    link: href ? { href, external: externalLinkUrl(href) } : null,
    messageId: element.closest('[data-chat-message]')?.getAttribute('data-chat-message') ?? null,
  }
}
