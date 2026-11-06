/**
 * What MDE knows of OpenCode's `/goal` command, shared by the main process (which checks a request) and the
 * renderer (which refuses early, with a reason, instead of waiting for OpenCode's refusal).
 */

/** The longest objective OpenCode accepts. */
export const GOAL_OBJECTIVE_LIMIT = 4000

/** What may follow `/goal` to act on the goal instead of setting one. */
export const GOAL_KEYWORDS = ['pause', 'resume', 'clear'] as const
export type GoalKeyword = (typeof GOAL_KEYWORDS)[number]

const QUOTES: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’' }

/** The text with one pair of matching quotes around it taken off, as OpenCode does before it reads a goal. */
function unquoted(text: string): string {
  const match = /^(["'“‘])([\s\S]*)(["'”’])$/.exec(text.trim())
  return match && QUOTES[match[1]!] === match[3] ? match[2]!.trim() : text.trim()
}

/**
 * The action the text is, when it is exactly one of them (in any case, quotes or not), or null when it is an
 * objective. OpenCode reads `pause`, `resume` and `clear` as actions however they are written, so none of
 * them can be an objective on its own.
 */
export function goalKeyword(text: string): GoalKeyword | null {
  const word = unquoted(text).toLowerCase()
  return GOAL_KEYWORDS.find((keyword) => keyword === word) ?? null
}

/** Why an objective cannot be set, or null when it can. */
export function goalObjectiveProblem(objective: string): string | null {
  const trimmed = objective.trim()
  if (!trimmed) return 'Say what the goal is.'
  const keyword = goalKeyword(trimmed)
  if (keyword) return `"${keyword}" would be read as /goal ${keyword}. Describe the goal in more words.`
  if (trimmed.length > GOAL_OBJECTIVE_LIMIT) {
    return `A goal can be at most ${GOAL_OBJECTIVE_LIMIT.toLocaleString('en-US')} characters (this one has ${trimmed.length.toLocaleString('en-US')}).`
  }
  return null
}
