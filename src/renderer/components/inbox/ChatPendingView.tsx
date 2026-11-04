import { Clock3, CornerDownRight, ListEnd, X } from 'lucide-react'
import type { ChatPendingMessage } from '@shared/types'
import { UserBubble } from '@/components/inbox/ChatMessageView'

/**
 * What the line under a held message says. The agent was busy when the message was sent, and OpenCode
 * keeps it until the agent can take it up: a steered one at its next step, a queued one when it is done.
 * After a Stop nothing is running, and OpenCode keeps both until the next message starts the agent again.
 */
function describe(delivery: ChatPendingMessage['delivery'], running: boolean): { label: string; hint: string; icon: JSX.Element } {
  const icon = 'h-3 w-3 shrink-0'
  if (!running) {
    return { label: 'Not sent yet', hint: 'goes out with your next message', icon: <Clock3 aria-hidden className={icon} /> }
  }
  return delivery === 'steer'
    ? { label: 'Steering', hint: 'the agent reads it at its next step', icon: <CornerDownRight aria-hidden className={icon} /> }
    : { label: 'Queued', hint: 'sent when the agent is done', icon: <ListEnd aria-hidden className={icon} /> }
}

/**
 * A message the agent has not taken up yet, shown where the conversation will put it once it has: at
 * the end. It looks like the message it will become, drawn dashed, and says what is going to happen to
 * it. It can be taken back until the moment it is delivered.
 */
export function ChatPendingView({
  pending,
  running,
  onDiscard,
}: {
  pending: ChatPendingMessage
  /** Whether the agent is working; if not, the message waits for the next run. */
  running: boolean
  onDiscard: (messageId: string) => void
}): JSX.Element {
  const { label, hint, icon } = describe(pending.delivery, running)
  return (
    <div className="chat-pending flex min-w-0 flex-col items-end gap-1" data-testid={`chat-pending-${pending.id}`}>
      <UserBubble message={pending.message} pending />
      <div
        role="status"
        data-testid={`chat-pending-status-${pending.id}`}
        className="flex min-w-0 max-w-[85%] flex-wrap items-center justify-end gap-x-1.5 gap-y-0.5 pr-1 text-[11.5px] text-fg-muted"
      >
        {icon}
        <span className="font-medium text-fg">{label}</span>
        <span aria-hidden>·</span>
        <span>{hint}</span>
        <button
          type="button"
          aria-label="Remove this message"
          title="Remove this message"
          data-testid={`chat-pending-discard-${pending.id}`}
          onClick={() => onDiscard(pending.id)}
          className="ml-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-fg-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <X aria-hidden className="h-3 w-3" />
          Remove
        </button>
      </div>
    </div>
  )
}
