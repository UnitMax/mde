import { checkView } from '@shared/view-spec'
import type { McpToolOutcome } from './protocol'

/**
 * `show_view`, answered by the bridge itself: a view is only data in the call's arguments, which OpenCode keeps in
 * the transcript and MDE draws from there. So the bridge needs no running MDE for it; it checks the view by the
 * same rules the window applies before drawing, and tells the agent exactly what to fix when it does not pass.
 */
export function showView(args: Record<string, unknown>): McpToolOutcome {
  const check = checkView(args)
  if (!check.ok) {
    return {
      isError: true,
      text: `MDE cannot show this view:\n${check.errors.map((error) => `- ${error}`).join('\n')}\nFix these and call show_view again.`,
    }
  }
  const title = check.view.title ? ` "${check.view.title}"` : ''
  return {
    isError: false,
    text: `MDE shows the view${title} to the person in the chat, where you called it. Do not repeat its data in your reply; refer to it instead.`,
  }
}
