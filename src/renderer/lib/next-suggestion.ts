import type { ChatMessage } from '@shared/types'

/** A finished turn waits this long before its next message is guessed, so a quick follow-up costs no model call. */
export const SUGGESTION_DELAY_MS = 5000

/**
 * The turn a next-message suggestion would be for: the ID of the agent's last step when the conversation ends with
 * it, finished and without an error, and nothing else is going on. Null when there is nothing to suggest after: the
 * agent is still working or waiting on the person (a permission, a question), a message is held for it, a revert is
 * staged, or the conversation ends with anything other than a finished reply (a note, a failed or stopped step).
 */
export function suggestionTurn(
  messages: readonly ChatMessage[],
  state: { running: boolean; asking: boolean; held: number; reverting: boolean },
): string | null {
  if (state.running || state.asking || state.held > 0 || state.reverting) return null
  const last = messages[messages.length - 1]
  if (!last || last.kind !== 'assistant' || !last.completed || last.error) return null
  return last.id
}
