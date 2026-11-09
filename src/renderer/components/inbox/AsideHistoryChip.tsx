import { toolbarChip } from '@/components/inbox/composer-toolbar'
import { SlashCommandIcon } from '@/components/inbox/SlashCommandIcon'
import { cn } from '@/lib/utils'

/**
 * The way back to a thread's side questions (`/btw`) once their card is closed: a chip in the message box's
 * toolbar with how many there are. It opens the card on the newest one and closes it again. Draws nothing
 * for a thread that has had no side question.
 */
export function AsideHistoryChip({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }): JSX.Element | null {
  if (count === 0) return null
  const label = `${count} side ${count === 1 ? 'question' : 'questions'}`
  return (
    <button
      type="button"
      data-testid="chat-aside-history"
      aria-label={open ? `Hide side questions (${count})` : `Show ${label}`}
      aria-pressed={open}
      title={open ? 'Hide side questions' : `${label} (/btw)`}
      // A click must not take the caret out of the message box.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggle}
      className={cn(toolbarChip, 'shrink-0 px-2', open && 'bg-hover text-fg')}
    >
      <SlashCommandIcon name="btw" className={cn('h-4 w-4', open && 'text-accent')} />
      <span className="tabular-nums">{count}</span>
    </button>
  )
}
