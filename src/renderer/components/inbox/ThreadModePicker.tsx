import { Check, ChevronDown, MessageSquare, SquareTerminal, type LucideIcon } from 'lucide-react'
import type { InboxThreadMode } from '@shared/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { barTrigger } from '@/components/inbox/ComposerBar'

const OPTIONS: ReadonlyArray<{ id: InboxThreadMode; label: string; description: string; Icon: LucideIcon }> = [
  { id: 'gui', label: 'GUI', description: 'Follow the conversation in MDE.', Icon: MessageSquare },
  { id: 'terminal', label: 'Terminal', description: 'Work in the OpenCode terminal.', Icon: SquareTerminal },
]

/**
 * How a new thread is shown once it starts: as a conversation in MDE, or as the OpenCode terminal. A chip with
 * a menu in the strip under the message box, the same as the chip that chooses where the thread runs.
 */
export function ThreadModePicker({
  value,
  onChange,
  disabled,
}: {
  value: InboxThreadMode
  onChange: (mode: InboxThreadMode) => void
  disabled?: boolean
}): JSX.Element {
  const active = OPTIONS.find((item) => item.id === value) ?? OPTIONS[0]!
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" className={barTrigger} aria-label="Thread interface" data-testid="thread-mode-picker">
          <active.Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{active.label}</span>
          <ChevronDown aria-hidden className="h-3 w-3 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {OPTIONS.map(({ id, label, description, Icon }) => (
          <DropdownMenuItem key={id} onSelect={() => onChange(id)} className="items-start" data-testid={`thread-mode-${id}`}>
            <Icon aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted" />
            <span className="min-w-0 flex-1">
              <span className="block">{label}</span>
              <span className="block text-[11px] text-fg-subtle">{description}</span>
            </span>
            {id === value && <Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
