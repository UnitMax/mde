import type { ChatPart, ChatToolStatus } from '@shared/types'
import { checkView, type ViewCheck } from '@shared/view-spec'
import { isViewCall, isViewTool } from '@shared/view-tool'

type ToolPart = Extract<ChatPart, { kind: 'tool' }>

/** One `show_view` call in a tool part, and what MDE makes of it. */
export interface ViewEntry {
  status: ChatToolStatus
  /** The call's arguments as JSON text, as the transcript holds them. */
  input: string
  /**
   * `pending` while the arguments are still arriving; `cut` when the transcript does not hold them whole; otherwise
   * the result of checking them, which is what is drawn.
   */
  state: 'pending' | 'cut' | ViewCheck
}

/** Whether a tool part is, or holds, a `show_view` call of the MDE MCP. */
export function isViewPart(part: ChatPart): boolean {
  return part.kind === 'tool' && (isViewTool(part.name) || Boolean(part.calls?.some((call) => isViewCall(call.tool))))
}

/** A view part that is drawn as itself rather than folded among the agent's work: it shows the person something. */
export function isShownView(part: ChatPart): boolean {
  return part.kind === 'tool' && isViewPart(part) && part.status !== 'error'
}

function entry(status: ChatToolStatus, input: string, truncated: boolean): ViewEntry {
  if (status === 'pending' || status === 'running') return { status, input, state: 'pending' }
  let args: unknown
  try {
    args = JSON.parse(input)
  } catch {
    return { status, input, state: truncated ? 'cut' : { ok: false, errors: ['The view is not valid JSON.'] } }
  }
  return { status, input, state: checkView(args) }
}

/** The views a tool part shows, in order. A script's calls are only listed; their arguments are in the metadata. */
export function viewEntries(part: ToolPart): ViewEntry[] {
  if (isViewTool(part.name)) return [entry(part.status, part.input, Boolean(part.truncated))]
  return (part.calls ?? [])
    .filter((call) => isViewCall(call.tool))
    .map((call) => entry(call.status === 'completed' || call.status === 'error' ? call.status : part.status === 'completed' || part.status === 'error' ? part.status : call.status, call.input, Boolean(part.truncated)))
}
