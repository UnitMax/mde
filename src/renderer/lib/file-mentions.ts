import type { ChatFileEntry, ChatFileMention } from '@shared/types'
import { fileMentionTokens, mentionText, type FileTrigger } from '@shared/file-mentions'

/**
 * Writes the chosen file over the `@word` being typed, with a space after it so typing carries on. A space or
 * line break that already follows is kept, not doubled.
 */
export function applyFile(text: string, trigger: FileTrigger, entry: ChatFileEntry): { text: string; caret: number } {
  const written = mentionText(entry.path)
  const after = text.slice(trigger.end)
  const gap = /^\s/.test(after) ? '' : ' '
  const caret = trigger.start + written.length + (gap || after.startsWith(' ') ? 1 : 0)
  return { text: text.slice(0, trigger.start) + written + gap + after, caret }
}

/**
 * Writes a folder over the `@word` being typed and leaves the word open, without a space or closing quote, so the
 * picker goes on to list what is in the folder, as Tab does in a shell.
 */
export function enterFolder(text: string, trigger: FileTrigger, path: string): { text: string; caret: number } {
  const full = mentionText(path)
  const written = full.endsWith('"') ? full.slice(0, -1) : full
  return { text: text.slice(0, trigger.start) + written + text.slice(trigger.end), caret: trigger.start + written.length }
}

/** A path as the picker shows it: the name first, and the folders it is in after it. */
export function describeFile(path: string): { name: string; folder: string } {
  const bare = path.endsWith('/') ? path.slice(0, -1) : path
  const cut = bare.lastIndexOf('/')
  const name = cut < 0 ? bare : bare.slice(cut + 1)
  return { name: path.endsWith('/') ? `${name}/` : name, folder: cut < 0 ? '' : bare.slice(0, cut + 1) }
}

/** A piece of a sent message: plain text, or a file or folder the message named. */
export interface MentionPart {
  text: string
  mention?: ChatFileMention
}

/**
 * Cuts a sent message where it names files, so those words can be marked. A word is marked when it is written
 * as one of the mentions the message was sent with; an `@` that only looks like one is left as text.
 */
export function splitMentions(text: string, mentions: readonly ChatFileMention[]): MentionPart[] {
  if (mentions.length === 0 || !text.includes('@')) return [{ text }]
  const sent = new Map(mentions.map((mention) => [mention.text, mention]))
  const parts: MentionPart[] = []
  let from = 0
  for (const token of fileMentionTokens(text)) {
    const mention = sent.get(token.text)
    if (!mention) continue
    if (token.start > from) parts.push({ text: text.slice(from, token.start) })
    parts.push({ text: token.text, mention })
    from = token.end
  }
  if (from < text.length) parts.push({ text: text.slice(from) })
  return parts.length ? parts : [{ text }]
}
