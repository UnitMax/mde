/**
 * A message invokes a skill by naming it as `$id`. The composer (to offer skills while typing) and the
 * sender (to tell OpenCode which skills a message uses) both read the text with these rules, so what
 * the picker inserts is exactly what gets sent. Offsets are UTF-16 string indices, as in `text.slice`.
 */

/** The `$word` being typed: `start` is the `$`, `end` the end of the word the caret is in or at. */
export interface SkillTrigger {
  start: number
  end: number
  /** What was typed after the `$`, up to the caret. */
  query: string
}

export interface SkillMention {
  id: string
  start: number
  end: number
  /** The `$id` as written in the message. */
  text: string
}

/** The `$word` ending at the caret when the `$` starts a word, so `$HOME` can be told from `cost$5`. */
export function skillTriggerAt(text: string, caret: number): SkillTrigger | null {
  if (!Number.isInteger(caret) || caret < 0 || caret > text.length) return null
  const match = /(?:^|\s)\$([^\s$]*)$/.exec(text.slice(0, caret))
  if (!match) return null
  const query = match[1] ?? ''
  const start = caret - query.length - 1
  let end = caret
  while (end < text.length && !/[\s$]/.test(text[end]!)) end += 1
  return { start, end, query }
}

/** True when a skill name written at `end` is a whole word, not the start of a longer one (`$demos`). */
function endsWord(text: string, end: number): boolean {
  const next = text[end]
  if (next === undefined || /\s/.test(next)) return true
  if (/[,;:!?)\]}'"]/.test(next)) return true
  // A full stop closes the sentence; one inside a word (`$demo.md`) does not.
  return next === '.' && (text[end + 1] === undefined || /\s/.test(text[end + 1]!))
}

/**
 * The skills a message invokes: every `$id` that starts a word and names one of `ids` exactly, once
 * per skill, in the order written. Text that only looks like one (`$HOME`, `$5`) is not a skill.
 */
export function skillMentions(text: string, ids: Iterable<string>): SkillMention[] {
  // The longest name wins, so `$deploy-prod` is not read as `$deploy`.
  const known = [...new Set(ids)].filter(Boolean).sort((a, b) => b.length - a.length)
  const mentions: SkillMention[] = []
  const seen = new Set<string>()
  for (let at = text.indexOf('$'); at >= 0; at = text.indexOf('$', at + 1)) {
    if (at > 0 && !/\s/.test(text[at - 1]!)) continue
    for (const id of known) {
      if (seen.has(id) || !text.startsWith(id, at + 1) || !endsWord(text, at + 1 + id.length)) continue
      const end = at + 1 + id.length
      seen.add(id)
      mentions.push({ id, start: at, end, text: text.slice(at, end) })
      break
    }
  }
  return mentions
}
