/**
 * A message refers to a file or folder of the project by writing `@path`; a path with a space or other
 * awkward character is written in quotes, `@"my notes.txt"`. The composer (to offer files while typing and
 * to mark what is a mention), the sender (to attach what a message names) and the transcript (to mark them
 * again) all read the text with these rules, so what the picker writes is exactly what gets sent. Offsets
 * are UTF-16 string indices, as in `text.slice`. A folder's path ends in `/`.
 */

/** A message names at most this many files and folders; more is a message that talks about `@`, not one that attaches. */
export const FILE_MENTION_LIMIT = 20

/** The longest path a mention can have. */
export const FILE_MENTION_PATH_LIMIT = 1000

/** The `@word` being typed: `start` is the `@`, `end` the end of the word the caret is in or at. */
export interface FileTrigger {
  start: number
  end: number
  /** What was typed after the `@` (and the opening quote), up to the caret. */
  query: string
}

/** One mention found in a message. `text` is as written, with the `@` and any quotes. */
export interface FileMentionToken {
  start: number
  end: number
  text: string
  path: string
}

/** Characters that end an unquoted path: space, and the punctuation a sentence puts after a name. */
const UNQUOTED_END = /[\s,;:!?)\]}'"@]/
/** Where an `@` may begin a mention: at the start, after a space, or just inside a bracket. */
const OPENERS = /[\s(\[]/

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/**
 * Whether a path can be named in a message and sent: relative to the project, written with `/`, and
 * staying inside it. A quote or a control character cannot be written in either form.
 */
export function isMentionablePath(path: string): boolean {
  if (!path || path.length > FILE_MENTION_PATH_LIMIT) return false
  if (path.startsWith('/') || path.includes('\\') || path.includes('"') || CONTROL.test(path)) return false
  const segments = path.endsWith('/') ? path.slice(0, -1).split('/') : path.split('/')
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/** How a path is written in a message: bare when it can be, in quotes when a space or punctuation would end it. */
export function mentionText(path: string): string {
  const bare = !path.split('').some((char) => UNQUOTED_END.test(char)) && !path.endsWith('.')
  return bare ? `@${path}` : `@"${path}"`
}

/** The `@word` ending at the caret when the `@` starts a word, so `me@example.com` is not one. */
export function fileTriggerAt(text: string, caret: number): FileTrigger | null {
  if (!Number.isInteger(caret) || caret < 0 || caret > text.length) return null
  const before = text.slice(0, caret)
  const match = /(?:^|[\s(\[])@("[^"\n]*|[^\s,;:!?)\]}'"@]*)$/.exec(before)
  if (!match) return null
  const written = match[1] ?? ''
  const start = caret - written.length - 1
  const quoted = written.startsWith('"')
  let end = caret
  if (quoted) {
    // The closing quote belongs to the word, so a choice replaces it too.
    const close = text.indexOf('"', caret)
    const line = text.indexOf('\n', caret)
    if (close >= 0 && (line < 0 || close < line)) end = close + 1
  } else {
    while (end < text.length && !UNQUOTED_END.test(text[end]!)) end += 1
  }
  return { start, end, query: quoted ? written.slice(1) : written }
}

/**
 * The mentions a message makes, in the order written: every `@path` that starts a word. Whether the path is
 * really in the project is not known here; that is for whoever has the project to ask.
 */
export function fileMentionTokens(text: string): FileMentionToken[] {
  const tokens: FileMentionToken[] = []
  for (let at = text.indexOf('@'); at >= 0 && tokens.length < FILE_MENTION_LIMIT * 2; at = text.indexOf('@', at + 1)) {
    if (at > 0 && !OPENERS.test(text[at - 1]!)) continue
    let end = at + 1
    let path: string
    if (text[end] === '"') {
      const close = text.indexOf('"', end + 1)
      const line = text.indexOf('\n', end + 1)
      if (close < 0 || (line >= 0 && line < close)) continue
      path = text.slice(end + 1, close)
      end = close + 1
    } else {
      while (end < text.length && !UNQUOTED_END.test(text[end]!)) end += 1
      path = text.slice(at + 1, end)
      // A full stop after the name closes the sentence.
      while (path.endsWith('.')) { path = path.slice(0, -1); end -= 1 }
    }
    if (!isMentionablePath(path)) continue
    tokens.push({ start: at, end, text: text.slice(at, end), path })
  }
  return tokens
}
