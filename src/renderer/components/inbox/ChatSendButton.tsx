import type { ReactNode } from 'react'
import { ArrowUp, Check, ChevronDown, CornerDownRight, ListEnd, LoaderCircle } from 'lucide-react'
import type { ChatDelivery } from '@shared/types'
import { useComposerSize } from '@/components/inbox/composer-toolbar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { DELIVERY_HINT } from '@/lib/chat'
import { atLeast } from '@/lib/composer-size'
import { cn } from '@/lib/utils'

const MODES: { id: ChatDelivery; label: string; icon: typeof ListEnd }[] = [
  { id: 'steer', label: 'Steer', icon: CornerDownRight },
  { id: 'queue', label: 'Queue', icon: ListEnd },
]

/** The first letter of a hint in capitals, for the menu, where it starts a line. */
const sentence = (hint: string): string => hint.charAt(0).toUpperCase() + hint.slice(1)

export interface ChatSendButtonProps {
  /**
   * The agent is working. A message then reaches it either at once between two steps (steering) or when
   * it is done (queued), so the button grows a word that says which, and a menu to choose the other.
   * With the agent idle the two are the same, and it is the plain round button.
   */
  running: boolean
  delivery: ChatDelivery
  onDeliveryChange: (delivery: ChatDelivery) => void
  /** Nothing can be sent right now: no text, an unfinished upload, a blocked Git bar, and so on. */
  disabled: boolean
  sending: boolean
  onSend: () => void
  /** The new-thread page can start a thread without opening it and keep the composer ready. */
  backgroundShortcut?: string
  /** The menu has closed; the caret goes back to the text. */
  onMenuClosed?: () => void
  /**
   * The text is a slash command, so the button runs it instead of sending: round, with the command's own
   * picture. A command is not delivered to the agent, so it is never the Steer / Queue button, even while
   * the agent works.
   */
  command?: { name: string; icon: ReactNode }
}

/** The way out of the prompt box: round when the agent is idle, a Steer / Queue button while it works. */
export function ChatSendButton({ running, delivery, onDeliveryChange, disabled, sending, onSend, backgroundShortcut, onMenuClosed, command }: ChatSendButtonProps): JSX.Element {
  const labelled = atLeast(useComposerSize(), 'medium')
  if (command) {
    return (
      <button
        type="button"
        aria-label={`Run /${command.name}`}
        title={`Run /${command.name} (Enter)`}
        disabled={disabled}
        onClick={onSend}
        data-testid="chat-send"
        data-command={command.name}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-35"
      >
        {command.icon}
      </button>
    )
  }
  const icon = sending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <ArrowUp aria-hidden className="h-4 w-4" />
  if (!running) {
    return (
      <button
        type="button"
        aria-label="Send"
        title={backgroundShortcut ? `Send (Enter). Start in background and keep creating threads (${backgroundShortcut})` : 'Send (Enter)'}
        disabled={disabled}
        onClick={onSend}
        data-testid="chat-send"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-35"
      >
        {icon}
      </button>
    )
  }
  const mode = MODES.find((entry) => entry.id === delivery) ?? MODES[0]!
  // The ring is drawn inside in the dark text color: the accent color of the default one vanishes on the accent fill.
  const part = 'flex items-center transition-colors hover:bg-accent-hover disabled:pointer-events-none focus-visible:outline-accent-fg focus-visible:-outline-offset-4'
  return (
    <div
      data-testid="chat-send-pill"
      className={cn('chat-send-pill flex h-8 shrink-0 whitespace-nowrap rounded-full bg-accent text-accent-fg transition-opacity', disabled && 'opacity-35')}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onSend}
        title={`${mode.label} (Enter): ${DELIVERY_HINT[mode.id]}`}
        data-testid="chat-send"
        data-delivery={mode.id}
        className={cn(part, 'shrink-0 gap-1.5 rounded-l-full pl-3 pr-2 text-[12.5px] font-medium')}
      >
        {icon}
        {/* In a narrow box the pickers need the room more: the word stays for screen readers and the tooltip. */}
        <span className={cn(!labelled && 'sr-only')}>{mode.label}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            aria-label="How to send"
            title="Steer now or queue for later"
            data-testid="chat-send-menu"
            className={cn(part, 'shrink-0 justify-center rounded-r-full border-l border-accent-fg/25 pl-1.5 pr-2 data-[state=open]:bg-accent-hover')}
          >
            <ChevronDown aria-hidden className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="top"
          className="w-72"
          // Back to the text, not to the button: Enter then sends with what was just chosen.
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            onMenuClosed?.()
          }}
        >
          {MODES.map(({ id, label, icon: Icon }) => (
            <DropdownMenuItem
              key={id}
              data-testid={`chat-send-mode-${id}`}
              onSelect={() => onDeliveryChange(id)}
              className={cn('items-start', id === delivery && 'bg-active')}
            >
              <Icon aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block">{label}</span>
                <span className="block text-[11px] text-fg-muted">{sentence(DELIVERY_HINT[id])}</span>
              </span>
              {id === delivery && <Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
