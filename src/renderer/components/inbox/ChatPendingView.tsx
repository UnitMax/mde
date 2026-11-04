import { Clock3, CornerDownRight, ListEnd, X } from 'lucide-react'
import type { ChatDelivery, ChatPendingMessage } from '@shared/types'
import { UserBubble } from '@/components/inbox/ChatMessageView'
import { DELIVERY_HINT } from '@/lib/chat'

const ICON = 'h-3 w-3 shrink-0'

/**
 * What the line under a held message says. The agent was busy when the message was sent, and OpenCode
 * keeps it until the agent can take it up: a steered one at its next step, a queued one when it is done.
 * After a Stop nothing is running, and OpenCode keeps both until the next message starts the agent again.
 */
function describe(delivery: ChatDelivery, running: boolean): { label: string; hint: string; icon: JSX.Element } {
  if (!running) {
    return { label: 'Not sent yet', hint: 'goes out with your next message', icon: <Clock3 aria-hidden className={ICON} /> }
  }
  return delivery === 'steer'
    ? { label: 'Steering', hint: DELIVERY_HINT.steer, icon: <CornerDownRight aria-hidden className={ICON} /> }
    : { label: 'Queued', hint: DELIVERY_HINT.queue, icon: <ListEnd aria-hidden className={ICON} /> }
}

/**
 * The other way to deliver a held message, as a button: its icon is that of the state it switches to,
 * and its text says what the message would do then. Offered only while the agent runs, because with
 * nothing running the two are the same: the message waits for the next run either way.
 */
function otherDelivery(delivery: ChatDelivery): { to: ChatDelivery; label: string; title: string; icon: JSX.Element } {
  return delivery === 'steer'
    ? { to: 'queue', label: 'Queue instead', title: `Queue it: ${DELIVERY_HINT.queue}`, icon: <ListEnd aria-hidden className={ICON} /> }
    : { to: 'steer', label: 'Steer now', title: `Steer: ${DELIVERY_HINT.steer}`, icon: <CornerDownRight aria-hidden className={ICON} /> }
}

const ACTION = 'inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-fg-muted transition-colors hover:bg-hover hover:text-fg'

/**
 * A message the agent has not taken up yet, shown where the conversation will put it once it has: at
 * the end. It looks like the message it will become, drawn dashed, and says what is going to happen to
 * it. Until the moment it is delivered it can be taken back, and while the agent runs it can be switched
 * between steering and queued.
 */
export function ChatPendingView({
  pending,
  running,
  onDiscard,
  onSetDelivery,
}: {
  pending: ChatPendingMessage
  /** Whether the agent is working; if not, the message waits for the next run. */
  running: boolean
  onDiscard: (messageId: string) => void
  onSetDelivery: (messageId: string, delivery: ChatPendingMessage['delivery']) => void
}): JSX.Element {
  const { label, hint, icon } = describe(pending.delivery, running)
  const other = otherDelivery(pending.delivery)
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
        {running && (
          <button
            type="button"
            title={other.title}
            data-testid={`chat-pending-switch-${pending.id}`}
            onClick={() => onSetDelivery(pending.id, other.to)}
            className={`ml-1 ${ACTION}`}
          >
            {other.icon}
            {other.label}
          </button>
        )}
        <button
          type="button"
          aria-label="Remove this message"
          title="Remove this message"
          data-testid={`chat-pending-discard-${pending.id}`}
          onClick={() => onDiscard(pending.id)}
          className={running ? ACTION : `ml-1 ${ACTION}`}
        >
          <X aria-hidden className="h-3 w-3" />
          Remove
        </button>
      </div>
    </div>
  )
}
