/**
 * The next-message suggestion: after a turn, the thread's own model is asked (through OpenCode's `generate`, which
 * adds nothing to the conversation) what the person would most likely send next. The answer is shown as ghost text
 * in the message box, so it must read as the person's own message, not as the assistant talking.
 */

/** What is asked after the conversation. The model sees it as the person's message, so it says plainly what is wanted. */
export const SUGGEST_PREAMBLE = [
  'Do not answer or continue the conversation. Instead, predict the single message the user is most likely to send next,',
  'given everything above. Write it exactly as the user would type it: in the user\'s own voice and language, as an instruction',
  'or question to the assistant, at most 20 words, one line, no quotes, no labels, no explanation.',
  'Prefer a concrete next step that follows from the last reply (for example running the tests, committing, or fixing what was found).',
  'If there is no obvious next message, reply with exactly NONE.',
  'Do not call any tools and do not take any actions.',
].join(' ')

/** The suggestion is a guess the person may never take, so a slow model is not waited on for long. */
export const SUGGEST_TIMEOUT_MS = 60_000

/** A suggestion longer than this is not a quick next message; it is cut at a word. */
export const SUGGESTION_MAX_LENGTH = 240

/** Labels a model puts in front of the message despite being asked not to. */
const LABEL = /^(?:\*\*)?(?:user|you|me|next(?:\s+(?:user\s+)?(?:message|prompt))?|suggested(?:\s+(?:next\s+)?(?:message|prompt))?|suggestion|prompt|message)(?:\*\*)?\s*[:：](?:\*\*)?\s*/i
const QUOTES: ReadonlyArray<readonly [string, string]> = [['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’'], ['`', '`'], ['«', '»'], ['„', '“']]

/**
 * Makes the model's answer into the message to suggest: its first nonempty line, without a label, quotes or a list
 * marker around it, at most {@link SUGGESTION_MAX_LENGTH} characters. Null when there is nothing to suggest (`NONE`,
 * or nothing left).
 */
export function cleanSuggestion(answer: string): string | null {
  let text = answer.split(/\r\n|\r|\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? ''
  for (let pass = 0; pass < 3; pass += 1) {
    const before = text
    text = text.replace(/^(?:[-*•>]|\d+[.)])\s+/, '').replace(LABEL, '').trim()
    for (const [open, close] of QUOTES) {
      if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) text = text.slice(open.length, -close.length).trim()
    }
    if (text.startsWith('**') && text.endsWith('**') && text.length > 4) text = text.slice(2, -2).trim()
    if (text === before) break
  }
  if (!text || /^none[.!]?$/i.test(text)) return null
  if (text.length > SUGGESTION_MAX_LENGTH) {
    const cut = text.slice(0, SUGGESTION_MAX_LENGTH)
    const space = cut.lastIndexOf(' ')
    text = `${(space > SUGGESTION_MAX_LENGTH / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
  }
  return text
}
