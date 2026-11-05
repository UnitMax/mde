import { MessageSquare, SquareTerminal, type LucideIcon } from 'lucide-react'
import type { InboxThreadMode } from '@shared/types'
import { cn } from '@/lib/utils'

const OPTIONS: ReadonlyArray<{ id: InboxThreadMode; label: string; description: string; Icon: LucideIcon }> = [
  { id: 'gui', label: 'GUI', description: 'Follow the conversation in MDE', Icon: MessageSquare },
  { id: 'terminal', label: 'Terminal', description: 'Work in the OpenCode terminal', Icon: SquareTerminal },
]

/**
 * How a new thread is shown once it starts: as a conversation in MDE, or as the OpenCode terminal. A flat
 * two-way toggle in the composer's picker row, after its own divider like the other chips. In a narrow
 * composer only the icons stay, as `McpChip` does, so the pickers beside it are not squeezed.
 */
export function ThreadModeSwitch({
  value,
  onChange,
  disabled,
}: {
  value: InboxThreadMode
  onChange: (mode: InboxThreadMode) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <>
      <span aria-hidden="true" className="h-4 w-px bg-line-strong" />
      <div role="group" aria-label="Thread interface" data-testid="thread-mode-switch" className="flex shrink-0 items-center gap-0.5">
        {OPTIONS.map(({ id, label, description, Icon }) => {
          const selected = value === id
          return (
            <button
              key={id}
              type="button"
              aria-pressed={selected}
              aria-label={label}
              title={description}
              disabled={disabled}
              data-testid={`thread-mode-${id}`}
              onClick={() => onChange(id)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors disabled:pointer-events-none disabled:opacity-50',
                selected ? 'bg-active text-fg' : 'text-fg-subtle hover:bg-hover hover:text-fg',
              )}
            >
              <Icon aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="@max-[40rem]:hidden">{label}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}
